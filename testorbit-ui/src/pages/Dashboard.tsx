import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import Header from "../components/Header";
import { getCredentials } from "../jiraService";
import { useDataStore } from "../DataStore";

function getLlmConfig() {
  try { return JSON.parse(localStorage.getItem("testorbit_llm") || ""); } catch { return null; }
}

const LLM_LABELS: Record<string, string> = {
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
  "llama-3.1-8b-instant": "Llama 3.1 8B",
  "llama3-70b-8192": "Llama 3 70B",
  "llama3-8b-8192": "Llama 3 8B",
  "mixtral-8x7b-32768": "Mixtral 8x7B",
  "gemma2-9b-it": "Gemma 2 9B",
  "gemma-7b-it": "Gemma 7B",
  "grok-2": "Grok-2",
  "mistral-7b": "Mistral 7B"
};

// ── Coverage Heatmap with Pie Charts ───────────────────────────────────────
interface StoryRow {
  storyId: string;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  passRate: number;
  coverage: "none" | "low" | "medium" | "good";
}

function buildHeatmap(testCases: any[]): StoryRow[] {
  const map: Record<string, StoryRow> = {};
  testCases.forEach(tc => {
    const sid = tc.userStoryId || "Unlinked";
    if (!map[sid]) map[sid] = { storyId: sid, total: 0, passed: 0, failed: 0, pending: 0, passRate: 0, coverage: "none" };
    map[sid].total++;
    if (tc.status === "Passed") map[sid].passed++;
    else if (tc.status === "Failed") map[sid].failed++;
    else map[sid].pending++;
  });
  return Object.values(map).map(row => ({
    ...row,
    passRate: row.total > 0 ? Math.round((row.passed / row.total) * 100) : 0,
    coverage: (row.total === 0 ? "none" : row.total <= 2 ? "low" : row.total <= 5 ? "medium" : "good") as "none" | "low" | "medium" | "good"
  })).sort((a, b) => {
    // Sort by risk: failed first, then low coverage, then by total desc
    if (b.failed !== a.failed) return b.failed - a.failed;
    const coverageOrder: Record<string, number> = { none: 0, low: 1, medium: 2, good: 3 };
    if (coverageOrder[a.coverage] !== coverageOrder[b.coverage]) return coverageOrder[a.coverage] - coverageOrder[b.coverage];
    return b.total - a.total;
  });
}

const COVERAGE_META = {
  none:   { label: "No Coverage",  color: "#CBD5E1", badge: "bg-[#f1f5f9] text-[#64748b] border-[#e2e8f0]" },
  low:    { label: "Low",          color: "#FBBF24", badge: "bg-[#fffae6] text-[#974f0c] border-[#ffe380]" },
  medium: { label: "Medium",       color: "#60A5FA", badge: "bg-[#ecfeff] text-[#0e7490] border-[#a5f3fc]" },
  good:   { label: "Good",         color: "#10B981", badge: "bg-[#e3fcef] text-[#006644] border-[#86efac]" },
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#e2e8f0] rounded px-3 py-2">
      <p className="text-xs font-semibold text-[#1e293b]">{payload[0].name}</p>
      <p className="text-xs text-[#64748b]">{payload[0].value} stories</p>
    </div>
  );
};

const CustomTooltipStatus = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#e2e8f0] rounded px-3 py-2">
      <p className="text-xs font-semibold text-[#1e293b]">{payload[0].name}</p>
      <p className="text-xs text-[#64748b]">{payload[0].value} test cases</p>
    </div>
  );
};

