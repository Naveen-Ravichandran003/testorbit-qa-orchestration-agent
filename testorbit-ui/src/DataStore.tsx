import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { getCredentials, fetchIssues, fetchBugs, fetchActivity } from "./jiraService";

const RECYCLE_KEY = "testorbit_recycle_bin";
const POLL_INTERVAL = 15_000; // 15s live sync

function loadRecycleBin(): any[] {
  try { return JSON.parse(localStorage.getItem(RECYCLE_KEY) || "[]"); } catch { return []; }
}

function saveRecycleBin(items: any[]) {
  localStorage.setItem(RECYCLE_KEY, JSON.stringify(items));
}

// Normalize Jira status strings to consistent values
export function normalizeStatus(status: string | undefined): string {
  if (!status) return "Pending";
  const s = status.toLowerCase().trim();
  if (["done", "passed", "pass", "closed", "resolved", "complete", "completed", "fixed", "verified"].includes(s)) return "Passed";
  if (["failed", "fail", "rejected", "won't do", "wont do", "won't fix", "wont fix", "invalid"].includes(s)) return "Failed";
  return "Pending";
}

// Local execution results override — keyed by issue ID, set by Execution page after evaluate
const EXEC_RESULTS_KEY = "testorbit_exec_results";
export function getExecResults(): Record<string, { status: string; ts: number }> {
  try { return JSON.parse(localStorage.getItem(EXEC_RESULTS_KEY) || "{}"); } catch { return {}; }
}
export function setExecResult(id: string, status: string) {
  const results = getExecResults();
  results[id] = { status, ts: Date.now() };
  localStorage.setItem(EXEC_RESULTS_KEY, JSON.stringify(results));
}

interface DataStore {
  issues: any[];
  bugs: any[];
  activity: any[];
  recycleBin: any[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  removeIssue: (id: string) => void;
  restoreFromBin: (id: string) => void;
  clearBin: () => void;
}

const DataContext = createContext<DataStore>({
  issues: [], bugs: [], activity: [], recycleBin: [],
  loading: false, error: null,
  refresh: () => {}, removeIssue: () => {}, restoreFromBin: () => {}, clearBin: () => {}
});

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [issues, setIssues] = useState<any[]>([]);
  const [bugs, setBugs] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [recycleBin, setRecycleBin] = useState<any[]>(loadRecycleBin);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback((silent = false) => {
    if (!getCredentials()) return;
    if (!silent) setLoading(true);
    setError(null);
    const bin = loadRecycleBin();
    const deletedIds = new Set(bin.map((r: any) => r.id));
    const now = Date.now();
    const TTL = 24 * 60 * 60 * 1000; // 24h
    Promise.all([fetchIssues(), fetchBugs(), fetchActivity()])
      .then(([i, b, a]) => {
        const execResults = getExecResults();
        setIssues(i.filter((x: any) => !deletedIds.has(x.id)).map((x: any) => {
          const override = execResults[x.id];
          // Migrate old string-shaped entries
          const normalized = typeof override === "string" ? { status: override, ts: Date.now() } : override;
          const useOverride = normalized && (now - (normalized.ts || 0) < TTL);
          return { ...x, status: useOverride ? normalized.status : normalizeStatus(x.status) };
        }));
        setBugs(b.filter((x: any) => !deletedIds.has(x.id)));
        setActivity(a.filter((x: any) => !deletedIds.has(x.id)));
      })
      .catch(err => { if (!silent) setError(err.message); })
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  const startPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => load(true), POLL_INTERVAL);
  }, [load]);

  useEffect(() => {
    load();
    startPoll();
    // Restart poll + reload when credentials are saved
    const onCredsSaved = () => { load(); startPoll(); };
    // Reload when another user's socket activity fires (e.g. generate, push)
    const onSocketActivity = () => load(true);
    window.addEventListener("testorbit:credentials-saved", onCredsSaved);
    window.addEventListener("testorbit:socket-activity", onSocketActivity);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener("testorbit:credentials-saved", onCredsSaved);
      window.removeEventListener("testorbit:socket-activity", onSocketActivity);
    };
  }, [load, startPoll]);

  const removeIssue = useCallback((id: string) => {
    setIssues(prev => {
      const item = prev.find(i => i.id === id);
      if (item) {
        const updated = [...loadRecycleBin().filter((r: any) => r.id !== id), {
          ...item,
          deletedAt: new Date().toISOString()
        }];
        saveRecycleBin(updated);
        setRecycleBin(updated);
      }
      return prev.filter(i => i.id !== id);
    });
    setBugs(prev => prev.filter(b => b.id !== id));
    setActivity(prev => prev.filter(a => a.id !== id));
  }, []);

  const restoreFromBin = useCallback((id: string) => {
    setRecycleBin(prev => {
      const item = prev.find(r => r.id === id);
      if (item) {
        const { deletedAt, ...restored } = item;
        setIssues(p => [restored, ...p]);
      }
      const updated = prev.filter(r => r.id !== id);
      saveRecycleBin(updated);
      return updated;
    });
  }, []);

  const clearBin = useCallback(() => {
    setRecycleBin([]);
    saveRecycleBin([]);
  }, []);

  return (
    <DataContext.Provider value={{ issues, bugs, activity, recycleBin, loading, error, refresh: load, removeIssue, restoreFromBin, clearBin }}>
      {children}
    </DataContext.Provider>
  );
};

export const useDataStore = () => useContext(DataContext);
