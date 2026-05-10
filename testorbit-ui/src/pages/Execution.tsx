import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import Header from "../components/Header";
import BugModal from "../components/BugModal";
import { BugReport, TestStatus } from "../types";
import { getCredentials, getXrayCredentials, fetchTestCasesByPlan, createBug, evaluateResult, updateTestStatus, updateTestExecutionStatus, getLlmConfig, extractJiraId } from "../jiraService";
import { useSync, PresenceUser, SyncUser } from "../useSync";
import { setExecResult } from "../DataStore";

type FetchMode = "plan";

interface ExecRow {
  id: string;
  summary: string;
  expectedResult: string;
  expectedPoints: string[];
  actualPoints: string[];
  actualResult: string;
  status: TestStatus;
  url: string;
  steps: string[];
  reason?: string;
}

function parsePoints(text: string): string[] {
  // Split by sentence-ending punctuation, newlines, or bullet-like separators
  return text
    .split(/(?<=[.!?])\s+|\n+|\s*[•\-–]\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

const EXEC_KEY = "testorbit_execution_state";
function saveExec(data: any) { try { sessionStorage.setItem(EXEC_KEY, JSON.stringify(data)); } catch {} }
function loadExec() { try { return JSON.parse(sessionStorage.getItem(EXEC_KEY) || "null"); } catch { return null; } }

const EXCLUDED_TYPES = ["story", "epic", "task", "sub-task", "subtask", "bug", "improvement", "feature"];
function isTestRow(row: any): boolean {
  const t = (row.type || row.issueType || "").toLowerCase().trim();
  if (EXCLUDED_TYPES.includes(t)) return false;
  if (!t) {
    const s = (row.summary || "").toLowerCase();
    if (s.startsWith("as a ") || s.startsWith("as an ") || s.includes("so that i can") || s.includes("i want to")) return false;
  }
  return true;
}

const Execution: React.FC = () => {
  const connected = !!getCredentials();
  const location  = useLocation();

  const saved = loadExec();
  const [inputId, setInputId] = useState(saved?.inputId || "");
  const [execKey, setExecKey] = useState(saved?.execKey || "");
  const [boardId, setBoardId] = useState<string | null>(saved?.boardId || null);
  const boardIdRef = useRef<string | null>(saved?.boardId || null);
  const [boardPeers, setBoardPeers]   = useState(0);
  const [editingRows, setEditingRows] = useState<Record<string, SyncUser>>({});
  const [rows, setRows]               = useState<ExecRow[]>((saved?.rows || []).filter(isTestRow));
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [bugModal, setBugModal]       = useState<{ open: boolean; bug: BugReport | null }>({ open: false, bug: null });
  const [createdBugs, setCreatedBugs] = useState<Record<string, { key: string; url: string }>>(saved?.createdBugs || {});
  const [bugLoading, setBugLoading]   = useState(false);
  const [evaluating, setEvaluating]   = useState<Set<string>>(new Set());
  const [refining, setRefining]       = useState<Set<string>>(new Set());
  const [updatingPlan, setUpdatingPlan]       = useState(false);
  const [planUpdateStatus, setPlanUpdateStatus] = useState<{ success: boolean; msg: string } | null>(null);
  const { emitRowUpdate, emitRowsLoaded, emitJoinBoard, emitActivity, emitResetBoard } = useSync({
    page: "execution",
    boardId,
    onBoardState: useCallback((incoming: ExecRow[]) => {
      // Merge persisted state — keep local edits for rows already being typed
      setRows(prev => {
        if (!prev.length) return incoming;
        return incoming.map(r => {
          const local = prev.find(p => p.id === r.id);
          // If local has actual result being typed, keep it; otherwise take server state
          return local?.actualResult && local.actualResult !== r.actualResult ? local : r;
        });
      });
    }, []),
    onRowUpdated: useCallback((rowId: string, patch: any) => {
      setRows(prev => prev.map(r => r.id === rowId ? { ...r, ...patch } : r));
    }, []),
    onRowEditing: useCallback((rowId: string, user: SyncUser) => {
      setEditingRows(prev => ({ ...prev, [rowId]: user }));
      // Clear editing indicator after 3s of no updates
      setTimeout(() => setEditingRows(prev => { const n = { ...prev }; delete n[rowId]; return n; }), 3000);
    }, []),
    onBoardPeers: useCallback((count: number) => setBoardPeers(count), []),
    onBoardReset: useCallback(() => { setRows([]); setCreatedBugs({}); sessionStorage.removeItem(EXEC_KEY); }, []),
  });

  // Auto-load when navigated from Repository Execute button
  useEffect(() => {
    const state = location.state as { planId?: string; execId?: string; folderName?: string } | null;
    if (state?.planId && state?.execId) {
      setInputId(state.planId);
      setExecKey(state.execId);
      setTimeout(() => fetchByIds(state.planId!, state.execId!), 100);
    }
  }, []);

  async function fetchByIds(planId: string, execId: string) {
    setLoading(true); setError(null); setRows([]); setCreatedBugs({});
    const boardId = `${planId}:${execId}`;
    boardIdRef.current = boardId;
    setBoardId(boardId);
    emitJoinBoard(boardId);
    try {
      // Check if server already has persisted rows for this board
      const persisted = await fetch(`http://localhost:3001/sync/board/${encodeURIComponent(boardId)}`)
        .then(r => { if (!r.ok) { console.warn("Board state fetch failed:", r.status); return []; } return r.json(); })
        .catch(() => []);
      if (persisted.length > 0) {
        setRows(persisted);
        setLoading(false);
        return;
      }
      const issues = await fetchTestCasesByPlan(planId);
      if (issues.length === 0) { setError(`No test cases found in Test Plan ${planId}.`); return; }
      // Strictly exclude stories, epics, tasks — only keep Test issues
      const EXCLUDED = ["story", "epic", "task", "sub-task", "subtask", "bug", "improvement", "feature"];
      const testOnly = issues.filter((i: any) => {
        const t = (i.type || i.issueType || "").toLowerCase().trim();
        if (EXCLUDED.includes(t)) return false;
        // If type is empty, check summary — stories often start with "As a" or contain user story patterns
        if (!t) {
          const s = (i.summary || "").toLowerCase();
          if (s.startsWith("as a ") || s.startsWith("as an ") || s.includes("so that i can") || s.includes("i want to")) return false;
        }
        return true;
      });
      if (testOnly.length === 0) { setError(`No test cases found in Test Plan ${planId}. Only stories/tasks were linked.`); return; }
      const newRows: ExecRow[] = testOnly.map((i: any) => {
        const expectedPoints = parsePoints(i.expectedResult || "Refer to Jira issue");
        return { id: i.id, summary: i.summary, expectedResult: i.expectedResult || "Refer to Jira issue", expectedPoints, actualPoints: expectedPoints.map(() => ""), actualResult: "", status: "Pending" as TestStatus, url: i.url, steps: [] };
      });
      setRows(newRows);
      emitRowsLoaded(boardId, newRows);
      saveExec({ inputId: planId, execKey: execId, boardId, rows: newRows, createdBugs: {} });
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }

  const handleFetchTestCases = async () => {
    if (!inputId.trim()) { setError("Test Plan ID is required."); return; }
    if (!execKey.trim()) { setError("Test Execution ID is required."); return; }
    const resolvedPlanId = extractJiraId(inputId);
    const resolvedExecId = extractJiraId(execKey);
    if (!/^[A-Z]+-\d+$/i.test(resolvedPlanId)) { setError(`"${inputId}" is not a valid Jira issue key or URL.`); return; }
    if (!/^[A-Z]+-\d+$/i.test(resolvedExecId)) { setError(`"${execKey}" is not a valid Jira issue key or URL.`); return; }
    if (resolvedPlanId !== inputId) setInputId(resolvedPlanId);
    if (resolvedExecId !== execKey) setExecKey(resolvedExecId);
    await fetchByIds(resolvedPlanId, resolvedExecId);
  };

  const updateActualPoint = (id: string, index: number, value: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const actualPoints = [...r.actualPoints];
      actualPoints[index] = value;
      const patch = { actualPoints, actualResult: actualPoints.join(". "), status: "Pending" as TestStatus };
      if (boardIdRef.current) emitRowUpdate(boardIdRef.current, id, patch);
      return { ...r, ...patch };
    }));
  };

  const refineActualResult = async (id: string) => {
    const row = rows.find(r => r.id === id);
    if (!row || !row.actualResult.trim() || !getLlmConfig()?.apiKey) return;
    setRefining(prev => new Set(prev).add(id));
    try {
      const llm = getLlmConfig();
      const res = await fetch("http://localhost:3001/llm/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actualResult: row.actualResult,
          expectedPoints: row.expectedPoints,
          llmConfig: { model: llm.llm, apiKey: llm.apiKey, endpoint: llm.endpoint, provider: llm.provider || "groq" }
        })
      });
      const data = await res.json();
      if (data.refined) setRows(prev => prev.map(r => r.id === id ? { ...r, actualResult: data.refined } : r));
    } catch { /* silent fail */ }
    finally { setRefining(prev => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const PASS_KEYWORDS = ["pass", "passed", "success", "works as expected", "working as expected", "as expected", "working", "ok", "correct", "verified"];

  const evaluate = async (id: string) => {
    const row = rows.find(r => r.id === id);
    if (!row || !row.actualResult.trim()) return;

    let finalStatus: TestStatus = "Pending";

    // Try LLM evaluation first
    if (getLlmConfig()?.apiKey) {
      setEvaluating(prev => new Set(prev).add(id));
      try {
        const result = await evaluateResult(row.expectedResult, row.actualResult);
        finalStatus = result.status as TestStatus;
        const patch = { status: finalStatus, reason: result.reason };
        setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
        if (boardIdRef.current) emitRowUpdate(boardIdRef.current, id, patch);
        emitActivity(`evaluated ${id}`, `${result.status} — ${result.reason?.slice(0, 60)}`, boardIdRef.current || undefined);
      } catch {
        // fallback to keyword
        const actual = row.actualResult.toLowerCase().trim();
        const pass = PASS_KEYWORDS.some(k => actual === k || actual.includes(k));
        finalStatus = (pass ? "Pass" : "Fail") as TestStatus;
        const patch = { status: finalStatus };
        setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
        if (boardIdRef.current) emitRowUpdate(boardIdRef.current, id, patch);
      } finally {
        setEvaluating(prev => { const n = new Set(prev); n.delete(id); return n; });
      }
    } else {
      const actual = row.actualResult.toLowerCase().trim();
      const expected = row.expectedResult.toLowerCase().trim();
      const pass = PASS_KEYWORDS.some(k => actual === k || actual.includes(k)) || actual === expected;
      finalStatus = (pass ? "Pass" : "Fail") as TestStatus;
      setRows(prev => prev.map(r => r.id === id ? { ...r, status: finalStatus } : r));
      if (boardIdRef.current) emitRowUpdate(boardIdRef.current, id, { status: finalStatus });
      emitActivity(`evaluated ${id}`, finalStatus, boardIdRef.current || undefined);
    }

    // Persist result to localStorage immediately using the known finalStatus
    if (finalStatus !== "Pending") setExecResult(id, finalStatus);
    setRows(prev => {
      saveExec({ inputId, execKey, boardId: boardIdRef.current, rows: prev, createdBugs });
      return prev;
    });
    if (finalStatus !== "Pending") {
      try {
        await updateTestStatus(id, finalStatus as "Pass" | "Fail");
        if (execKey.trim()) {
          await updateTestExecutionStatus(execKey.trim(), id, finalStatus as "Pass" | "Fail").catch(() => {});
        }
      } catch (err: any) {
        console.warn(`Auto status update failed for ${id}:`, err.message);
      }
    }
  };

  const executeAll = async () => {
    for (const row of rows.filter(r => r.actualResult.trim())) {
      await evaluate(row.id);
    }
  };

  const handleUpdateTestPlan = async () => {
    const evaluated = rows.filter(r => r.status !== "Pending" && r.actualResult.trim());
    if (evaluated.length === 0) { setError("Evaluate test cases first before updating the test plan."); return; }
    setUpdatingPlan(true); setPlanUpdateStatus(null);
    try {
      await Promise.all(evaluated.map(async r => {
        // Update Jira issue status
        await updateTestStatus(r.id, r.status as "Pass" | "Fail");
        if (execKey.trim()) {
          await updateTestExecutionStatus(execKey.trim(), r.id, r.status as "Pass" | "Fail").catch(() => {});
        }
      }));
      setPlanUpdateStatus({ success: true, msg: `${evaluated.length} test case${evaluated.length !== 1 ? "s" : ""} updated in Jira - ${evaluated.filter(r => r.status === "Pass").length} Passed, ${evaluated.filter(r => r.status === "Fail").length} Failed${execKey ? " · Xray Test Execution updated" : ""}.` });
    } catch (err: any) {
      setPlanUpdateStatus({ success: false, msg: err.message });
    } finally { setUpdatingPlan(false); }
  };

  const openBugModal = async (row: ExecRow) => {
    let steps = [
      `Navigate to the feature: ${row.summary}`,
      `Execute the test scenario as per test case ${row.id}`,
      `Observe the actual behavior of the application`
    ];

    // Use LLM to generate proper steps to reproduce if available
    if (getLlmConfig()?.apiKey) {
      try {
        const llm = getLlmConfig();
        const res = await fetch("http://localhost:3001/llm/generate-steps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            summary: row.summary,
            expectedResult: row.expectedResult,
            actualResult: row.actualResult,
            llmConfig: { model: llm.llm, apiKey: llm.apiKey, endpoint: llm.endpoint, provider: llm.provider || "groq" }
          })
        });
        const data = await res.json();
        if (data.steps?.length > 0) steps = data.steps;
      } catch { /* use default steps */ }
    }

    setBugModal({
      open: true,
      bug: {
        title: (() => {
          const actual = row.actualResult.trim();
          const firstSentence = actual ? actual.split(/[.\n]/)[0].trim().slice(0, 80) : "";
          return firstSentence ? `[${row.id}] ${firstSentence}` : `[${row.id}] ${row.summary.slice(0, 70)}`;
        })(),
        description: `Bug Summary\n-----------\nTest case ${row.id} failed during QA execution. The feature under test did not behave as specified.\n\nTest Case: ${row.id}\nTest Summary: ${row.summary}\n\nObserved Behaviour:\n${row.actualResult || "See actual result field."}\n\nExpected Behaviour:\n${row.expectedResult || "See expected result field."}\n\nImpact:\nThis defect may affect the functionality described in the linked user story and should be reviewed and prioritised accordingly.`,
        steps,
        expectedResult: row.expectedResult,
        actualResult: row.actualResult,
        severity: "High",
        testCaseId: row.id,
        userStoryId: ""
      }
    });
  };

  const confirmBug = async (updatedBug: BugReport) => {
    setBugLoading(true);
    try {
      const res = await createBug(updatedBug);
      setCreatedBugs(prev => {
        const next = { ...prev, [updatedBug.testCaseId]: res };
        saveExec({ inputId, execKey, boardId: boardIdRef.current, rows, createdBugs: next });
        return next;
      });
      setBugModal({ open: false, bug: null });
    } catch (err: any) {
      setError(err.message);
      setBugModal({ open: false, bug: null });
    } finally { setBugLoading(false); }
  };

  const passCount = rows.filter(r => r.status === "Pass").length;
  const failCount = rows.filter(r => r.status === "Fail").length;
  const pendingCount = rows.filter(r => r.status === "Pending").length;

  if (!connected) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Test Execution" subtitle="" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <div className="text-4xl mb-4">🔌</div>
            <h2 className="text-base font-semibold text-[#1e293b] mb-2">Not connected to Jira</h2>
            <p className="text-sm text-[#64748b] mb-4">Configure your Jira credentials in Settings to load test cases.</p>
            <a href="/settings" className="btn-primary inline-block">Go to Settings</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div>
        <Header
          title="Test Execution"
          subtitle={(location.state as any)?.folderName ? `Executing: ${(location.state as any).folderName}` : ""}
          actions={boardIdRef.current ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#006644] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#36B37E] animate-pulse" />
                Live Board
                {boardPeers > 0 && <span className="font-semibold">· {boardPeers + 1} users</span>}
              </span>

            </div>
          ) : undefined}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {error && (
          <div className="banner-error justify-between">
            <span>✗ {error}</span>
            <button onClick={() => setError(null)} className="text-[#ff5630] hover:text-[#bf2600]">×</button>
          </div>
        )}

        {/* Test Plan + Test Execution inputs */}
        <div className="card">
          <h2 className="text-xs font-semibold text-[#475569] uppercase tracking-wide mb-3">Load Test Cases</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">Test Plan ID</label>
              <input
                className="input-field"
                placeholder="Test Plan ID or Jira URL"
                value={inputId}
                onChange={e => setInputId(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleFetchTestCases()}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">Test Execution ID</label>
              <input
                className="input-field"
                placeholder="Test Execution ID or Jira URL"
                value={execKey}
                onChange={e => setExecKey(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleFetchTestCases()}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button className="btn-primary" onClick={handleFetchTestCases} disabled={loading}>
              {loading ? "Loading…" : "Fetch Test Cases"}
            </button>
            {rows.length > 0 && (
              <div className="flex gap-4">
                <span className="text-xs text-[#64748b]">Total: <strong>{rows.length}</strong></span>
                <span className="text-xs text-[#006644]">Pass: <strong>{passCount}</strong></span>
                <span className="text-xs text-[#bf2600]">Fail: <strong>{failCount}</strong></span>
                <span className="text-xs text-[#974f0c]">Pending: <strong>{pendingCount}</strong></span>
                {getXrayCredentials()?.clientId && (
                  <span className="text-xs text-[#0e7490]">Xray connected</span>
                )}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-[#64748b] py-10 text-center">Loading test cases from Jira…</div>
        ) : rows.length === 0 && !loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg className="w-6 h-6 text-[#94a3b8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <p className="empty-state-title">No test cases loaded</p>
            <p className="empty-state-desc">Enter a Test Plan ID and Test Execution ID above, then click Fetch Test Cases to begin execution.</p>
            <div className="mt-5 flex items-center gap-6 text-xs text-[#94a3b8]">
              <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-[#ecfeff] text-[#0e7490] flex items-center justify-center font-bold text-[10px]">1</span> Enter Test Plan ID</div>
              <svg className="w-3 h-3 text-[#cbd5e1]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
              <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-[#ecfeff] text-[#0e7490] flex items-center justify-center font-bold text-[10px]">2</span> Enter Execution ID</div>
              <svg className="w-3 h-3 text-[#cbd5e1]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
              <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-[#ecfeff] text-[#0e7490] flex items-center justify-center font-bold text-[10px]">3</span> Fetch &amp; Execute</div>
            </div>
          </div>
        ) : rows.length > 0 ? (
          <div className="card p-0 overflow-hidden">
            <div className="px-5 py-3 border-b border-[#e2e8f0] flex items-center justify-between">
              <span className="text-sm font-semibold text-[#1e293b]">
                Execution Table <span className="text-[#94a3b8] font-normal">({rows.length})</span>
              </span>
              <div className="flex gap-2 items-center">
                {planUpdateStatus && (
                  <span className={`text-xs font-medium ${planUpdateStatus.success ? "text-[#006644]" : "text-[#bf2600]"}`}>
                    {planUpdateStatus.success ? "✓" : "✗"} {planUpdateStatus.msg}
                  </span>
                )}
                {rows.some(r => r.status !== "Pending") && (
                  <button
                    className="btn-secondary text-xs py-1.5 px-3"
                    onClick={handleUpdateTestPlan}
                    disabled={updatingPlan}
                  >
                    {updatingPlan ? "Updating…" : "⬆ Update Test Plan"}
                  </button>
                )}
                <button
                  className="btn-primary text-xs py-1.5 px-3"
                  onClick={executeAll}
                  disabled={rows.every(r => !r.actualResult.trim())}
                >
                  Execute All
                </button>
              </div>
            </div>
            <div className="overflow-x-auto" style={{ maxHeight: "60vh", overflowY: "auto" }}>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-th">ID</th>
                    <th className="table-th">Title</th>
                    <th className="table-th">Expected Result</th>
                    <th className="table-th">Actual Result</th>
                    <th className="table-th">Status</th>
                    <th className="table-th">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const bug = createdBugs[row.id];
                    return (
                      <tr key={row.id} className={`hover:bg-[#f0f4f8] transition-colors ${row.status === "Fail" ? "bg-[#ffebe6]/30" : row.status === "Pass" ? "bg-[#e3fcef]/30" : ""} ${editingRows[row.id] ? "ring-2 ring-inset ring-[#22d3ee]/300/60" : ""}`}>
                        <td className="table-td">
                          <a href={row.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-[#0e7490] hover:underline">{row.id}</a>
                          {editingRows[row.id] && (
                            <div className="flex items-center gap-1 mt-1">
                              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: editingRows[row.id].color }} />
                              <span className="text-[10px] text-[#94a3b8]">{editingRows[row.id].name}</span>
                            </div>
                          )}
                        </td>
                        <td className="table-td font-medium text-[#1e293b] max-w-[160px]">
                          <span className="line-clamp-2 text-xs">{row.summary}</span>
                        </td>
                        <td className="table-td min-w-[200px] max-w-[240px]">
                          <div className="space-y-1">
                            {row.expectedPoints.map((point, i) => (
                              <div key={i} className="text-xs text-[#475569] bg-[#F4F5F7] border border-[#DFE1E6] rounded px-2 py-1.5">
                                <span className="text-[#97A0AF] font-medium mr-1">{i + 1}.</span>{point}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="table-td min-w-[280px]">
                          <div className="space-y-2">
                            <div className="relative">
                              <textarea
                                className={`w-full text-xs rounded border-2 px-3 py-2.5 resize-y focus:outline-none transition-colors font-[inherit] leading-relaxed ${
                                  row.status === "Fail"
                                    ? "border-[#FFBDAD] bg-[#FFFAFA] focus:border-[#DE350B]"
                                    : row.status === "Pass"
                                    ? "border-[#ABF5D1] bg-[#F6FFFA] focus:border-[#006644]"
                                    : "border-[#DFE1E6] bg-[#FAFBFC] focus:border-[#0052CC] hover:bg-white"
                                }`}
                                rows={7}
                                placeholder="Describe what actually happened during test execution…"
                                value={row.actualResult}
                                onChange={e => {
                                  const patch = { actualResult: e.target.value, status: "Pending" as TestStatus };
                                  setRows(prev => {
                                    const next = prev.map(r => r.id === row.id ? { ...r, ...patch } : r);
                                    saveExec({ inputId, execKey, boardId: boardIdRef.current, rows: next, createdBugs });
                                    return next;
                                  });
                                  if (boardIdRef.current) emitRowUpdate(boardIdRef.current, row.id, patch);
                                }}
                              />
                              {row.actualResult.trim() && (
                                <span className="absolute bottom-2 right-2 text-[10px] text-[#97A0AF] pointer-events-none">
                                  {row.actualResult.length} chars
                                </span>
                              )}
                            </div>
                            {row.actualResult.trim() && getLlmConfig()?.apiKey && (
                              <button
                                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded border text-xs font-semibold transition-all ${
                                  refining.has(row.id)
                                    ? "border-[#B3D4FF] bg-[#DEEBFF] text-[#0052CC] cursor-wait"
                                    : "border-[#B3D4FF] bg-[#DEEBFF] text-[#0052CC] hover:bg-[#0052CC] hover:text-white hover:border-[#0052CC] hover:shadow-md"
                                }`}
                                style={!refining.has(row.id) ? { boxShadow: "0 0 0 0 rgba(0,82,204,0)" } : {}}
                                disabled={refining.has(row.id)}
                                onClick={() => refineActualResult(row.id)}
                              >
                                {refining.has(row.id) ? (
                                  <>
                                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                    </svg>
                                    Refining…
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                                    </svg>
                                    AI Refine
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="table-td">
                          <span className={row.status === "Pass" ? "badge-pass" : row.status === "Fail" ? "badge-fail" : "badge-pending"}>
                            {row.status}
                          </span>
                        </td>
                        <td className="table-td">
                          <div className="flex flex-col gap-1">
                            <div className="flex gap-2 items-center flex-wrap">
                              <button
                                className="btn-primary py-1 px-3 text-xs"
                                disabled={!row.actualResult.trim() || evaluating.has(row.id)}
                                onClick={() => evaluate(row.id)}
                              >
                                {evaluating.has(row.id) ? "Evaluating…" : "Evaluate"}
                              </button>
                              {row.status === "Fail" && (
                                bug ? (
                                  <a href={bug.url} target="_blank" rel="noreferrer"
                                    className="text-xs text-[#bf2600] font-medium bg-[#ffebe6] border border-[#ffbdad] px-2 py-1 rounded hover:bg-[#ffebe6]">
                                    {bug.key} ↗
                                  </a>
                                ) : (
                                  <button className="btn-danger py-1 px-3 text-xs" onClick={() => openBugModal(row)}>
                                    Create Bug
                                  </button>
                                )
                              )}
                            </div>
                            {row.reason && (
                              <p className="text-xs text-[#64748b] italic">{row.reason}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Clear board — bottom */}
            <div className="px-5 py-3 border-t border-[#DFE1E6] flex items-center justify-between" style={{ backgroundColor: "#F4F5F7" }}>
              <span className="text-xs" style={{ color: "#97A0AF" }}>
                {rows.length} test cases · <span style={{ color: "#006644" }}>{passCount} passed</span> · <span style={{ color: "#BF2600" }}>{failCount} failed</span> · {pendingCount} pending
              </span>
              <button
                className="btn-secondary text-xs flex items-center gap-1.5"
                onClick={() => { if (boardIdRef.current && window.confirm("Reset board? This clears all progress for all users.")) { emitResetBoard(boardIdRef.current); setRows([]); setCreatedBugs({}); sessionStorage.removeItem(EXEC_KEY); } }}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
                Reset Board
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {bugModal.open && bugModal.bug && (
        <BugModal bug={bugModal.bug} onConfirm={confirmBug} onClose={() => setBugModal({ open: false, bug: null })} loading={bugLoading} />
      )}
    </div>
  );
};

export default Execution;
