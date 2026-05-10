import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import LogoMark from "../components/LogoMark";
import { getCredentials, fetchBugs, deleteIssue, createTestPlan, executeFolder } from "../jiraService";
import { useDataStore } from "../DataStore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface Folder {
  key: string;
  label: string;
  isSystem: boolean;
  items?: string[]; // test case IDs for custom folders
}

const FolderIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>;
const BugIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-2.21 0-4 1.79-4 4v3a4 4 0 008 0v-3c0-2.21-1.79-4-4-4zm0 0V5m-4 4H5m3 4H5m11-4h3m-3 4h3M9 19l-2 2m8-2l2 2" /></svg>;
const StoryIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
const PlusIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>;
const ReportIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;

const STORAGE_KEY = "testorbit_custom_folders_v2";

function loadCustomFolders(): Folder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomFolders(folders: Folder[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
}

// ─── Expandable Row Component ───────────────────────────────────────────────────────
interface ExpandableRowProps {
  item: any;
  confirmDeleteId: string | null;
  deleteStep: "confirm" | "jira";
  deleting: boolean;
  onDelete: () => void;
  onDeleteConfirm: () => void;
  onJiraDelete: () => void;
  onSkipJiraDelete: () => void;
  onDeleteCancel: () => void;
}

const ExpandableRow: React.FC<ExpandableRowProps> = ({ item, confirmDeleteId, deleteStep, deleting, onDelete, onDeleteConfirm, onJiraDelete, onSkipJiraDelete, onDeleteCancel }) => {
  const [expanded, setExpanded] = useState(false);
  const priorityColor = item.priority === "Highest" || item.priority === "High" ? "text-[#de350b]" : item.priority === "Medium" ? "text-[#ff991f]" : "text-[#94a3b8]";

  return (
    <>
      <tr className={`hover:bg-[#f0f4f8] transition-colors ${expanded ? "bg-[#ecfeff]/40" : ""}`}>
        <td className="table-td w-8">
          <button
            onClick={() => setExpanded(!expanded)}
            className={`w-5 h-5 flex items-center justify-center rounded transition-all ${
              expanded ? "bg-[#ecfeff] text-[#0e7490]" : "text-[#cbd5e1] hover:text-[#64748b] hover:bg-[#f1f5f9]"
            }`}
          >
            <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </td>
        <td className="table-td">
          <a href={item.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-[#0e7490] hover:text-[#0c5f75] hover:underline font-semibold">{item.id}</a>
        </td>
        <td className="table-td max-w-[240px]">
          <span className="text-xs font-medium text-[#1e293b] line-clamp-1">{item.summary}</span>
        </td>
        <td className="table-td">
          {item.userStoryId
            ? <span className="font-mono text-[11px] bg-[#ecfeff] text-[#0e7490] border border-[#a5f3fc] px-2 py-0.5 rounded-full">{item.userStoryId}</span>
            : <span className="text-[#cbd5e1] text-xs">—</span>}
        </td>
        <td className={`table-td text-xs font-semibold ${priorityColor}`}>{item.priority || "—"}</td>
        <td className="table-td">
          <span className={item.status === "Done" || item.status === "Passed" ? "badge-pass" : item.status === "Failed" ? "badge-fail" : "badge-pending"}>
            {item.status || "Pending"}
          </span>
        </td>
        <td className="table-td">
          <button
            className="text-xs font-medium px-2.5 py-1 rounded transition-all"
            style={{ color: "#dc2626", backgroundColor: "transparent" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#fef2f2"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            onClick={onDelete}
          >
            Delete
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[#ecfeff]/20">
          <td colSpan={7} className="px-5 py-3 border-b border-[#a5f3fc]/50">
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest block mb-1">Issue Type</span>
                <span className="text-[#1e293b] font-medium">{item.type || "—"}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest block mb-1">Assignee</span>
                <span className="text-[#1e293b] font-medium">{item.assignee || "Unassigned"}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest block mb-1">Created</span>
                <span className="text-[#1e293b] font-medium">{item.created ? new Date(item.created).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</span>
              </div>
              <div className="col-span-3">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest block mb-1">Labels</span>
                <div className="flex flex-wrap gap-1">
                  {(item.labels || []).length > 0
                    ? (item.labels as string[]).map((l: string) => (
                        <span key={l} className="text-[11px] bg-[#f1f5f9] text-[#475569] border border-[#e2e8f0] px-2 py-0.5 rounded-full">{l}</span>
                      ))
                    : <span className="text-[#94a3b8]">—</span>}
                </div>
              </div>
              <div className="col-span-3 flex justify-end">
                <a href={item.url} target="_blank" rel="noreferrer" className="btn-secondary text-xs py-1 px-3 flex items-center gap-1.5">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                  Open in Jira
                </a>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const Repository: React.FC = () => {
  const connected = !!getCredentials();
  const navigate = useNavigate();
  const { issues, bugs, loading, error, removeIssue, refresh, recycleBin, restoreFromBin, clearBin } = useDataStore();
  const [customFolders, setCustomFolders] = useState<Folder[]>(loadCustomFolders);
  const [active, setActive] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Folder creation
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);

  // Rename
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ key: string; x: number; y: number } | null>(null);

  // Delete modal state
  const [deleteModal, setDeleteModal] = useState<{ id: string; summary: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteToast, setDeleteToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Unused legacy — kept for ExpandableRow prop compatibility
  const confirmDeleteId = null;
  const deleteStep = "confirm" as const;
  const deletingJiraId = null;

  function startDelete(id: string) {
    const item = [...issues, ...bugs].find(i => i.id === id);
    setDeleteModal({ id, summary: item?.summary || id });
  }
  function cancelDelete() { setDeleteModal(null); }

  function confirmLocalDelete() {}   // not used — modal handles it
  function skipJiraDelete() {}       // not used — modal handles it

  async function confirmJiraDelete() {
    const id = deletingJiraId;
    if (!id) return;
    setDeleting(true);
    try { await deleteIssue(id); }
    catch (e: any) { console.warn("Jira delete failed:", e.message); }
    finally { setDeleting(false); }
  }

  async function handleDeleteLocalOnly() {
    if (!deleteModal) return;
    removeIssue(deleteModal.id);
    setDeleteModal(null);
    setDeleteToast({ msg: `"${deleteModal.summary}" removed from TestOrbit.`, type: "success" });
    setTimeout(() => setDeleteToast(null), 4000);
  }

  async function handleDeleteWithJira() {
    if (!deleteModal) return;
    const { id, summary } = deleteModal;
    setDeleting(true);
    removeIssue(id);
    try {
      await deleteIssue(id);
      setDeleteModal(null);
      setDeleteToast({ msg: `"${summary}" deleted from TestOrbit and Jira.`, type: "success" });
    } catch (e: any) {
      setDeleteModal(null);
      setDeleteToast({ msg: `Removed locally but Jira delete failed: ${e.message}`, type: "error" });
    } finally {
      setDeleting(false);
      setTimeout(() => setDeleteToast(null), 5000);
    }
  }

  // Add test cases modal
  const [addModal, setAddModal] = useState<string | null>(null);
  const [modalSearch, setModalSearch] = useState("");
  const [modalSelected, setModalSelected] = useState<Set<string>>(new Set());

  // Push to Jira
  const [pushModal, setPushModal] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ key: string; url: string } | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  // Report
  const [reportModal, setReportModal] = useState<string | null>(null);

  // Execute folder
  const [executingFolder, setExecutingFolder] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);

  async function handleExecuteFolder(folderKey: string) {
    const folder = customFolders.find(f => f.key === folderKey);
    if (!folder || !folder.items?.length) { setExecError("Add test cases to this folder before executing."); return; }
    setExecutingFolder(true); setExecError(null);
    try {
      const result = await executeFolder(folder.label, folder.items);
      navigate("/execution", { state: { planId: result.planKey, execId: result.execKey, folderName: folder.label } });
    } catch (err: any) {
      setExecError(err.message);
    } finally {
      setExecutingFolder(false);
    }
  } // "all" | "bugs" | story_ | custom_

  const testIssues = issues.filter(i => i.type?.toLowerCase() === "test");
  const storyFolders: Folder[] = [...new Set(testIssues.map(i => i.userStoryId).filter(Boolean))]
    .map((id: string) => ({ key: `story_${id}`, label: id, isSystem: true }));

  useEffect(() => {
    if (creating) setTimeout(() => newInputRef.current?.focus(), 50);
  }, [creating]);

  useEffect(() => {
    const handler = () => setCtxMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  function filterItems(key: string): any[] {
    if (key === "bugs") return bugs;
    if (key === "all") return testIssues;
    if (key === "recycle") return recycleBin;
    if (key.startsWith("story_")) {
      const storyId = key.replace("story_", "");
      return testIssues.filter(i => i.userStoryId === storyId);
    }
    const folder = customFolders.find(f => f.key === key);
    if (!folder) return [];
    return testIssues.filter(i => (folder.items || []).includes(i.id));
  }

  const allFolders = [
    { key: "all", label: "All Test Cases", isSystem: true },
    { key: "bugs", label: "Bugs", isSystem: true },
    { key: "recycle", label: "Recycle Bin", isSystem: true },
    ...storyFolders,
    ...customFolders
  ];

  const filtered = search.trim()
    ? filterItems(active).filter(i =>
        i.id?.toLowerCase().includes(search.toLowerCase()) ||
        i.summary?.toLowerCase().includes(search.toLowerCase()) ||
        (i.userStoryId?.toLowerCase() || "").includes(search.toLowerCase())
      )
    : filterItems(active);

  const activeFolder = allFolders.find(f => f.key === active);

  function handleCreateFolder() {
    const name = newName.trim();
    if (!name) { setCreating(false); setNewName(""); return; }
    const key = `custom_${Date.now()}`;
    const updated = [...customFolders, { key, label: name, isSystem: false, items: [] }];
    setCustomFolders(updated);
    saveCustomFolders(updated);
    setActive(key);
    setCreating(false);
    setNewName("");
  }

  function handleRename(key: string) {
    const name = renameValue.trim();
    if (!name) { setRenamingKey(null); return; }
    const updated = customFolders.map(f => f.key === key ? { ...f, label: name } : f);
    setCustomFolders(updated);
    saveCustomFolders(updated);
    setRenamingKey(null);
  }

  function handleDeleteFolder(key: string) {
    const updated = customFolders.filter(f => f.key !== key);
    setCustomFolders(updated);
    saveCustomFolders(updated);
    if (active === key) setActive("all");
    setCtxMenu(null);
  }

  function generateReport(folderKey: string) {
    const folder = allFolders.find(f => f.key === folderKey);
    const items = filterItems(folderKey);
    const creds = getCredentials();
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const total = items.length;
    const passed = items.filter(i => i.status === "Done" || i.status === "Passed").length;
    const failed = items.filter(i => i.status === "Failed").length;
    const pending = total - passed - failed;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const high = items.filter(i => i.priority === "High" || i.priority === "Highest").length;
    const medium = items.filter(i => i.priority === "Medium").length;
    const low = items.filter(i => i.priority === "Low" || i.priority === "Lowest").length;
    const stories = [...new Set(items.map(i => i.userStoryId).filter(Boolean))];

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

    const drawPageFrame = () => {
      // Top accent bar
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, W, 12, "F");
      doc.setFillColor(37, 99, 235);
      doc.rect(0, 0, 6, 12, "F");
      // Bottom bar
      doc.setFillColor(241, 245, 249);
      doc.rect(0, H - 10, W, 10, "F");
      doc.setFillColor(37, 99, 235);
      doc.rect(0, H - 10, 6, 10, "F");
    };

    const drawFooter = (pageNum: number, total: number) => {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text("TestOrbit AI — Confidential QA Report", 14, H - 4);
      doc.text(`Page ${pageNum} of ${total}`, W - 14, H - 4, { align: "right" });
      doc.text(`${creds?.projectKey} | ${dateStr}`, W / 2, H - 4, { align: "center" });
    };

    // ── PAGE 1: COVER ──────────────────────────────────────────────────────
    // Full dark background
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, H, "F");

    // Blue accent left strip
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, 8, H, "F");

    // Decorative circle top-right
    doc.setFillColor(37, 99, 235, 0.15);
    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.3);
    doc.circle(W - 20, 40, 50, "S");
    doc.circle(W - 20, 40, 35, "S");

    // CONFIDENTIAL badge
    doc.setFillColor(239, 68, 68);
    doc.roundedRect(W - 55, 18, 40, 8, 1, 1, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text("CONFIDENTIAL", W - 35, 23.5, { align: "center" });

    // Logo mark — concentric orbit circles matching brand
    const lx = 20, ly = 26; // top-left origin of logo
    const ls = 10;           // scale unit
    // Outer orbit ring
    doc.setDrawColor(0, 82, 204); doc.setLineWidth(0.4); doc.setFillColor(0, 82, 204);
    doc.circle(lx + ls, ly + ls, ls, "S");
    // Mid orbit ring
    doc.setDrawColor(38, 132, 255); doc.setLineWidth(0.3);
    doc.circle(lx + ls, ly + ls, ls * 0.67, "S");
    // Core filled
    doc.setFillColor(0, 82, 204);
    doc.circle(lx + ls, ly + ls, ls * 0.47, "F");
    // Center white dot
    doc.setFillColor(255, 255, 255);
    doc.circle(lx + ls, ly + ls, ls * 0.12, "F");
    // Satellite top-right on outer ring
    doc.setFillColor(38, 132, 255);
    doc.circle(lx + ls + ls * 0.72, ly + ls - ls * 0.72, ls * 0.14, "F");
    doc.setFillColor(255, 255, 255);
    doc.circle(lx + ls + ls * 0.72, ly + ls - ls * 0.72, ls * 0.07, "F");
    // Satellite bottom-left on mid ring
    doc.setFillColor(38, 132, 255);
    doc.circle(lx + ls - ls * 0.5, ly + ls + ls * 0.5, ls * 0.1, "F");
    // Brand name next to logo
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("TestOrbit", lx + ls * 2 + 3, ly + ls + 1);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text("AI AGENT", lx + ls * 2 + 3.5, ly + ls + 6);
    doc.setFillColor(37, 99, 235);
    doc.rect(lx + ls * 2 + 3, ly + ls + 8, 22, 0.6, "F");

    // Main title
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(28);
    doc.setFont("helvetica", "bold");
    doc.text("QA Test", 20, 90);
    doc.text("Execution", 20, 105);
    doc.setTextColor(37, 99, 235);
    doc.text("Report", 20, 120);

    // Divider
    doc.setFillColor(37, 99, 235);
    doc.rect(20, 128, 60, 0.8, "F");

    // Subtitle
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(folder?.label || "Test Suite", 20, 138);

    // Meta info box
    doc.setFillColor(30, 41, 59);
    doc.roundedRect(20, 155, W - 40, 55, 3, 3, "F");
    doc.setFillColor(37, 99, 235);
    doc.roundedRect(20, 155, 4, 55, 1, 1, "F");

    const metaItems = [
      ["Project", creds?.projectKey || "—"],
      ["Report Scope", folder?.label || "—"],
      ["Generated", `${dateStr} at ${timeStr}`],
      ["Prepared By", "TestOrbit AI Agent"],
      ["Total Test Cases", String(total)],
    ];
    metaItems.forEach(([label, value], i) => {
      const y = 166 + i * 9;
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(label, 30, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.text(value, 100, y);
    });

    // Pass rate big number
    doc.setFillColor(37, 99, 235);
    doc.roundedRect(20, 222, W - 40, 28, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text(`${passRate}%`, W / 2, 234, { align: "center" });
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("OVERALL PASS RATE", W / 2, 242, { align: "center" });

    // Bottom tagline
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(8);
    doc.text("Generated by TestOrbit AI — Enterprise QA Automation Platform", W / 2, H - 20, { align: "center" });

    // ── PAGE 2: EXECUTIVE SUMMARY ──────────────────────────────────────────
    doc.addPage();
    drawPageFrame();

    // Header
    doc.setFillColor(248, 250, 252);
    doc.rect(0, 12, W, 18, "F");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Executive Summary", 14, 24);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(`${folder?.label} — ${dateStr}`, W - 14, 24, { align: "right" });

    // KPI cards row 1
    const kpis = [
      { label: "Total Tests", value: String(total), sub: "in scope", bg: [15, 23, 42] as [number,number,number], fg: [255,255,255] as [number,number,number] },
      { label: "Passed", value: String(passed), sub: `${total > 0 ? Math.round(passed/total*100) : 0}% of total`, bg: [16, 185, 129] as [number,number,number], fg: [255,255,255] as [number,number,number] },
      { label: "Failed", value: String(failed), sub: `${total > 0 ? Math.round(failed/total*100) : 0}% of total`, bg: [239, 68, 68] as [number,number,number], fg: [255,255,255] as [number,number,number] },
      { label: "Pending", value: String(pending), sub: "not executed", bg: [245, 158, 11] as [number,number,number], fg: [255,255,255] as [number,number,number] },
    ];
    const kW = (W - 28 - 9) / 4;
    kpis.forEach((k, i) => {
      const x = 14 + i * (kW + 3);
      doc.setFillColor(...k.bg);
      doc.roundedRect(x, 36, kW, 28, 2, 2, "F");
      doc.setTextColor(...k.fg);
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text(k.value, x + kW / 2, 50, { align: "center" });
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text(k.label.toUpperCase(), x + kW / 2, 57, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...k.fg);
      doc.text(k.sub, x + kW / 2, 62, { align: "center" });
    });

    // Pass rate bar
    let y = 76;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("Pass Rate", 14, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.text(`${passRate}%`, W - 14, y, { align: "right" });
    y += 4;
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(14, y, W - 28, 5, 1, 1, "F");
    if (passRate > 0) {
      doc.setFillColor(16, 185, 129);
      doc.roundedRect(14, y, (W - 28) * passRate / 100, 5, 1, 1, "F");
    }
    y += 12;

    // Priority breakdown
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("Priority Distribution", 14, y); y += 6;
    const priData = [
      { label: "High / Critical", value: high, color: [239, 68, 68] as [number,number,number] },
      { label: "Medium", value: medium, color: [245, 158, 11] as [number,number,number] },
      { label: "Low", value: low, color: [16, 185, 129] as [number,number,number] },
    ];
    priData.forEach(p => {
      const barW = total > 0 ? ((W - 70) * p.value / total) : 0;
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      doc.text(p.label, 14, y + 3.5);
      doc.setFillColor(226, 232, 240);
      doc.roundedRect(55, y, W - 70, 5, 1, 1, "F");
      if (barW > 0) {
        doc.setFillColor(...p.color);
        doc.roundedRect(55, y, barW, 5, 1, 1, "F");
      }
      doc.setTextColor(100, 116, 139);
      doc.text(String(p.value), W - 14, y + 3.5, { align: "right" });
      y += 9;
    });
    y += 4;

    // User stories covered
    if (stories.length > 0) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("User Stories Covered", 14, y); y += 6;
      doc.setFillColor(239, 246, 255);
      doc.roundedRect(14, y, W - 28, 8 + stories.length * 7, 2, 2, "F");
      stories.forEach((s, i) => {
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(37, 99, 235);
        doc.text(`• ${s}`, 20, y + 7 + i * 7);
        const storyItems = items.filter(it => it.userStoryId === s);
        const sPassed = storyItems.filter(it => it.status === "Done" || it.status === "Passed").length;
        doc.setTextColor(100, 116, 139);
        doc.text(`${storyItems.length} tests — ${sPassed} passed`, W - 20, y + 7 + i * 7, { align: "right" });
      });
      y += 12 + stories.length * 7;
    }

    // Observations
    y += 4;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, y, W - 28, 32, 2, 2, "F");
    doc.setFillColor(37, 99, 235);
    doc.roundedRect(14, y, 3, 32, 1, 1, "F");
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("Observations", 22, y + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const obs = [
      `${total} test cases were executed across ${stories.length || 1} user stor${stories.length === 1 ? "y" : "ies"}.`,
      `Pass rate stands at ${passRate}% with ${failed} failure${failed !== 1 ? "s" : ""} requiring attention.`,
      `${high} high-priority test${high !== 1 ? "s" : ""} identified — immediate review recommended for failures.`,
    ];
    obs.forEach((o, i) => doc.text(`${i + 1}. ${o}`, 22, y + 16 + i * 7));

    drawFooter(2, 3);

    // ── PAGE 3: DETAILED TEST CASE TABLE ───────────────────────────────────
    doc.addPage();
    drawPageFrame();

    doc.setFillColor(248, 250, 252);
    doc.rect(0, 12, W, 18, "F");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Test Case Details", 14, 24);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(`${total} test cases`, W - 14, 24, { align: "right" });

    autoTable(doc, {
      startY: 34,
      head: [["#", "Key", "Test Case Summary", "Story", "Priority", "Status"]],
      body: items.map((i, idx) => [
        String(idx + 1),
        i.id,
        i.summary?.length > 52 ? i.summary.slice(0, 52) + "…" : (i.summary || "—"),
        i.userStoryId || "—",
        i.priority || "—",
        i.status || "Pending"
      ]),
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: "bold",
        cellPadding: 4
      },
      bodyStyles: { fontSize: 7.5, textColor: [30, 41, 59], cellPadding: 3.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 8, halign: "center", textColor: [100, 116, 139] },
        1: { cellWidth: 22, fontStyle: "bold", textColor: [37, 99, 235] },
        2: { cellWidth: 78 },
        3: { cellWidth: 22, textColor: [37, 99, 235] },
        4: { cellWidth: 22, halign: "center" },
        5: { cellWidth: 24, halign: "center" }
      },
      margin: { left: 14, right: 14, top: 34 },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.column.index === 5) {
          const s = data.cell.raw as string;
          if (s === "Done" || s === "Passed") {
            data.cell.styles.textColor = [16, 185, 129];
            data.cell.styles.fontStyle = "bold";
          } else if (s === "Failed") {
            data.cell.styles.textColor = [239, 68, 68];
            data.cell.styles.fontStyle = "bold";
          } else {
            data.cell.styles.textColor = [245, 158, 11];
          }
        }
        if (data.section === "body" && data.column.index === 4) {
          const p = data.cell.raw as string;
          if (p === "High" || p === "Highest") data.cell.styles.textColor = [239, 68, 68];
          else if (p === "Medium") data.cell.styles.textColor = [245, 158, 11];
          else data.cell.styles.textColor = [16, 185, 129];
        }
      },
      didDrawPage: (data: any) => {
        drawPageFrame();
        const pageNum = (doc.internal as any).getNumberOfPages();
        drawFooter(pageNum, pageNum);
      }
    });

    // Fix footer page numbers now that we know total pages
    const totalPages = (doc.internal as any).getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      if (p > 1) {
        doc.setFillColor(241, 245, 249);
        doc.rect(0, H - 10, W, 10, "F");
        doc.setFillColor(37, 99, 235);
        doc.rect(0, H - 10, 6, 10, "F");
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 116, 139);
        doc.text("TestOrbit AI — Confidential QA Report", 14, H - 4);
        doc.text(`Page ${p} of ${totalPages}`, W - 14, H - 4, { align: "right" });
        doc.text(`${creds?.projectKey} | ${dateStr}`, W / 2, H - 4, { align: "center" });
      }
    }

    const filename = `${creds?.projectKey}_QA_Report_${(folder?.label || "report").replace(/\s+/g, "_")}_${now.toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
    setReportModal(null);
  }

  function openPushModal(folderKey: string) {
    setPushResult(null);
    setPushError(null);
    setPushModal(folderKey);
    setCtxMenu(null);
  }

  async function handlePushToJira() {
    if (!pushModal) return;
    const folder = customFolders.find(f => f.key === pushModal);
    if (!folder) return;
    setPushing(true); setPushError(null);
    try {
      const result = await createTestPlan(folder.label, folder.items || [], "");
      setPushResult(result);
    } catch (err: any) {
      setPushError(err.message);
    } finally {
      setPushing(false);
    }
  }

  function openAddModal(folderKey: string) {
    const folder = customFolders.find(f => f.key === folderKey);
    setModalSelected(new Set(folder?.items || []));
    setModalSearch("");
    setAddModal(folderKey);
    setCtxMenu(null);
  }

  function saveModalSelection() {
    const updated = customFolders.map(f =>
      f.key === addModal ? { ...f, items: [...modalSelected] } : f
    );
    setCustomFolders(updated);
    saveCustomFolders(updated);
    setAddModal(null);
  }

  function toggleModalItem(id: string) {
    setModalSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const modalItems = testIssues.filter(i =>
    !modalSearch.trim() ||
    i.id?.toLowerCase().includes(modalSearch.toLowerCase()) ||
    i.summary?.toLowerCase().includes(modalSearch.toLowerCase()) ||
    i.userStoryId?.toLowerCase().includes(modalSearch.toLowerCase())
  );

  const folderBtnClass = (key: string) =>
    `w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded transition-all mb-0.5 ${
      active === key
        ? "bg-[#ecfeff] text-[#0e7490] font-medium"
        : "text-[#64748b] hover:bg-[#f0f4f8] hover:text-[#1e293b]"
    }`;

  if (!connected) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Test Repository" subtitle="Categorized test case storage with full traceability" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <div className="text-4xl mb-4">🔌</div>
            <h2 className="text-base font-semibold text-[#1e293b] mb-2">Not connected to Jira</h2>
            <p className="text-sm text-[#64748b] mb-4">Configure your Jira credentials in Settings to browse the repository.</p>
            <a href="/settings" className="btn-primary inline-block">Go to Settings</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div><Header title="Test Repository" subtitle={`Project: ${getCredentials()?.projectKey} - Live Jira Data`} actions={<button className="btn-ghost text-xs" onClick={refresh}><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>Refresh</button>} /></div>
      <div className="flex-1 flex overflow-hidden">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="w-72 border-r border-[#DFE1E6] bg-[#F4F5F7] flex-shrink-0 flex flex-col">
          <div className="px-4 py-3 border-b border-[#DFE1E6] flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#97A0AF] uppercase tracking-widest">Folders</span>
            <button
              title="New Folder"
              onClick={() => { setCreating(true); setNewName(""); }}
              className="w-6 h-6 flex items-center justify-center rounded-md text-[#94a3b8] hover:text-[#0e7490] hover:bg-[#ecfeff] transition-all"
            >
              <PlusIcon />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            {/* System */}
            {[
              { key: "all", label: "All Test Cases", count: testIssues.length, icon: <FolderIcon />, color: "text-[#0052CC]", activeBg: "bg-[#0052CC]", activeCount: "bg-[#0747A6] text-white", inactiveCount: "text-[#0052CC] bg-[#DEEBFF] border border-[#B3D4FF]" },
              { key: "bugs", label: "Bugs", count: bugs.length, icon: <BugIcon />, color: "text-[#BF2600]", activeBg: "bg-[#BF2600]", activeCount: "bg-[#DE350B] text-white", inactiveCount: "text-[#BF2600] bg-[#FFEBE6] border border-[#FFBDAD]" },
            ].map(f => (
              <button key={f.key} onClick={() => setActive(f.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded transition-all mb-0.5 ${
                  active === f.key ? `${f.activeBg} text-white font-medium` : "text-[#5E6C84] hover:bg-[#EBECF0] hover:text-[#172B4D]"
                }`}>
                <span className={active === f.key ? "text-white" : f.color}>{f.icon}</span>
                <span className="flex-1 text-sm truncate">{f.label}</span>
                <span className={`text-[11px] min-w-[22px] text-center px-1.5 py-0.5 rounded font-bold tabular-nums ${
                  active === f.key ? f.activeCount : f.inactiveCount
                }`}>{f.count}</span>
              </button>
            ))}

            {/* User Stories */}
            {storyFolders.length > 0 && (
              <>
                <div className="px-2 pt-3 pb-1 flex items-center gap-2">
                  <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest">User Stories</span>
                  <div className="flex-1 h-px bg-[#f1f5f9]" />
                </div>
                {storyFolders.map(f => (
                  <button key={f.key} onClick={() => setActive(f.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded transition-all mb-0.5 ${
                      active === f.key ? "bg-[#403294] text-white font-medium" : "text-[#5E6C84] hover:bg-[#EAE6FF] hover:text-[#403294]"
                    }`}>
                    <span className={active === f.key ? "text-white" : "text-[#5243AA]"}><StoryIcon /></span>
                    <span className="flex-1 truncate font-mono text-[11px]">{f.label}</span>
                    <span className={`text-[11px] min-w-[22px] text-center px-1.5 py-0.5 rounded font-bold tabular-nums ${
                      active === f.key ? "bg-white/20 text-white" : "text-[#403294] bg-[#EAE6FF] border border-[#C0B6F2]"
                    }`}>{filterItems(f.key).length}</span>
                  </button>
                ))}
              </>
            )}

            {/* Custom */}
            {(customFolders.length > 0 || creating) && (
              <div className="px-2 pt-3 pb-1 flex items-center gap-2">
                <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest">Custom</span>
                <div className="flex-1 h-px bg-[#f1f5f9]" />
              </div>
            )}
            {customFolders.map(f => (
              <div key={f.key} className="relative group">
                {renamingKey === f.key ? (
                  <div className="px-1 py-1">
                    <input autoFocus className="input-field text-xs py-1" value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => handleRename(f.key)}
                      onKeyDown={e => { if (e.key === "Enter") handleRename(f.key); if (e.key === "Escape") setRenamingKey(null); }}
                    />
                  </div>
                ) : (
                  <button onClick={() => setActive(f.key)}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ key: f.key, x: e.clientX, y: e.clientY }); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded transition-all mb-0.5 ${
                      active === f.key ? "bg-[#974F0C] text-white font-medium" : "text-[#5E6C84] hover:bg-[#FFFAE6] hover:text-[#974F0C]"
                    }`}>
                    <span className={active === f.key ? "text-white" : "text-[#FF991F]"}><FolderIcon /></span>
                    <span className="flex-1 min-w-0 text-sm truncate">{f.label}</span>
                    <span className={`flex-shrink-0 text-[11px] min-w-[22px] text-center px-1.5 py-0.5 rounded font-bold tabular-nums opacity-0 group-hover:opacity-100 ${
                      active === f.key ? "bg-white/20 text-white opacity-100" : "text-[#974F0C] bg-[#FFFAE6] border border-[#FFE380]"
                    }`}>{(f.items || []).length}</span>
                    <span onClick={e => { e.stopPropagation(); setCtxMenu({ key: f.key, x: e.clientX, y: e.clientY }); }}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-[#cbd5e1] hover:text-[#475569] ml-0.5 text-base leading-none">⋯</span>
                  </button>
                )}
              </div>
            ))}

            {creating && (
              <div className="px-1 py-1">
                <input ref={newInputRef} className="input-field text-xs py-1" placeholder="Folder name"
                  value={newName} onChange={e => setNewName(e.target.value)}
                  onBlur={handleCreateFolder}
                  onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
                />
              </div>
            )}
          </div>

          {/* Bottom: New Folder above Recycle Bin */}
          <div className="border-t border-[#DFE1E6]">
            <div className="px-3 py-2">
              <button
                onClick={() => { setCreating(true); setNewName(""); }}
                className="w-full flex items-center gap-2 text-xs text-[#94a3b8] hover:text-[#0e7490] hover:bg-[#ecfeff] px-2 py-1.5 rounded transition-all"
              >
                <PlusIcon /> New Folder
              </button>
            </div>
            <div className="h-px bg-[#DFE1E6]" />
            <div className="px-2 py-2">
              <button onClick={() => setActive("recycle")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded transition-all ${
                  active === "recycle" ? "bg-[#42526E] text-white font-medium" : "text-[#97A0AF] hover:bg-[#EBECF0] hover:text-[#5E6C84]"
                }`}>
                <span className={active === "recycle" ? "text-white" : "text-[#94a3b8]"}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </span>
                <span className="flex-1 text-sm truncate">Recycle Bin</span>
                {recycleBin.length > 0 && (
                  <span className={`text-[11px] min-w-[22px] text-center px-1.5 py-0.5 rounded font-bold tabular-nums ${
                    active === "recycle" ? "bg-white/20 text-white" : "text-[#5E6C84] bg-[#EBECF0] border border-[#DFE1E6]"
                  }`}>{recycleBin.length}</span>
                )}
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 bg-[#F4F5F7]">
          {error && (
            <div className="banner-error mb-4">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              {error}
            </div>
          )}
          {execError && (
            <div className="banner-error mb-4 justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                {execError}
              </div>
              <button onClick={() => setExecError(null)} className="text-[#ff5630] hover:text-[#bf2600]">×</button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-3 text-sm text-[#64748b]">
                <div className="w-5 h-5 border-2 border-[#0e7490] border-t-transparent rounded-full animate-spin" />
                Loading from Jira…
              </div>
            </div>
          ) : (
            <div className="bg-white border border-[#DFE1E6] rounded overflow-hidden">

              {/* Table header */}
              <div className="px-5 py-3.5 border-b border-[#DFE1E6] flex items-center justify-between gap-3 flex-wrap bg-white">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-1 h-5 bg-[#0e7490] rounded-full flex-shrink-0" />
                  <span className="text-sm font-semibold text-[#1e293b] truncate">
                    {search.trim() ? "Search Results" : activeFolder?.label}
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#1e293b] text-white flex-shrink-0 tabular-nums min-w-[24px] text-center">
                    {filtered.length}
                  </span>
                  {!activeFolder?.isSystem && active.startsWith("custom_") && (
                    <div className="flex items-center gap-1.5 ml-1">
                      <button onClick={() => openAddModal(active)} className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1">
                        <PlusIcon /> Add
                      </button>
                      <button onClick={() => openPushModal(active)} className="btn-secondary text-xs py-1 px-2.5">↑ Push</button>
                      <button
                        onClick={() => handleExecuteFolder(active)}
                        disabled={executingFolder}
                        className="btn-primary text-xs py-1 px-2.5 flex items-center gap-1"
                      >
                        {executingFolder
                          ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Creating…</>
                          : <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z"/></svg> Execute</>}
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {active === "recycle" && recycleBin.length > 0 && (
                    <button onClick={clearBin} className="btn-danger text-xs py-1.5 px-3">Clear Bin</button>
                  )}
                  {!search.trim() && filtered.length > 0 && active !== "recycle" && (
                    <button onClick={() => setReportModal(active)} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
                      <ReportIcon /> Export PDF
                    </button>
                  )}
                  <div className="relative">
                    <svg className="w-3.5 h-3.5 text-[#94a3b8] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                    <input
                      className="input-field text-xs pl-8 w-52"
                      placeholder="Search test cases"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                {active === "recycle" ? (
                  <>
                    {recycleBin.length === 0 ? (
                      <div className="empty-state">
                        <div className="empty-state-icon"><svg className="w-6 h-6 text-[#94a3b8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></div>
                        <p className="empty-state-title">Recycle Bin is empty</p>
                        <p className="empty-state-desc">Deleted test cases will appear here.</p>
                      </div>
                    ) : (
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className="table-th">Key</th>
                            <th className="table-th">Summary</th>
                            <th className="table-th">User Story</th>
                            <th className="table-th">Deleted At</th>
                            <th className="table-th">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recycleBin.map((item: any) => (
                            <tr key={item.id} className="hover:bg-[#f0f4f8] transition-colors">
                              <td className="table-td"><span className="font-mono text-xs text-[#94a3b8] line-through">{item.id}</span></td>
                              <td className="table-td text-xs text-[#64748b] max-w-[240px] truncate">{item.summary}</td>
                              <td className="table-td">{item.userStoryId ? <span className="font-mono text-[11px] bg-[#ecfeff] text-[#0e7490] border border-[#a5f3fc] px-2 py-0.5 rounded-full">{item.userStoryId}</span> : <span className="text-[#cbd5e1]">—</span>}</td>
                              <td className="table-td text-xs text-[#94a3b8]">{item.deletedAt ? new Date(item.deletedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                              <td className="table-td">
                                <button className="text-xs text-[#0e7490] hover:text-[#0c5f75] hover:bg-[#ecfeff] px-2 py-1 rounded transition-colors font-medium" onClick={() => restoreFromBin(item.id)}>↩ Restore</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-th w-8"></th>
                        <th className="table-th">Key</th>
                        <th className="table-th">Summary</th>
                        <th className="table-th">User Story</th>
                        <th className="table-th">Priority</th>
                        <th className="table-th">Status</th>
                        <th className="table-th">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="table-td text-center py-16">
                            <div className="flex flex-col items-center gap-2">
                              <div className="w-10 h-10 bg-[#f0f4f8] rounded flex items-center justify-center">
                                <FolderIcon />
                              </div>
                              <p className="text-sm text-[#94a3b8]">
                                {active.startsWith("custom_")
                                  ? <span>No test cases. <button onClick={() => openAddModal(active)} className="text-[#0e7490] hover:underline">Add test cases</button></span>
                                  : "No items in this category."}
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : filtered.map((item: any) => (
                        <ExpandableRow
                          key={item.id}
                          item={item}
                          confirmDeleteId={confirmDeleteId}
                          deleteStep={deleteStep}
                          deleting={deleting}
                          onDelete={() => startDelete(item.id)}
                          onDeleteConfirm={confirmLocalDelete}
                          onJiraDelete={confirmJiraDelete}
                          onSkipJiraDelete={skipJiraDelete}
                          onDeleteCancel={cancelDelete}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 bg-white border border-[#e2e8f0] rounded py-1 min-w-[160px]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button className="w-full text-left px-4 py-2 text-sm text-[#1e293b] hover:bg-[#f0f4f8] flex items-center gap-2"
            onClick={() => openAddModal(ctxMenu.key)}>
            <PlusIcon /> Add Test Cases
          </button>
          <button className="w-full text-left px-4 py-2 text-sm text-[#0e7490] hover:bg-[#ecfeff]"
            onClick={() => openPushModal(ctxMenu.key)}>
            ↑ Push to Jira
          </button>
          <button className="w-full text-left px-4 py-2 text-sm text-[#5243aa] hover:bg-[#eae6ff]"
            onClick={() => { setReportModal(ctxMenu.key); setCtxMenu(null); }}>
            ↓ Export Report
          </button>
          <button className="w-full text-left px-4 py-2 text-sm text-[#1e293b] hover:bg-[#f0f4f8]"
            onClick={() => {
              const folder = customFolders.find(f => f.key === ctxMenu.key);
              if (folder) { setRenamingKey(ctxMenu.key); setRenameValue(folder.label); }
              setCtxMenu(null);
            }}>
            ✏ Rename
          </button>
          <button className="w-full text-left px-4 py-2 text-sm text-[#bf2600] hover:bg-[#ffebe6]"
            onClick={() => handleDeleteFolder(ctxMenu.key)}>
            Delete Folder
          </button>
        </div>
      )}

      {/* Report Modal */}
      {reportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded w-[500px] flex flex-col overflow-hidden">
            {/* Modal header */}
            <div className="bg-[#0A1628] px-6 py-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <LogoMark size={32} />
                    <div>
                      <div className="text-white font-bold text-sm leading-none">TestOrbit</div>
                      <div className="text-[10px] font-semibold tracking-widest uppercase mt-0.5" style={{ color: "#97A0AF" }}>AI Agent</div>
                    </div>
                  </div>
                  <p className="text-[#64748b] text-xs mt-2">Enterprise-grade PDF — 3 pages: Cover, Executive Summary, Test Details</p>
                </div>
                <button onClick={() => setReportModal(null)} className="text-[#64748b] hover:text-white transition-colors text-lg leading-none">✕</button>
              </div>
            </div>

            {/* Report preview */}
            <div className="px-6 py-5">
              {(() => {
                const items = filterItems(reportModal);
                const passed = items.filter(i => i.status === "Done" || i.status === "Passed").length;
                const failed = items.filter(i => i.status === "Failed").length;
                const pending = items.length - passed - failed;
                const passRate = items.length > 0 ? Math.round(passed / items.length * 100) : 0;
                const stories = [...new Set(items.map((i: any) => i.userStoryId).filter(Boolean))];
                return (
                  <>
                    {/* Folder info */}
                    <div className="flex items-center gap-3 mb-4 p-3 bg-[#f0f4f8] rounded border border-[#f1f5f9]">
                      <div className="w-9 h-9 bg-[#0e7490] rounded flex items-center justify-center flex-shrink-0">
                        <FolderIcon />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[#1e293b]">{allFolders.find(f => f.key === reportModal)?.label}</div>
                        <div className="text-xs text-[#94a3b8]">{getCredentials()?.projectKey} — {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className="text-2xl font-bold text-[#0e7490]">{passRate}%</div>
                        <div className="text-xs text-[#94a3b8]">Pass Rate</div>
                      </div>
                    </div>

                    {/* KPI row */}
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      {[
                        { label: "Total", value: items.length, color: "bg-[#1e293b] text-white" },
                        { label: "Passed", value: passed, color: "bg-[#E3FCEF] text-[#006644]" },
                        { label: "Failed", value: failed, color: "bg-[#FFEBE6] text-[#BF2600]" },
                        { label: "Pending", value: pending, color: "bg-[#FFFAE6] text-[#974F0C]" },
                      ].map(k => (
                        <div key={k.label} className={`${k.color} rounded p-3 text-center`}>
                          <div className="text-xl font-bold">{k.value}</div>
                          <div className="text-xs opacity-80 mt-0.5">{k.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Pass rate bar */}
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-[#64748b] mb-1">
                        <span>Pass Rate</span><span className="font-semibold text-[#1e293b]">{passRate}%</span>
                      </div>
                      <div className="h-2 bg-[#f1f5f9] rounded-full overflow-hidden">
                        <div className="h-full bg-[#10B981] rounded-full transition-all" style={{ width: `${passRate}%` }} />
                      </div>
                    </div>

                    {/* Report contents */}
                    <div className="bg-[#f0f4f8] rounded p-3 mb-4 border border-[#f1f5f9]">
                      <div className="text-xs font-semibold text-[#64748b] uppercase tracking-wide mb-2">Report Contents</div>
                      {[
                        { page: "Page 1", title: "Cover Page", desc: "Project info, scope, pass rate" },
                        { page: "Page 2", title: "Executive Summary", desc: "KPIs, priority breakdown, user stories, observations" },
                        { page: "Page 3+", title: "Test Case Details", desc: `Full table of ${items.length} test cases with status` },
                      ].map(r => (
                        <div key={r.page} className="flex items-center gap-3 py-1.5 border-b border-[#f1f5f9] last:border-0">
                          <span className="text-xs font-mono text-[#0e7490] w-14 flex-shrink-0">{r.page}</span>
                          <div>
                            <div className="text-xs font-semibold text-[#1e293b]">{r.title}</div>
                            <div className="text-xs text-[#94a3b8]">{r.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {stories.length > 0 && (
                      <div className="text-xs text-[#64748b] mb-4">
                        Covers <span className="font-semibold text-[#1e293b]">{stories.length}</span> user stor{stories.length === 1 ? "y" : "ies"}: {(stories as string[]).join(", ")}
                      </div>
                    )}
                  </>
                );
              })()}

              <div className="flex gap-2 justify-end">
                <button className="btn-secondary text-xs" onClick={() => setReportModal(null)}>Cancel</button>
                <button className="btn-primary text-xs flex items-center gap-1.5" onClick={() => generateReport(reportModal)}>
                  <ReportIcon /> Download PDF Report
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Push to Jira Modal */}
      {pushModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded w-[480px] flex flex-col">
            <div className="px-4 py-3 border-b border-[#f1f5f9] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#1e293b]">Push to Jira</h3>
                <p className="text-xs text-[#94a3b8] mt-0.5">Creates a Test Plan in Jira with all test cases in this folder</p>
              </div>
              <button onClick={() => { setPushModal(null); setPushResult(null); }} className="text-[#94a3b8] hover:text-[#475569] text-lg leading-none">✕</button>
            </div>
            <div className="px-5 py-5">
              {pushResult ? (
                <div className="text-center py-4">
                  <div className="text-3xl mb-3">✅</div>
                  <p className="text-sm font-semibold text-[#1e293b] mb-3">Test Plan created successfully!</p>
                  <div className="flex flex-col gap-2">
                    <a href={pushResult.url} target="_blank" rel="noreferrer" className="text-sm text-[#0e7490] hover:underline font-mono">{pushResult.key} - Open in Jira</a>
                    <a href={(pushResult as any).repositoryUrl} target="_blank" rel="noreferrer" className="text-xs text-[#64748b] hover:text-[#0e7490] hover:underline">View in Xray Test Repository →</a>
                  </div>
                </div>
              ) : (
                <>
                  <div className="bg-[#f0f4f8] rounded p-4 mb-4">
                    <div className="text-xs text-[#64748b] mb-1">Folder</div>
                    <div className="text-sm font-semibold text-[#1e293b]">{customFolders.find(f => f.key === pushModal)?.label}</div>
                    <div className="text-xs text-[#94a3b8] mt-1">{(customFolders.find(f => f.key === pushModal)?.items || []).length} test cases will be linked</div>
                  </div>
                  {pushError && <div className="text-xs text-[#bf2600] bg-[#ffebe6] border border-[#ffbdad] rounded px-3 py-2 mb-4">✗ {pushError}</div>}
                  <div className="flex gap-2 justify-end">
                    <button className="btn-secondary text-xs" onClick={() => setPushModal(null)}>Cancel</button>
                    <button className="btn-primary text-xs" onClick={handlePushToJira} disabled={pushing}>
                      {pushing ? "Pushing…" : "Push to Jira"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ─────────────────────────────────────── */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(15,45,61,0.55)", backdropFilter: "blur(2px)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
            {/* Header */}
            <div className="flex items-start gap-3 px-5 pt-5 pb-4">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#fef2f2" }}>
                <svg className="w-5 h-5" style={{ color: "#dc2626" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm" style={{ color: "#0f2d3d" }}>Delete test case?</h3>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: "#64748b" }}>
                  You are about to delete{" "}
                  <span className="font-semibold" style={{ color: "#1e293b" }}>"{deleteModal.summary}"</span>.
                  This will remove it from TestOrbit. Do you also want to delete it from Jira?
                </p>
              </div>
            </div>

            {/* Divider */}
            <div style={{ borderTop: "1px solid #f1f5f9" }} />

            {/* Actions */}
            <div className="px-5 py-4 flex flex-col gap-2">
              {/* Delete from both */}
              <button
                className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all text-left"
                style={{ backgroundColor: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#fee2e2"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#fef2f2"; }}
                disabled={deleting}
                onClick={handleDeleteWithJira}
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
                <div>
                  <div className="font-semibold">{deleting ? "Deleting from Jira…" : "Yes, delete from Jira too"}</div>
                  <div className="text-xs mt-0.5" style={{ color: "#ef4444", opacity: 0.8 }}>Permanently removes from both TestOrbit and Jira</div>
                </div>
              </button>

              {/* Remove from TestOrbit only */}
              <button
                className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all text-left"
                style={{ backgroundColor: "#f8fafc", color: "#475569", border: "1px solid #e2e8f0" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f1f5f9"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f8fafc"; }}
                disabled={deleting}
                onClick={handleDeleteLocalOnly}
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8m-9 4v6m4-6v6"/>
                </svg>
                <div>
                  <div className="font-semibold">Remove from TestOrbit only</div>
                  <div className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>Keeps the issue in Jira, moves to Recycle Bin here</div>
                </div>
              </button>

              {/* Cancel */}
              <button
                className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ color: "#64748b", backgroundColor: "transparent" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f8fafc"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                onClick={cancelDelete}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Toast Notification ─────────────────────────────────────── */}
      {deleteToast && (
        <div
          className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium animate-slide-up"
          style={{
            backgroundColor: deleteToast.type === "success" ? "#f0fdf4" : "#fef2f2",
            color: deleteToast.type === "success" ? "#15803d" : "#dc2626",
            border: `1px solid ${deleteToast.type === "success" ? "#bbf7d0" : "#fecaca"}`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            maxWidth: "360px",
          }}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {deleteToast.type === "success"
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              : <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            }
          </svg>
          <span>{deleteToast.msg}</span>
          <button
            className="ml-auto flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            onClick={() => setDeleteToast(null)}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}

      {/* Add Test Cases Modal */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded w-[600px] max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-[#f1f5f9] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#1e293b]">Add Test Cases</h3>
                <p className="text-xs text-[#94a3b8] mt-0.5">Select test cases to add to "{customFolders.find(f => f.key === addModal)?.label}"</p>
              </div>
              <button onClick={() => setAddModal(null)} className="text-[#94a3b8] hover:text-[#475569] text-lg leading-none">✕</button>
            </div>
            <div className="px-5 py-3 border-b border-[#f1f5f9]">
              <input
                autoFocus
                className="input-field text-sm"
                placeholder="Search test cases…"
                value={modalSearch}
                onChange={e => setModalSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {modalItems.length === 0 ? (
                <div className="text-sm text-[#94a3b8] text-center py-10">No test cases found.</div>
              ) : modalItems.map(item => (
                <label key={item.id} className="flex items-start gap-3 px-5 py-3 hover:bg-[#f0f4f8] cursor-pointer border-b border-[#f0f4f8]">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[#0e7490]"
                    checked={modalSelected.has(item.id)}
                    onChange={() => toggleModalItem(item.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[#1e293b] truncate">{item.summary}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono text-xs text-[#0e7490]">{item.id}</span>
                      {item.userStoryId && <span className="text-xs text-[#94a3b8]">{item.userStoryId}</span>}
                    </div>
                  </div>
                  <span className={`text-xs font-medium ${item.priority === "High" || item.priority === "Highest" ? "text-[#de350b]" : item.priority === "Medium" ? "text-[#ff991f]" : "text-[#94a3b8]"}`}>
                    {item.priority}
                  </span>
                </label>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-[#f1f5f9] flex items-center justify-between">
              <span className="text-xs text-[#94a3b8]">{modalSelected.size} selected</span>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={() => setAddModal(null)}>Cancel</button>
                <button className="btn-primary text-xs" onClick={saveModalSelection}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Repository;