const CoverageHeatmap: React.FC<{ testCases: any[] }> = ({ testCases }) => {
  const navigate = useNavigate();
  const rows = buildHeatmap(testCases);
  if (rows.length === 0) return null;

  const goodCount   = rows.filter(r => r.coverage === "good").length;
  const mediumCount = rows.filter(r => r.coverage === "medium").length;
  const lowCount    = rows.filter(r => r.coverage === "low").length;
  const noneCount   = rows.filter(r => r.coverage === "none").length;

  const totalPassed  = testCases.filter(tc => tc.status === "Passed").length;
  const totalFailed  = testCases.filter(tc => tc.status === "Failed").length;
  const totalPending = testCases.length - totalPassed - totalFailed;

  const coveragePieData = [
    { name: "Good",   value: goodCount,   color: COVERAGE_META.good.color },
    { name: "Medium", value: mediumCount, color: COVERAGE_META.medium.color },
    { name: "Low",    value: lowCount,    color: COVERAGE_META.low.color },
    { name: "None",   value: noneCount,   color: COVERAGE_META.none.color },
  ].filter(d => d.value > 0);

  const statusPieData = [
    { name: "Passed",  value: totalPassed,  color: "#10B981" },
    { name: "Failed",  value: totalFailed,  color: "#EF4444" },
    { name: "Pending", value: totalPending, color: "#CBD5E1" },
  ].filter(d => d.value > 0);

  const overallPassRate = testCases.length > 0 ? Math.round((totalPassed / testCases.length) * 100) : 0;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#f1f5f9] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-4 bg-[#5243aa] rounded-full" />
          <h2 className="text-sm font-semibold text-[#1e293b]">Test Coverage Heatmap</h2>
          <span className="text-xs text-[#94a3b8] bg-[#f0f4f8] px-2 py-0.5 rounded-full border border-[#f1f5f9]">{rows.length} stories</span>
        </div>
        <span className="text-xs text-[#94a3b8]">{testCases.length} total test cases</span>
      </div>

      {/* Pie charts row */}
      <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-[#f1f5f9]">

        {/* Pie 1: Coverage distribution */}
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wide mb-3">Coverage by Story</p>
          <div className="flex items-center gap-4">
            <div className="w-36 h-36 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={coveragePieData} cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2} dataKey="value">
                    {coveragePieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="none" />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {coveragePieData.map(d => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-xs text-[#475569]">{d.name}</span>
                  <span className="text-xs font-semibold text-[#1e293b] ml-auto tabular-nums">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pie 2: Pass/Fail/Pending */}
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wide mb-3">Execution Status</p>
          <div className="flex items-center gap-4">
            <div className="w-36 h-36 flex-shrink-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2} dataKey="value">
                    {statusPieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="none" />)}
                  </Pie>
                  <Tooltip content={<CustomTooltipStatus />} />
                </PieChart>
              </ResponsiveContainer>
              {/* Center label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className={`text-lg font-bold ${
                  overallPassRate >= 80 ? "text-[#006644]" : overallPassRate >= 50 ? "text-[#974f0c]" : "text-[#de350b]"
                }`}>{overallPassRate}%</span>
                <span className="text-[10px] text-[#94a3b8]">pass rate</span>
              </div>
            </div>
            <div className="space-y-2">
              {statusPieData.map(d => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-xs text-[#475569]">{d.name}</span>
                  <span className="text-xs font-semibold text-[#1e293b] ml-auto tabular-nums">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Story rows — top 5 by risk only */}
      <div className="divide-y divide-slate-50">
        {rows.slice(0, 5).map(row => {
          const meta = COVERAGE_META[row.coverage];
          return (
            <div key={row.storyId}
              className="px-5 py-2.5 flex items-center gap-4 hover:bg-[#f0f4f8]/60 transition-colors cursor-pointer group"
              onClick={() => row.storyId !== "Unlinked" && navigate("/coverage")}
            >
              <div className="w-28 flex-shrink-0">
                <span className={`font-mono text-xs font-semibold ${
                  row.storyId === "Unlinked" ? "text-[#94a3b8]" : "text-[#0e7490] group-hover:underline"
                }`}>{row.storyId}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden gap-px">
                  {row.passed  > 0 && <div className="bg-[#36b37e] transition-all" style={{ flex: row.passed }} />}
                  {row.failed  > 0 && <div className="bg-red-400 transition-all"     style={{ flex: row.failed }} />}
                  {row.pending > 0 && <div className="bg-[#e2e8f0] transition-all"   style={{ flex: row.pending }} />}
                </div>
              </div>
              <div className="flex items-center gap-2.5 flex-shrink-0 text-[11px] tabular-nums">
                {row.passed  > 0 && <span className="text-[#006644] font-semibold">{row.passed}P</span>}
                {row.failed  > 0 && <span className="text-[#de350b] font-semibold">{row.failed}F</span>}
                {row.pending > 0 && <span className="text-[#94a3b8]">{row.pending} pending</span>}
              </div>
              <div className="w-10 text-right flex-shrink-0">
                <span className={`text-xs font-bold ${
                  row.passRate >= 80 ? "text-[#006644]" : row.passRate >= 50 ? "text-[#974f0c]" : "text-[#de350b]"
                }`}>{row.passRate}%</span>
              </div>
              <div className="w-20 flex-shrink-0 text-right">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${meta.badge}`}>{meta.label}</span>
              </div>
            </div>
          );
        })}
      </div>
      {/* Footer */}
      <div className="px-5 py-2 border-t border-[#f1f5f9] flex items-center justify-between bg-[#f0f4f8]/50">
        <span className="text-[11px] text-[#94a3b8]">
          Showing top {Math.min(5, rows.length)} at-risk stories of {rows.length}
        </span>
        <button onClick={() => navigate("/coverage")} className="text-[11px] text-[#0e7490] hover:underline font-medium">View all in Test Coverage →</button>
      </div>
    </div>
  );
};

const Dashboard: React.FC = () => {
  const connected = !!getCredentials();
  const navigate = useNavigate();
  const llmConfig = getLlmConfig();
  const llmConnected = !!(llmConfig?.apiKey);
  const projectName = localStorage.getItem("testorbit_project_name") || "";
  const { issues: testCases, bugs, activity, loading, error, refresh } = useDataStore();

  // DataStore loads on mount and polls every 15s — no extra refresh needed here

  const passed  = testCases.filter(tc => tc.status === "Passed" || tc.status === "Done").length;
  const failed   = testCases.filter(tc => tc.status === "Failed").length;
  const openBugs = bugs.filter(b => {
    const s = (b.status || "").toLowerCase();
    return !["done", "closed", "resolved", "complete", "completed"].includes(s);
  }).length;
  const passRate = testCases.length > 0 ? Math.round((passed / testCases.length) * 100) : 0;

  if (!connected) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Dashboard" subtitle="QA Intelligence Overview" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-[#ecfeff] rounded flex items-center justify-center mx-auto mb-5 border border-[#a5f3fc]">
              <svg className="w-8 h-8 text-[#22d3ee]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
            </div>
            <h2 className="text-base font-semibold text-[#1e293b] mb-2">Not connected to Jira</h2>
            <p className="text-sm text-[#64748b] mb-5">Configure your Jira credentials in Settings to see live data.</p>
            <a href="/settings" className="btn-primary">Go to Settings</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div>
        <Header
          title="Dashboard"
          subtitle={projectName ? `${getCredentials()?.projectKey} - ${projectName}` : `Project: ${getCredentials()?.projectKey}`}
          actions={
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs" style={{ color: "#97A0AF" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#36B37E] animate-pulse inline-block" />
                Live · syncs every 15s
              </span>
              <button className="btn-ghost text-xs" onClick={refresh}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                Refresh
              </button>
            </div>
          }
        />
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* Integration status */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Jira", sub: projectName || getCredentials()?.projectKey || "Connected", ok: true, icon: "🔗" },
            { label: "LLM Engine", sub: llmConnected ? (LLM_LABELS[llmConfig?.llm] || llmConfig?.llm || "Configured") : "Not Configured", ok: llmConnected, icon: "🤖" },
          ].map(s => (
            <div key={s.label} className="bg-white border border-[#f1f5f9] rounded px-4 py-3.5 flex items-center gap-3">
              <div className={`w-9 h-9 rounded flex items-center justify-center text-base flex-shrink-0 ${s.ok ? "bg-[#e3fcef]" : "bg-[#fffae6]"}`}>{s.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[#1e293b]">{s.label}</div>
                <div className="text-xs text-[#94a3b8] truncate mt-0.5">{s.sub}</div>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${s.ok ? "bg-[#e3fcef] text-[#006644] border-[#86efac]" : "bg-[#fffae6] text-[#974f0c] border-[#ffe380]"}`}>
                {s.ok ? "Active" : "Inactive"}
              </span>
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-[#ffebe6] border border-[#ffbdad] text-[#bf2600] text-sm px-4 py-3 rounded flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-3 text-sm text-[#64748b]">
              <div className="w-5 h-5 border-2 border-[#0e7490] border-t-transparent rounded-full animate-spin" />
              Loading live data from Jira…
            </div>
          </div>
        ) : (
          <>
            {/* Metric cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Total Test Cases", value: testCases.length, dotColor: "#0e7490", bgColor: "#ecfeff", borderColor: "#a5f3fc", textColor: "#0e7490", bar: true },
                { label: "Passed",           value: passed,           dotColor: "#16a34a", bgColor: "#f0fdf4", borderColor: "#86efac", textColor: "#15803d", tag: passRate > 0 ? `${passRate}%` : null },
                { label: "Failed",           value: failed,           dotColor: "#dc2626", bgColor: "#fef2f2", borderColor: "#fca5a5", textColor: "#dc2626" },
                { label: "Open Bugs",        value: openBugs,         dotColor: "#d97706", bgColor: "#fffbeb", borderColor: "#fcd34d", textColor: "#b45309", tag: null },
              ].map(m => (
                <div key={m.label} className="card transition-all duration-200" style={{ cursor: "default" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
                >
                  <div className="flex items-center justify-between mb-4">
                    {/* Icon box with dot */}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: m.bgColor, border: `1px solid ${m.borderColor}` }}
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: m.dotColor, boxShadow: `0 0 6px ${m.dotColor}60` }}
                      />
                    </div>
                    {(m as any).tag && (
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: "#f0fdf4", color: "#15803d", border: "1px solid #86efac" }}
                      >
                        {(m as any).tag}
                      </span>
                    )}
                  </div>
                  <div className="text-3xl font-bold mb-1" style={{ color: m.textColor }}>{m.value}</div>
                  <div className="text-xs font-medium" style={{ color: "#94a3b8" }}>{m.label}</div>
                  {(m as any).bar && testCases.length > 0 && (
                    <div className="mt-3">
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#f1f5f9" }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${passRate}%`, backgroundColor: "#0e7490" }}
                        />
                      </div>
                      <div className="text-xs mt-1.5" style={{ color: "#94a3b8" }}>{passRate}% pass rate</div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Coverage Heatmap */}
            <CoverageHeatmap testCases={testCases} />

            {/* Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {[
                {
                  title: "Recent Activity", count: activity.length, accent: "bg-[#0e7490]",
                  headers: ["Key", "Summary", "Type", "Status"],
                  rows: activity, empty: "No recent activity",
                  render: (a: any) => [
                    <a href={a.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-[#0e7490] hover:underline font-semibold">{a.id}</a>,
                    <span className="text-xs text-[#475569] truncate block max-w-[140px]">{a.summary}</span>,
                    <span className="text-xs text-[#94a3b8] bg-[#f0f4f8] border border-[#f1f5f9] px-1.5 py-0.5 rounded">{a.type}</span>,
                    <span className={a.status === "Done" || a.status === "Passed" ? "badge-pass" : a.status === "Failed" ? "badge-fail" : "badge-pending"}>{a.status}</span>
                  ]
                },
                {
                  title: "Open Bugs", count: `${openBugs} open`, accent: "bg-[#de350b]",
                  headers: ["Key", "Summary", "Priority", "Status"],
                  rows: bugs, empty: "No bugs found",
                  render: (b: any) => [
                    <a href={b.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-[#0e7490] hover:underline font-semibold">{b.id}</a>,
                    <span className="text-xs text-[#475569] truncate block max-w-[140px]">{b.summary}</span>,
                    <span className={`text-xs font-semibold ${b.priority === "Highest" || b.priority === "High" ? "text-[#de350b]" : b.priority === "Medium" ? "text-[#ff991f]" : "text-[#94a3b8]"}`}>{b.priority}</span>,
                    <span className={b.status === "Done" || b.status === "Resolved" ? "badge-pass" : "badge-fail"}>{b.status}</span>
                  ]
                }
              ].map(t => (
                <div key={t.title} className="card overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[#f1f5f9] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-1 h-4 ${t.accent} rounded-full`} />
                      <h2 className="text-sm font-semibold text-[#1e293b]">{t.title}</h2>
                    </div>
                    <span className="text-xs text-[#94a3b8] bg-[#f0f4f8] px-2 py-0.5 rounded-full border border-[#f1f5f9]">{t.count}</span>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr>{t.headers.map(h => <th key={h} className="table-th">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {t.rows.length === 0 ? (
                        <tr><td colSpan={4} className="table-td text-center text-[#94a3b8] py-8 text-xs">{t.empty}</td></tr>
                      ) : t.rows.map((row: any) => (
                        <tr key={row.id} className="hover:bg-[#f0f4f8]/60 transition-colors">
                          {t.render(row).map((cell, i) => <td key={i} className="table-td">{cell}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
