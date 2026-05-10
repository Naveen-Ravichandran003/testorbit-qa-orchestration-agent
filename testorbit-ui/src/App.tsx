import React, { useState, useEffect, useCallback, Component } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import LogoMark from "./components/LogoMark";
import Dashboard from "./pages/Dashboard";
import Generator from "./pages/Generator";
import Execution from "./pages/Execution";
import Repository from "./pages/Repository";
import Coverage from "./pages/Coverage";
import Settings from "./pages/Settings";
import { useSync, PresenceUser, ActivityEntry } from "./useSync";
import { getCredentials } from "./jiraService";

const PAGE_TITLES: Record<string, { title: string; desc: string; page: string }> = {
  "/":           { title: "Dashboard",       desc: "QA Intelligence Overview",                    page: "dashboard" },
  "/generator":  { title: "Test Generator",  desc: "AI-powered test case generation",             page: "generator" },
  "/execution":  { title: "Test Execution",  desc: "Execute and evaluate test cases",             page: "execution" },
  "/repository": { title: "Repository",      desc: "Manage and organise test cases",              page: "repository" },
  "/coverage":   { title: "Test Coverage",   desc: "Sprint-wise QA coverage analysis",            page: "coverage" },
  "/settings":   { title: "Settings",        desc: "Configure integrations and credentials",      page: "settings" },
};

const PAGE_ICONS: Record<string, string> = {
  dashboard: "🏠", generator: "⚡", execution: "▶", repository: "📁", coverage: "📊", settings: "⚙"
};

function AvatarStack({ users }: { users: PresenceUser[] }) {
  if (!users.length) return null;
  const visible = users.slice(0, 5);
  const overflow = users.length - 5;
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-1.5">
        {visible.map(u => (
          <div
            key={u.socketId}
            title={`${u.name} — ${PAGE_ICONS[u.page] || ""} ${u.page}`}
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
            style={{ backgroundColor: u.color, border: "2px solid #fff" }}
          >
            {u.name.slice(0, 1).toUpperCase()}
          </div>
        ))}
        {overflow > 0 && (
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
            style={{ backgroundColor: "#94a3b8", border: "2px solid #fff" }}
          >
            +{overflow}
          </div>
        )}
      </div>
      <span className="text-xs font-medium" style={{ color: "#64748b" }}>{users.length} online</span>
    </div>
  );
}

function ActivityToast({ entry, onDone }: { entry: ActivityEntry; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 4000); return () => clearTimeout(t); }, []);
  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex items-start gap-3 text-sm px-4 py-3 rounded animate-slide-up max-w-sm"
      style={{
        backgroundColor: "#172b4d",
        color: "#fff",
        boxShadow: "0 8px 24px rgba(9,30,66,0.35)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <div
        className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold mt-0.5"
        style={{ backgroundColor: entry.user_color }}
      >
        {entry.user_name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="font-semibold" style={{ color: "#fff" }}>{entry.user_name}</div>
        <div style={{ color: "rgba(255,255,255,0.7)" }}>{entry.action}</div>
        {entry.detail && <div className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{entry.detail}</div>}
      </div>
    </div>
  );
}

const TopBar: React.FC = () => {
  const location = useLocation();
  const meta = PAGE_TITLES[location.pathname] || { title: "TestOrbit", desc: "", page: "dashboard" };
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [presence, setPresence]   = useState<PresenceUser[]>([]);
  const [toast, setToast]         = useState<ActivityEntry | null>(null);
  const [toastKey, setToastKey]   = useState(0);
  const creds = getCredentials();

  const { emitPageChange } = useSync({
    page: meta.page,
    onPresence: useCallback((users: PresenceUser[]) => {
      const stored = sessionStorage.getItem("testorbit_sync_user");
      const self = stored ? JSON.parse(stored) : null;
      setPresence(self ? users.filter(u => u.name !== self.name) : users);
    }, []),
    onActivity: useCallback((entry: ActivityEntry) => {
      const stored = sessionStorage.getItem("testorbit_sync_user");
      const self = stored ? JSON.parse(stored) : null;
      if (self && entry.user_name === self.name) return;
      setToast(entry);
      setToastKey(k => k + 1);
      // Trigger a silent DataStore refresh so Dashboard reflects the change
      window.dispatchEvent(new CustomEvent("testorbit:socket-activity"));
    }, []),
  });

  useEffect(() => {
    const check = () => {
      const creds = getCredentials();
      if (!creds?.token) { setBackendOk(false); return; }
      fetch("http://localhost:3001/jira/projects", {
        headers: { "Content-Type": "application/json", jiraurl: creds.jiraUrl, email: creds.email, token: creds.token }
      })
        .then(async res => {
          if (!res.ok) { setBackendOk(false); return; }
          const data = await res.json();
          setBackendOk(Array.isArray(data) && data.length > 0);
        })
        .catch(() => setBackendOk(false));
    };
    check();
    window.addEventListener("testorbit:credentials-saved", check);
    return () => window.removeEventListener("testorbit:credentials-saved", check);
  }, [location.pathname]);

  useEffect(() => { emitPageChange(meta.page); }, [location.pathname]);

  return (
    <>
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: "48px",
          backgroundColor: "#FFFFFF",
          padding: "0 20px",
          borderBottom: "1px solid #DFE1E6",
        }}
      >
        {/* Left: logo + breadcrumb */}
        <div className="flex items-center gap-2 text-sm">
          <LogoMark size={28} />
          <span className="font-semibold" style={{ color: "#172B4D" }}>TestOrbit</span>
          <svg className="w-3 h-3 flex-shrink-0" style={{ color: "#C1C7D0" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
          </svg>
          <span className="font-semibold" style={{ color: "#172B4D" }}>{meta.title}</span>
          {meta.desc && (
            <span className="hidden md:inline text-xs" style={{ color: "#97A0AF" }}>{meta.desc}</span>
          )}
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          {creds && <AvatarStack users={presence} />}
          {/* Status pill */}
          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
            style={{
              backgroundColor: backendOk === null ? "#f1f5f9"
                : backendOk ? "#f0fdfa" : "#fef2f2",
              color: backendOk === null ? "#64748b"
                : backendOk ? "#0f766e" : "#dc2626",
              border: backendOk === null ? "1px solid #e2e8f0"
                : backendOk ? "1px solid #99f6e4" : "1px solid #fecaca",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                backgroundColor: backendOk === null ? "#94a3b8"
                  : backendOk ? "#14b8a6" : "#ef4444",
                boxShadow: backendOk ? "0 0 5px rgba(20,184,166,0.7)" : "none",
              }}
            />
            {backendOk === null ? "Connecting…" : backendOk ? "Jira Connected" : creds ? "Jira Unreachable" : "Not Connected"}
          </div>
        </div>
      </div>
      {toast && <ActivityToast key={toastKey} entry={toast} onDone={() => setToast(null)} />}
    </>
  );
};

import { DataProvider } from "./DataStore";

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-base font-semibold" style={{ color: "#172B4D" }}>Something went wrong</h2>
            <p className="text-sm mt-2 mb-4" style={{ color: "#5E6C84" }}>{(this.state.error as Error).message}</p>
            <button className="btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const App: React.FC = () => (
  <BrowserRouter>
    <DataProvider>
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "#F4F5F7" }}>
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <TopBar />
          <ErrorBoundary>
            <div className="flex-1 flex flex-col overflow-hidden">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/generator" element={<Generator />} />
                <Route path="/execution" element={<Execution />} />
                <Route path="/repository" element={<Repository />} />
                <Route path="/coverage" element={<Coverage />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </DataProvider>
  </BrowserRouter>
);

export default App;
