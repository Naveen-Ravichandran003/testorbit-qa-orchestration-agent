import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import Header from "../components/Header";
import InputForm from "../components/InputForm";
import TestCaseTable from "../components/TestCaseTable";
import { TestCase } from "../types";
import { fetchIssue, generateTestCases, pushTestCase, createTestPlan, createTestExecution, fetchTestCasesByStory, getCredentials, getLlmConfig, getXrayCredentials, extractJiraId } from "../jiraService";
import { useSync } from "../useSync";

interface Scope { positive: boolean; negative: boolean; edge: boolean; [key: string]: boolean; }
interface FetchedStory { id: string; summary: string; description: string; status: string; priority: string; acceptanceCriteria: string; issueType: string; }

let tcCounter = 1;
function resetTcCounter() { tcCounter = 1; }
function genId() { return `TC-${String(tcCounter++).padStart(3, "0")}`; }

const GEN_KEY = "testorbit_generator_state";
function saveGen(data: any) { try { sessionStorage.setItem(GEN_KEY, JSON.stringify(data)); } catch {} }
function loadGen() { try { return JSON.parse(sessionStorage.getItem(GEN_KEY) || "null"); } catch { return null; } }

const Generator: React.FC = () => {
  const { emitActivity } = useSync({ page: "generator" });
  const location = useLocation();
  const [jiraId, setJiraId] = useState("");
  const [notes, setNotes] = useState("");
  const [scope, setScope] = useState<Scope>({ positive: true, negative: true, edge: false });
  const [story, setStory] = useState<FetchedStory | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pushState, setPushState] = useState<{ loading: boolean; results: { id: string; key: string; url: string }[] }>({ loading: false, results: [] });
  const [planState, setPlanState] = useState<{ loading: boolean; result: { key: string; url: string } | null; execResult: { key: string; url: string } | null }>({ loading: false, result: null, execResult: null });
  const [planName, setPlanName] = useState("");
  const [showPlanInput, setShowPlanInput] = useState(false);
  const [existingTestCases, setExistingTestCases] = useState<{ id: string; summary: string; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ragInfo, setRagInfo] = useState<{ used: boolean; count: number } | null>(null);

  // Restore persisted state on mount so test cases survive navigation
  useEffect(() => {
    // If navigated from Coverage with a storyId, use that and clear any saved session
    const stateStoryId = (location.state as any)?.storyId;
    if (stateStoryId) {
      handleClear();
      setJiraId(stateStoryId);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const saved = loadGen();
    if (!saved) return;
    if (saved.jiraId) setJiraId(saved.jiraId);
    if (saved.story) setStory(saved.story);
    if (saved.planName) setPlanName(saved.planName);
    if (saved.testCases?.length) {
      setTestCases(saved.testCases);
      setSelectedIds(new Set(saved.testCases.map((tc: TestCase) => tc.id)));
      tcCounter = saved.testCases.length + 1;
    }
    if (saved.pushResults?.length) setPushState({ loading: false, results: saved.pushResults });
  }, []);

  const handleClear = useCallback(() => {
    setStory(null); setTestCases([]); setSelectedIds(new Set()); setJiraId(""); setNotes("");
    setPushState({ loading: false, results: [] }); setPlanState({ loading: false, result: null, execResult: null });
    setExistingTestCases([]); setError(null); resetTcCounter();
    sessionStorage.removeItem(GEN_KEY);
  }, []);

  const handleFetch = async () => {
    setError(null); setStory(null); setTestCases([]); setSelectedIds(new Set());
    setExistingTestCases([]);
    setPushState({ loading: false, results: [] }); setPlanState({ loading: false, result: null, execResult: null });
    setFetching(true);
    const resolvedId = extractJiraId(jiraId);
    if (resolvedId !== jiraId) setJiraId(resolvedId);
    try {
      const data = await fetchIssue(resolvedId);
      setStory(data);
      setPlanName(`Test Plan for ${data.id} - ${data.summary.slice(0, 40)}`);
      // Check for existing test cases linked to this story
      if (getCredentials()) {
        const existing = await fetchTestCasesByStory(resolvedId).catch(() => []);
        if (existing.length > 0) setExistingTestCases(existing);
      }
    } catch (err: any) { setError(err.message); }
    finally { setFetching(false); }
  };

  const handleGenerate = async () => {
    if (!story) { setError("Fetch a Jira issue first."); return; }
    if (!getLlmConfig()?.apiKey) { setError("LLM not configured. Go to Settings and add your API key."); return; }
    if (existingTestCases.length > 0) {
      setError(`${existingTestCases.length} test case${existingTestCases.length !== 1 ? "s" : ""} already exist for ${story.id} in Jira. Generating new ones will create duplicates. Delete the existing ones first or use a different user story.`);
      return;
    }
    setGenerating(true); setError(null);
    try {
      const { testCases: generated, ragUsed, ragCount } = await generateTestCases(story, notes, scope);
      setRagInfo({ used: ragUsed, count: ragCount });
      emitActivity(`generated tests for ${story.id}`, `${Object.entries(scope).filter(([,v])=>v).map(([k])=>k).join(", ")} scope`);
      resetTcCounter();
      const mapped: TestCase[] = generated.map((tc: any) => ({
        id: genId(),
        title: tc.title,
        preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : [tc.preconditions],
        steps: Array.isArray(tc.steps) ? tc.steps : [tc.steps],
        expectedResult: tc.expectedResult,
        postConditions: Array.isArray(tc.postConditions) ? tc.postConditions : [],
        testData: tc.testData || "",
        priority: tc.priority || "Medium",
        type: tc.type || "Functional",
        scope: tc.scope || "Positive",
        userStoryId: story.id
      }));
      setTestCases(mapped);
      setSelectedIds(new Set(mapped.map(tc => tc.id)));
      setPushState({ loading: false, results: [] });
      setPlanState({ loading: false, result: null, execResult: null });
      saveGen({ jiraId: story.id, story, testCases: mapped, planName, pushResults: [] });
    } catch (err: any) { setError(err.message); }
    finally { setGenerating(false); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleAll = () => {
    setSelectedIds(prev => prev.size === testCases.length ? new Set() : new Set(testCases.map(tc => tc.id)));
  };
  const handleSave = (updated: TestCase) => {
    setTestCases(prev => {
      const next = prev.map(tc => tc.id === updated.id ? updated : tc);
      saveGen({ jiraId, story, testCases: next, planName, pushResults: pushState.results });
      return next;
    });
  };

  const llmConfigured = !!getLlmConfig()?.apiKey;

  const handlePush = async () => {
    if (selectedIds.size === 0) return;
    if (!getCredentials()) { setError("Jira credentials not configured. Go to Settings."); return; }
    setPushState({ loading: true, results: [] }); setError(null);
    const results: { id: string; key: string; url: string }[] = [];
    for (const tc of testCases.filter(tc => selectedIds.has(tc.id))) {
      try {
        const res = await pushTestCase(tc, story!.id);
        results.push({ id: tc.id, key: res.key, url: res.url });
      } catch (err: any) { setError(`Failed to push ${tc.id}: ${err.message}`); break; }
    }
    setPushState({ loading: false, results });
    if (results.length) {
      emitActivity(`pushed ${results.length} test cases`, `for ${story?.id}`);
      saveGen({ jiraId: story?.id, story, testCases, planName, pushResults: results });
    }
  };

  const handleCreatePlan = async () => {
    if (pushState.results.length === 0) { setError("Push test cases to Jira first before creating a Test Plan."); return; }
    if (!planName.trim()) { setError("Test Plan name is required."); return; }
    setPlanState({ loading: true, result: null, execResult: null }); setError(null);
    try {
      const keys = pushState.results.map(r => r.key);
      const planRes = await createTestPlan(planName, keys, story!.id);
      // Auto-create Test Execution linked to the Test Plan
      const execRes = await createTestExecution(
        planRes.key, keys,
        `Test Execution for ${planRes.key}`
      );
      setPlanState({ loading: false, result: planRes, execResult: execRes });
    } catch (err: any) { setError(err.message); setPlanState({ loading: false, result: null, execResult: null }); }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div>
        <Header
        title="Test Case Generator"
        subtitle=""
        actions={
          !llmConfigured ? (
            <span className="text-xs font-medium px-2.5 py-1 rounded border" style={{ color: "#974F0C", backgroundColor: "#FFFAE6", borderColor: "#FFE380" }}>
              LLM not configured — go to Settings
            </span>
          ) : undefined
        }
      />
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#F4F5F7]">
        {error && (
          <div className="banner-error justify-between">
            <span>✗ {error}</span>
            <button onClick={() => setError(null)} className="text-[#ff5630] hover:text-[#bf2600]">×</button>
          </div>
        )}

        <InputForm
          jiraId={jiraId} notes={notes} scope={scope}
          onJiraIdChange={setJiraId} onNotesChange={setNotes}
          onScopeChange={key => setScope(prev => ({ ...prev, [key]: !prev[key] }))}
          onFetch={handleFetch} onGenerate={handleGenerate}
          fetching={fetching} generating={generating}
        />

        {story && (
          <div className="bg-white border border-[#DEEBFF] rounded p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-[#0052CC] uppercase tracking-wide">{story.id}</span>
                <h3 className="text-sm font-semibold text-[#172B4D] mt-0.5">{story.summary}</h3>
                {story.description && <p className="text-xs text-[#5E6C84] mt-1 line-clamp-3">{story.description}</p>}
              </div>
              <div className="flex gap-2 ml-4 flex-shrink-0">
                <span className="badge-smoke">{story.issueType}</span>
                <span className="badge-pending">{story.status}</span>
                <span className={story.priority === "High" || story.priority === "Highest" ? "badge-fail" : "badge-smoke"}>{story.priority}</span>
              </div>
            </div>
          </div>
        )}

        {existingTestCases.length > 0 && (
          <div className="bg-[#FFFAE6] border border-[#FFE380] text-[#974F0C] text-sm px-4 py-3 rounded">
            <p className="font-semibold mb-1">⚠ {existingTestCases.length} test case{existingTestCases.length !== 1 ? "s" : ""} already exist for {story?.id}</p>
            <p className="text-xs text-[#974F0C] mb-2">Generating new test cases will create duplicates. Delete the existing ones in Jira first, or proceed to push and create a Test Plan with the existing ones.</p>
            <div className="flex flex-wrap gap-2">
              {existingTestCases.map(tc => (
                <a key={tc.id} href={tc.url} target="_blank" rel="noreferrer"
                  className="text-xs font-mono text-[#974F0C] bg-[#FFF0B3] border border-[#FFE380] px-2 py-0.5 rounded hover:bg-[#FFF0B3]">
                  {tc.id} ↗
                </a>
              ))}
            </div>
          </div>
        )}

        {generating && (
          <div className="card flex items-center gap-3 text-sm text-[#475569]">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
            Analyzing user story with LLM and generating test cases…
          </div>
        )}

        {ragInfo?.used && (
          <div className="flex items-center gap-2 text-xs text-[#0e7490] bg-[#ecfeff] border border-[#a5f3fc] px-3 py-2 rounded">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
            RAG context: <strong>{ragInfo.count}</strong> similar test case{ragInfo.count !== 1 ? "s" : ""} from other stories used to avoid duplication
          </div>
        )}

        <TestCaseTable testCases={testCases} selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleAll={toggleAll} onSave={handleSave} />

        {testCases.length > 0 && (
          <div className="space-y-3">
            {/* Actions bar */}
            <div className="bg-white border border-[#DFE1E6] rounded px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-[#5E6C84]">
                  <span className="font-bold text-[#172B4D]">{selectedIds.size}</span> of {testCases.length} selected
                </span>
                <div className="w-px h-4 bg-[#DFE1E6]" />
                <button
                  onClick={handleClear}
                  className="text-xs font-medium text-[#5E6C84] hover:text-[#172B4D] flex items-center gap-1.5 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                  Clear Session
                </button>
              </div>
              <div className="flex items-center gap-3 flex-wrap justify-end">
                {pushState.results.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pushState.results.map(r => (
                      <a key={r.id} href={r.url} target="_blank" rel="noreferrer"
                        className="text-xs font-mono text-[#0052CC] bg-[#DEEBFF] border border-[#B3D4FF] px-2 py-0.5 rounded hover:bg-[#B3D4FF] transition-colors">
                        {r.id} → {r.key} ↗
                      </a>
                    ))}
                  </div>
                )}
                <button className="btn-primary text-xs" onClick={handlePush} disabled={selectedIds.size === 0 || pushState.loading || pushState.results.length > 0}>
                  {pushState.loading ? "Pushing…" : pushState.results.length > 0 ? `✓ Pushed (${pushState.results.length})` : `Push to Jira (${selectedIds.size})`}
                </button>
              </div>
            </div>

            {/* Test Plan section — shown after push */}
            {pushState.results.length > 0 && (
          <div className="bg-white border border-[#DFE1E6] rounded p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#1e293b]">Create Test Plan</h3>
                  <div className="flex gap-2">
                    {planState.result && (
                      <a href={planState.result.url} target="_blank" rel="noreferrer"
                        className="text-xs text-[#0e7490] font-medium bg-white border border-[#a5f3fc] px-2 py-1 rounded hover:bg-[#ecfeff]">
                        {planState.result.key} — Test Plan ↗
                      </a>
                    )}
                    {planState.execResult && (
                      <a href={planState.execResult.url} target="_blank" rel="noreferrer"
                        className="text-xs text-[#006644] font-medium bg-white border border-[#abf5d1] px-2 py-1 rounded hover:bg-[#e3fcef]">
                        {planState.execResult.key} — Test Execution ↗
                      </a>
                    )}
                  </div>
                </div>
                <p className="text-xs text-[#64748b]">
                  Creates a Test Plan in Jira linked to <strong>{jiraId}</strong> with {pushState.results.length} test case{pushState.results.length !== 1 ? "s" : ""}.
                  {getXrayCredentials()?.clientId && " Xray test plan will also be updated."}
                </p>
                <div className="flex gap-2">
                  <input
                    className="input-field text-sm flex-1"
                    placeholder="Test Plan name"
                    value={planName}
                    onChange={e => setPlanName(e.target.value)}
                  />
                  <button className="btn-primary whitespace-nowrap" onClick={handleCreatePlan} disabled={planState.loading || !!planState.result}>
                    {planState.loading ? "Creating…" : planState.result ? "✓ Created" : "Create Test Plan"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Generator;
