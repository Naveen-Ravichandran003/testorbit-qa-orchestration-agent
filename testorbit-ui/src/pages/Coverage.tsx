import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import Header from "../components/Header";
import { getCredentials, fetchSprints, fetchSprintCoverage } from "../jiraService";

interface Sprint { id: number; name: string; state: string; startDate?: string; endDate?: string; }
interface StoryCoverage {
  id: string; summary: string; status: string; type: string;
  totalTests: number; passed: number; failed: number; pending: number; openBugs: number;
  tests: any[]; bugs: any[];
}
interface Summary {
  totalStories: number; storiesWithTests: number; storiesWithoutTests: number;
  totalTests: number; totalPassed: number; totalFailed: number; totalPending: number;
  totalBugs: number; openBugs: number; passRate: number;
}

const STATE_COLORS: Record<string, string> = { active: "#ffffff", closed: "#ffffff", future: "#94A3B8" };

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#e2e8f0] rounded px-3 py-2">
      <p className="text-xs font-semibold text-[#1e293b]">{payload[0].name}</p>
      <p className="text-xs text-[#64748b]">{payload[0].value}</p>
    </div>
  );
};

const Coverage: React.FC = () => {
  const connected = !!getCredentials();
  const navigate = useNavigate();
  const creds = getCredentials();

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedSprint, setSelectedSprint] = useState<Sprint | null>(null);
  const [coverage, setCoverage] = useState<{ summary: Summary; stories: StoryCoverage[]; unlinkedBugs: any[] } | null>(null);
  const [loadingSprints, setLoadingSprints] = useState(false);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedStory, setExpandedStory] = useState<string | null>(null);
  const [coverageFilter, setCoverageFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || !creds?.projectKey) return;
    setLoadingSprints(true);
    fetchSprints(creds.projectKey)
      .then(data => {
        setSprints(data);
        // Auto-select active sprint
        const active = data.find((s: Sprint) => s.state === "active") || data[0];
        if (active) setSelectedSprint(active);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoadingSprints(false));
  }, []);

  useEffect(() => {
    if (!selectedSprint || !creds?.projectKey) return;
    setLoadingCoverage(true); setCoverage(null); setError(null);
    fetchSprintCoverage(creds.projectKey, selectedSprint.id)
      .then(data => setCoverage(data))
      .catch(err => setError(err.message))
      .finally(() => setLoadingCoverage(false));
  }, [selectedSprint]);

  if (!connected) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Test Coverage" subtitle="Sprint-wise coverage analysis" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <div className="text-4xl mb-4">🔌</div>
            <h2 className="text-base font-semibold text-[#1e293b] mb-2">Not connected to Jira</h2>
            <p className="text-sm text-[#64748b] mb-4">Configure your Jira credentials in Settings.</p>
            <a href="/settings" className="btn-primary inline-block">Go to Settings</a>
          </div>
        </div>
      </div>
    );
  }

  const s = coverage?.summary;

  const testPieData = s ? [
    { name: "Passed",  value: s.totalPassed,  color: "#10B981" },
    { name: "Failed",  value: s.totalFailed,  color: "#EF4444" },
    { name: "Pending", value: s.totalPending, color: "#CBD5E1" },
  ].filter(d => d.value > 0) : [];

  const coveragePieData = s ? [
    { name: "Covered",   value: s.storiesWithTests,    color: "#6366F1" },
    { name: "Uncovered", value: s.storiesWithoutTests, color: "#E2E8F0" },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div>
        <Header title="Test Coverage" subtitle={`Sprint-wise QA coverage - ${creds?.projectKey}`} />
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {error && (
          <div className="banner-error justify-between">
            <span>✗ {error}</span>
            <button onClick={() => setError(null)} className="text-[#ff5630] hover:text-[#bf2600]">×</button>
          </div>
        )}

        {/* Sprint selector */}
        <div className="card px-4 py-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs font-bold text-[#64748b] uppercase tracking-wide flex-shrink-0">Sprint</span>
            {loadingSprints ? (
              <div className="flex items-center gap-2 text-xs text-[#94a3b8]">
                <div className="w-3.5 h-3.5 border-2 border-[#0e7490] border-t-transparent rounded-full animate-spin" />
                Loading sprints…
              </div>
            ) : sprints.length === 0 ? (
              <span className="text-xs text-[#94a3b8]">No sprints found for {creds?.projectKey}</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sprints.map(sprint => (
                  <button
                    key={sprint.id}
                    onClick={() => setSelectedSprint(sprint)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-all ${
                      selectedSprint?.id === sprint.id
                        ? "bg-[#0e7490] text-white border-[#0e7490]"
                        : "bg-white text-[#475569] border-[#e2e8f0] hover:border-[#22d3ee] hover:text-[#0e7490]"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: selectedSprint?.id === sprint.id ? "white" : STATE_COLORS[sprint.state] }} />
                    {sprint.name}
                    {sprint.state === "active" && (
                      <span className={`text-[10px] font-bold px-1 rounded ${selectedSprint?.id === sprint.id ? "bg-white/20 text-white" : "bg-[#e3fcef] text-[#006644]"}`}>LIVE</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {loadingCoverage ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 text-sm text-[#64748b]">
              <div className="w-5 h-5 border-2 border-[#0e7490] border-t-transparent rounded-full animate-spin" />
              Analysing sprint coverage…
            </div>
          </div>
        ) : coverage && s ? (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {[
                { label: "Stories",          value: s.totalStories,        color: "text-[#1e293b]",    bg: "bg-[#f0f4f8]",    border: "border-[#e2e8f0]" },
                { label: "Tests Generated",  value: s.totalTests,          color: "text-[#0e7490]",   bg: "bg-[#ecfeff]",   border: "border-[#a5f3fc]" },
                { label: "Passed",           value: s.totalPassed,         color: "text-[#006644]",  bg: "bg-[#e3fcef]",  border: "border-[#abf5d1]" },
                { label: "Failed",           value: s.totalFailed,         color: "text-[#de350b]",      bg: "bg-[#ffebe6]",      border: "border-[#ffbdad]" },
                { label: "Bugs Raised",      value: s.totalBugs,           color: "text-[#974f0c]",    bg: "bg-[#fffae6]",    border: "border-amber-100" },
              ].map(m => (
                <div key={m.label} className={`bg-white border ${m.border} rounded p-4`}>
                  <div className={`w-7 h-7 rounded ${m.bg} border ${m.border} flex items-center justify-center mb-3`}>
                    <div className={`w-2 h-2 rounded-full ${m.color.replace("text-", "bg-")}`} />
                  </div>
                  <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
                  <div className="text-xs text-[#94a3b8] font-medium mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>

            {/* Sprint Report */}
            <div className="card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#f1f5f9] flex items-center gap-2.5">
                <div className="w-1 h-4 bg-[#6366F1] rounded-full" />
                <h2 className="text-sm font-semibold text-[#1e293b]">Sprint Report</h2>
                <span className="text-xs text-[#94a3b8] bg-[#f0f4f8] px-2 py-0.5 rounded-full border border-[#f1f5f9]">{selectedSprint?.name}</span>
                {selectedSprint?.state === "active" && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#e3fcef] text-[#006644] border border-[#abf5d1]">LIVE</span>
                )}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-[#f1f5f9]">
                {[
                  {
                    label: "Test Cases Generated",
                    value: s.totalTests,
                    sub: `${s.storiesWithTests} of ${s.totalStories} stories covered`,
                    icon: (
                      <svg className="w-4 h-4 text-[#0e7490]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
                    ),
                    bg: "bg-[#ecfeff]", border: "border-[#a5f3fc]", text: "text-[#0e7490]",
                  },
                  {
                    label: "Bugs Raised",
                    value: s.totalBugs,
                    sub: `${s.openBugs} open · ${s.totalBugs - s.openBugs} resolved`,
                    icon: (
                      <svg className="w-4 h-4 text-[#de350b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    ),
                    bg: "bg-[#ffebe6]", border: "border-[#ffbdad]", text: "text-[#de350b]",
                  },
                  {
                    label: "Pass Rate",
                    value: `${s.passRate}%`,
                    sub: `${s.totalPassed} passed · ${s.totalFailed} failed`,
                    icon: (
                      <svg className="w-4 h-4 text-[#006644]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    ),
                    bg: "bg-[#e3fcef]", border: "border-[#abf5d1]", text: s.passRate >= 80 ? "text-[#006644]" : s.passRate >= 50 ? "text-[#974f0c]" : "text-[#de350b]",
                  },
                  {
                    label: "Coverage",
                    value: `${s.totalStories > 0 ? Math.round((s.storiesWithTests / s.totalStories) * 100) : 0}%`,
                    sub: `${s.storiesWithoutTests} stories uncovered`,
                    icon: (
                      <svg className="w-4 h-4 text-[#6366F1]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                    ),
                    bg: "bg-[#f5f3ff]", border: "border-[#ddd6fe]", text: "text-[#6366F1]",
                  },
                ].map(m => (
                  <div key={m.label} className="px-5 py-4 flex flex-col gap-3">
                    <div className={`w-8 h-8 rounded-lg ${m.bg} border ${m.border} flex items-center justify-center`}>{m.icon}</div>
                    <div>
                      <div className={`text-2xl font-bold ${m.text}`}>{m.value}</div>
                      <div className="text-xs font-semibold text-[#1e293b] mt-0.5">{m.label}</div>
                      <div className="text-[11px] text-[#94a3b8] mt-0.5">{m.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Progress bars */}
              <div className="px-5 py-3 border-t border-[#f1f5f9] grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-[#64748b] font-medium">Test Execution</span>
                    <span className="text-[11px] text-[#64748b] tabular-nums">{s.totalPassed}/{s.totalTests}</span>
                  </div>
                  <div className="h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden flex gap-px">
                    {s.totalPassed  > 0 && <div className="bg-[#10b981] transition-all" style={{ flex: s.totalPassed }} />}
                    {s.totalFailed  > 0 && <div className="bg-[#ef4444] transition-all" style={{ flex: s.totalFailed }} />}
                    {s.totalPending > 0 && <div className="bg-[#e2e8f0] transition-all" style={{ flex: s.totalPending }} />}
                  </div>
                  <div className="flex gap-3 mt-1.5">
                    <span className="text-[10px] text-[#006644]">● {s.totalPassed} Passed</span>
                    <span className="text-[10px] text-[#de350b]">● {s.totalFailed} Failed</span>
                    <span className="text-[10px] text-[#94a3b8]">● {s.totalPending} Pending</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-[#64748b] font-medium">Story Coverage</span>
                    <span className="text-[11px] text-[#64748b] tabular-nums">{s.storiesWithTests}/{s.totalStories}</span>
                  </div>
                  <div className="h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden flex gap-px">
                    {s.storiesWithTests    > 0 && <div className="bg-[#6366F1] transition-all" style={{ flex: s.storiesWithTests }} />}
                    {s.storiesWithoutTests > 0 && <div className="bg-[#e2e8f0] transition-all" style={{ flex: s.storiesWithoutTests }} />}
                  </div>
                  <div className="flex gap-3 mt-1.5">
                    <span className="text-[10px] text-[#6366F1]">● {s.storiesWithTests} Covered</span>
                    <span className="text-[10px] text-[#94a3b8]">● {s.storiesWithoutTests} Uncovered</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Pie charts */}
            <div className="grid grid-cols-2 gap-5">
              {/* Coverage pie */}
              <div className="card p-5">
                <p className="text-xs font-bold text-[#64748b] uppercase tracking-wide mb-4">Story Coverage</p>
                <div className="flex items-center gap-6">
                  <div className="w-40 h-40 flex-shrink-0 relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={coveragePieData} cx="50%" cy="50%" innerRadius={42} outerRadius={66} paddingAngle={3} dataKey="value">
                          {coveragePieData.map((e, i) => <Cell key={i} fill={e.color} stroke="none" />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xl font-bold text-[#0e7490]">
                        {s.totalStories > 0 ? Math.round((s.storiesWithTests / s.totalStories) * 100) : 0}%
                      </span>
                      <span className="text-[10px] text-[#94a3b8]">covered</span>
                    </div>
                  </div>
                  <div className="space-y-3 flex-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm bg-[#6366F1]" />
                        <span className="text-xs text-[#475569]">Covered</span>
                      </div>
                      <span className="text-xs font-semibold text-[#1e293b]">{s.storiesWithTests} stories</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm bg-[#e2e8f0]" />
                        <span className="text-xs text-[#475569]">Uncovered</span>
                      </div>
                      <span className="text-xs font-bold text-[#de350b]">{s.storiesWithoutTests} stories</span>
                    </div>
                    {s.storiesWithoutTests > 0 && (
                      <div className="mt-2 p-2 bg-[#ffebe6] border border-[#ffbdad] rounded">
                        <p className="text-[11px] text-[#bf2600] font-medium">⚠ {s.storiesWithoutTests} stor{s.storiesWithoutTests === 1 ? "y has" : "ies have"} no test cases</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Execution pie */}
              <div className="card p-5">
                <p className="text-xs font-bold text-[#64748b] uppercase tracking-wide mb-4">Execution Status</p>
                <div className="flex items-center gap-6">
                  <div className="w-40 h-40 flex-shrink-0 relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={testPieData} cx="50%" cy="50%" innerRadius={42} outerRadius={66} paddingAngle={3} dataKey="value">
                          {testPieData.map((e, i) => <Cell key={i} fill={e.color} stroke="none" />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className={`text-xl font-bold ${s.passRate >= 80 ? "text-[#006644]" : s.passRate >= 50 ? "text-[#974f0c]" : "text-[#de350b]"}`}>{s.passRate}%</span>
                      <span className="text-[10px] text-[#94a3b8]">pass rate</span>
                    </div>
                  </div>
                  <div className="space-y-3 flex-1">
                    {[
                      { label: "Passed",  value: s.totalPassed,  color: "bg-[#10B981]",  text: "text-[#006644]" },
                      { label: "Failed",  value: s.totalFailed,  color: "bg-red-400",     text: "text-[#de350b]" },
                      { label: "Pending", value: s.totalPending, color: "bg-[#e2e8f0]",   text: "text-[#94a3b8]" },
                    ].map(r => (
                      <div key={r.label} className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-sm ${r.color}`} />
                        <span className="text-xs text-[#475569] flex-1">{r.label}</span>
                        <span className={`text-xs font-bold ${r.text}`}>{r.value}</span>
                      </div>
                    ))}
                    <div className="pt-1 border-t border-[#f1f5f9]">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm bg-[#ff991f]" />
                        <span className="text-xs text-[#475569] flex-1">Open Bugs</span>
                        <span className="text-xs font-bold text-[#974f0c]">{s.openBugs}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Coverage by Story */}
            {(() => {
              const tiers = [
                { key: "none",   label: "No Coverage",  desc: "0 test cases",      bar: "bg-[#ef4444]", badge: "bg-[#ffebe6] text-[#bf2600] border-[#ffbdad]", count: coverage.stories.filter(x => x.totalTests === 0).length },
                { key: "low",    label: "Low Coverage",  desc: "1–2 test cases",    bar: "bg-[#f59e0b]", badge: "bg-[#fffae6] text-[#974f0c] border-[#ffe380]", count: coverage.stories.filter(x => x.totalTests >= 1 && x.totalTests <= 2).length },
                { key: "medium", label: "Moderate Coverage", desc: "3–5 test cases", bar: "bg-[#0e7490]", badge: "bg-[#ecfeff] text-[#0e7490] border-[#a5f3fc]",  count: coverage.stories.filter(x => x.totalTests >= 3 && x.totalTests <= 5).length },
                { key: "good",   label: "Good Coverage", desc: "6+ test cases",     bar: "bg-[#10b981]", badge: "bg-[#e3fcef] text-[#006644] border-[#abf5d1]", count: coverage.stories.filter(x => x.totalTests > 5).length },
              ];
              const total = coverage.stories.length || 1;
              return (
                <div className="card overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[#f1f5f9] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-1 h-4 bg-[#6366F1] rounded-full" />
                      <h2 className="text-sm font-semibold text-[#1e293b]">Coverage by Story</h2>
                      <span className="text-xs text-[#94a3b8] bg-[#f0f4f8] px-2 py-0.5 rounded-full border border-[#f1f5f9]">{coverage.stories.length} stories</span>
                    </div>
                    {coverageFilter && (
                      <button onClick={() => setCoverageFilter(null)} className="text-xs text-[#64748b] hover:text-[#1e293b] flex items-center gap-1 px-2 py-1 rounded hover:bg-[#f1f5f9] transition-colors">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                        Clear filter
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-[#f1f5f9]">
                    {tiers.map(tier => {
                      const pct = Math.round((tier.count / total) * 100);
                      const isActive = coverageFilter === tier.key;
                      return (
                        <button
                          key={tier.key}
                          onClick={() => setCoverageFilter(isActive ? null : tier.key)}
                          className={`w-full flex items-center gap-4 px-5 py-3.5 text-left transition-colors ${
                            isActive ? "bg-[#f0f4f8]" : "hover:bg-[#fafafa]"
                          }`}
                        >
                          <div className="w-32 flex-shrink-0">
                            <div className="text-xs font-semibold text-[#1e293b]">{tier.label}</div>
                            <div className="text-[11px] text-[#94a3b8] mt-0.5">{tier.desc}</div>
                          </div>
                          <div className="flex-1 flex items-center gap-3">
                            <div className="flex-1 h-2 bg-[#f1f5f9] rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-500 ${tier.bar}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-[#64748b] tabular-nums w-8 text-right">{pct}%</span>
                          </div>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded border min-w-[2.5rem] text-center ${tier.badge}`}>
                            {tier.count} {tier.count === 1 ? "story" : "stories"}
                          </span>
                          {isActive && (
                            <svg className="w-3.5 h-3.5 text-[#0e7490] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Story breakdown table */}
            <div className="card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#f1f5f9] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-1 h-4 bg-[#0e7490] rounded-full" />
                  <h2 className="text-sm font-semibold text-[#1e293b]">Story Breakdown</h2>
                  <span className="text-xs text-[#94a3b8] bg-[#f0f4f8] px-2 py-0.5 rounded-full border border-[#f1f5f9]">{coverage.stories.length} stories</span>
                </div>
                {s.storiesWithoutTests > 0 && (
                  <span className="text-xs font-semibold text-[#bf2600] bg-[#ffebe6] border border-[#ffbdad] px-2.5 py-1 rounded">
                    ⚠ {s.storiesWithoutTests} uncovered
                  </span>
                )}
              </div>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-th w-8"></th>
                    <th className="table-th">Story</th>
                    <th className="table-th">Summary</th>
                    <th className="table-th">Tests</th>
                    <th className="table-th">Pass / Fail</th>
                    <th className="table-th">Pass Rate</th>
                    <th className="table-th">Bugs</th>
                    <th className="table-th">Coverage</th>
                    <th className="table-th">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.stories.filter(story => {
                    if (!coverageFilter) return true;
                    if (coverageFilter === "none")   return story.totalTests === 0;
                    if (coverageFilter === "low")    return story.totalTests >= 1 && story.totalTests <= 2;
                    if (coverageFilter === "medium") return story.totalTests >= 3 && story.totalTests <= 5;
                    if (coverageFilter === "good")   return story.totalTests > 5;
                    return true;
                  }).map(story => {
                    const isExpanded = expandedStory === story.id;
                    const coverageLevel = story.totalTests === 0 ? "none" : story.totalTests <= 2 ? "low" : story.totalTests <= 5 ? "medium" : "good";
                    const coverageBadge = {
                      none:   "bg-[#ffebe6] text-[#bf2600] border-[#ffbdad]",
                      low:    "bg-[#fffae6] text-[#974f0c] border-[#ffe380]",
                      medium: "bg-[#ecfeff] text-[#0e7490] border-[#a5f3fc]",
                      good:   "bg-[#e3fcef] text-[#006644] border-[#abf5d1]",
                    }[coverageLevel];
                    const coverageLabel = { none: "No Tests", low: "Low", medium: "Medium", good: "Good" }[coverageLevel];
                    const passRate = story.totalTests > 0 ? Math.round((story.passed / story.totalTests) * 100) : 0;

                    return (
                      <React.Fragment key={story.id}>
                        <tr className={`hover:bg-[#f0f4f8] transition-colors ${isExpanded ? "bg-[#ecfeff]/30" : ""}`}>
                          <td className="table-td w-8">
                            {story.totalTests > 0 && (
                              <button
                                onClick={() => setExpandedStory(isExpanded ? null : story.id)}
                                className={`w-5 h-5 flex items-center justify-center rounded transition-all ${isExpanded ? "bg-[#ecfeff] text-[#0e7490]" : "text-[#cbd5e1] hover:text-[#64748b] hover:bg-[#f1f5f9]"}`}
                              >
                                <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            )}
                          </td>
                          <td className="table-td">
                            <a href={`${creds?.jiraUrl}/browse/${story.id}`} target="_blank" rel="noreferrer"
                              className="font-mono text-xs text-[#0e7490] hover:underline font-semibold">{story.id}</a>
                          </td>
                          <td className="table-td max-w-[220px]">
                            <span className="text-xs text-[#1e293b] line-clamp-1">{story.summary}</span>
                          </td>
                          <td className="table-td">
                            <span className="text-xs font-semibold text-[#1e293b] tabular-nums">{story.totalTests}</span>
                          </td>
                          <td className="table-td">
                            {story.totalTests > 0 ? (
                              <div className="flex items-center gap-1.5">
                                <div className="flex h-1.5 w-20 bg-[#f1f5f9] rounded-full overflow-hidden">
                                  {story.passed  > 0 && <div className="bg-[#36b37e]" style={{ flex: story.passed }} />}
                                  {story.failed  > 0 && <div className="bg-red-400"     style={{ flex: story.failed }} />}
                                  {story.pending > 0 && <div className="bg-[#e2e8f0]"   style={{ flex: story.pending }} />}
                                </div>
                                <span className="text-[11px] text-[#64748b] tabular-nums">{story.passed}P {story.failed}F</span>
                              </div>
                            ) : <span className="text-[#cbd5e1] text-xs">—</span>}
                          </td>
                          <td className="table-td">
                            {story.totalTests > 0 ? (
                              <span className={`text-xs font-bold ${passRate >= 80 ? "text-[#006644]" : passRate >= 50 ? "text-[#974f0c]" : "text-[#de350b]"}`}>{passRate}%</span>
                            ) : <span className="text-[#cbd5e1] text-xs">—</span>}
                          </td>
                          <td className="table-td">
                            {story.openBugs > 0
                              ? <span className="text-xs font-bold text-[#de350b]">{story.openBugs} open</span>
                              : <span className="text-[#cbd5e1] text-xs">—</span>}
                          </td>
                          <td className="table-td">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${coverageBadge}`}>{coverageLabel}</span>
                          </td>
                          <td className="table-td">
                            <button
                              onClick={() => navigate("/generator", { state: { storyId: story.id } })}
                              className="text-xs text-[#0e7490] hover:text-[#0c5f75] hover:bg-[#ecfeff] px-2 py-1 rounded transition-colors font-medium"
                            >
                              {story.totalTests === 0 ? "+ Generate" : "+ More"}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-[#ecfeff]/20">
                            <td colSpan={9} className="px-8 py-3 border-b border-[#a5f3fc]/50">
                              <div className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest mb-2">Test Cases ({story.tests.length})</div>
                              <div className="space-y-1">
                                {story.tests.map((t: any) => (
                                  <div key={t.id} className="flex items-center gap-3">
                                    <a href={`${creds?.jiraUrl}/browse/${t.id}`} target="_blank" rel="noreferrer"
                                      className="font-mono text-[11px] text-[#0e7490] hover:underline w-20 flex-shrink-0">{t.id}</a>
                                    <span className="text-xs text-[#475569] flex-1 truncate">{t.summary}</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                      t.status === "Done" || t.status === "Passed" ? "bg-[#e3fcef] text-[#006644] border-[#abf5d1]" :
                                      t.status === "Failed" ? "bg-[#ffebe6] text-[#bf2600] border-[#ffbdad]" :
                                      "bg-[#fffae6] text-[#974f0c] border-[#ffe380]"
                                    }`}>{t.status || "Pending"}</span>
                                  </div>
                                ))}
                              </div>
                              {story.bugs.length > 0 && (
                                <>
                                  <div className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest mt-3 mb-2">Bugs ({story.bugs.length})</div>
                                  <div className="space-y-1">
                                    {story.bugs.map((b: any) => (
                                      <div key={b.id} className="flex items-center gap-3">
                                        <a href={`${creds?.jiraUrl}/browse/${b.id}`} target="_blank" rel="noreferrer"
                                          className="font-mono text-[11px] text-[#de350b] hover:underline w-20 flex-shrink-0">{b.id}</a>
                                        <span className="text-xs text-[#475569] flex-1 truncate">{b.summary}</span>
                                        <span className="text-[10px] font-bold text-[#de350b]">{b.priority}</span>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Uncovered stories alert */}
            {coverage.stories.filter(s => s.totalTests === 0).length > 0 && (
              <div className="bg-[#ffebe6] border border-[#ffbdad] rounded p-4">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-[#de350b] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  <span className="text-sm font-bold text-[#bf2600]">Stories with no test coverage</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {coverage.stories.filter(s => s.totalTests === 0).map(s => (
                    <button key={s.id}
                      onClick={() => navigate("/generator", { state: { storyId: s.id } })}
                      className="flex items-center gap-1.5 font-mono text-xs bg-white border border-[#ffbdad] text-[#bf2600] px-2.5 py-1 rounded hover:bg-[#de350b] hover:text-white transition-all"
                    >
                      {s.id} <span className="text-[10px] opacity-70">+ Generate</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : !loadingCoverage && !error && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg className="w-6 h-6 text-[#94a3b8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
            </div>
            <p className="empty-state-title">Select a sprint to view coverage</p>
            <p className="empty-state-desc">Choose a sprint above to see test coverage, pass rates, and bug counts per story.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Coverage;
