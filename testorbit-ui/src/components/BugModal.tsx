import React, { useState, useRef } from "react";
import { BugReport } from "../types";

interface BugModalProps {
  bug: BugReport;
  onConfirm: (bug: BugReport) => void;
  onClose: () => void;
  loading?: boolean;
}

const SEVERITIES = ["Critical", "High", "Medium", "Low"];
const PRIORITIES = ["Highest", "High", "Medium", "Low"];

const severityColor: Record<string, string> = {
  Critical: "text-[#BF2600] bg-[#FFEBE6] border-[#FFBDAD]",
  High:     "text-[#DE350B] bg-[#FFEBE6] border-[#FFBDAD]",
  Medium:   "text-[#974F0C] bg-[#FFFAE6] border-[#FFE380]",
  Low:      "text-[#5E6C84] bg-[#F4F5F7] border-[#DFE1E6]",
};

function bugToText(b: BugReport): string {
  return [
    `Title: ${b.title}`,
    ``,
    `Description:`,
    b.description,
    ``,
    `Steps to Reproduce:`,
    ...b.steps.map((s, i) => `${i + 1}. ${s}`),
    ``,
    `Expected Result:`,
    b.expectedResult,
    ``,
    `Actual Result:`,
    b.actualResult,
  ].join("\n");
}

function textToBug(text: string, base: BugReport): BugReport {
  const lines = text.split("\n");
  let title = base.title;
  let description = "";
  const steps: string[] = [];
  let expectedResult = "";
  let actualResult = "";
  let section = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("Title:"))            { title = line.replace("Title:", "").trim(); continue; }
    if (line === "Description:")              { section = "desc"; continue; }
    if (line === "Steps to Reproduce:")       { section = "steps"; continue; }
    if (line === "Expected Result:")          { section = "expected"; continue; }
    if (line === "Actual Result:")            { section = "actual"; continue; }
    if (!line) continue;

    const numbered = line.replace(/^\d+\.\s*/, "");
    if (section === "desc")     description   = description ? description + "\n" + line : line;
    else if (section === "steps")    steps.push(numbered);
    else if (section === "expected") expectedResult = expectedResult ? expectedResult + "\n" + line : line;
    else if (section === "actual")   actualResult   = actualResult   ? actualResult   + "\n" + line : line;
  }

  return {
    ...base,
    title:          title          || base.title,
    description:    description    || base.description,
    steps:          steps.length   ? steps : base.steps,
    expectedResult: expectedResult || base.expectedResult,
    actualResult:   actualResult   || base.actualResult,
  };
}

const BugModal: React.FC<BugModalProps> = ({ bug, onConfirm, onClose, loading }) => {
  const [draftText, setDraftText] = useState(() => bugToText(bug));
  const [severity, setSeverity] = useState<"Critical" | "High" | "Medium" | "Low">(bug.severity || "High");
  const [priority, setPriority]   = useState(bug.severity === "Critical" ? "Highest" : bug.severity || "High");
  const [userStoryId, setUserStoryId] = useState(bug.userStoryId || "");
  const [screenshots, setScreenshots] = useState<{ name: string; url: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(file => {
      if (!file.type.startsWith("image/")) return;
      const url = URL.createObjectURL(file);
      setScreenshots(prev => [...prev, { name: file.name, url }]);
    });
  };

  const handleConfirm = () => {
    const parsed = textToBug(draftText, bug);
    onConfirm({ ...parsed, severity, userStoryId });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded border border-[#DFE1E6] w-full max-w-2xl mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#DFE1E6]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-[#FFEBE6] border border-[#FFBDAD] flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-[#DE350B]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-[#172B4D]">Create Bug Report</h2>
            <span className="text-xs font-mono text-[#0052CC] bg-[#DEEBFF] px-2 py-0.5 rounded">{bug.testCaseId}</span>
          </div>
          <button onClick={onClose} className="text-[#97A0AF] hover:text-[#172B4D] transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Meta row */}
        <div className="px-5 py-3 border-b border-[#DFE1E6] flex items-center gap-4 bg-[#F4F5F7]">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[#5E6C84]">Severity</label>
            <select
              className={`text-xs font-semibold px-2.5 py-1.5 rounded border cursor-pointer focus:outline-none ${severityColor[severity] || severityColor.High}`}
              value={severity}
              onChange={e => setSeverity(e.target.value as "Critical" | "High" | "Medium" | "Low")}
            >
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[#5E6C84]">Priority</label>
            <select
              className="input-field text-xs py-1.5"
              value={priority}
              onChange={e => setPriority(e.target.value)}
            >
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[#5E6C84]">User Story</label>
            <input
              className="input-field text-xs font-mono w-28"
              value={userStoryId}
              onChange={e => setUserStoryId(e.target.value)}
              placeholder="e.g. PROJ-101"
            />
          </div>
        </div>

        {/* Single textarea */}
        <div className="px-5 py-4">
          <textarea
            className="w-full font-mono text-xs border-2 border-[#DFE1E6] rounded px-3 py-2.5 resize-y focus:outline-none focus:border-[#0052CC] bg-[#FAFBFC] leading-relaxed"
            rows={18}
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Screenshots */}
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-[#5E6C84] uppercase tracking-wide">Screenshots</label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs font-medium text-[#0052CC] hover:text-[#0065FF] flex items-center gap-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
              Add Screenshots
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => handleFiles(e.target.files)}
            />
          </div>
          {screenshots.length === 0 ? (
            <div
              className="border-2 border-dashed border-[#DFE1E6] rounded p-4 text-center cursor-pointer hover:border-[#0052CC] hover:bg-[#DEEBFF]/20 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            >
              <svg className="w-6 h-6 text-[#97A0AF] mx-auto mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
              <p className="text-xs text-[#97A0AF]">Click or drag &amp; drop screenshots here</p>
              <p className="text-[11px] text-[#C1C7D0] mt-0.5">PNG, JPG, GIF — multiple files supported</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {screenshots.map((s, i) => (
                <div key={i} className="relative group rounded border border-[#DFE1E6] overflow-hidden bg-[#F4F5F7]">
                  <img src={s.url} alt={s.name} className="w-full h-20 object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <button
                      className="opacity-0 group-hover:opacity-100 w-6 h-6 bg-white rounded-full flex items-center justify-center text-[#DE350B] transition-opacity"
                      onClick={() => setScreenshots(prev => prev.filter((_, idx) => idx !== i))}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                  <p className="text-[10px] text-[#5E6C84] truncate px-1.5 py-1 bg-white border-t border-[#DFE1E6]">{s.name}</p>
                </div>
              ))}
              <div
                className="border-2 border-dashed border-[#DFE1E6] rounded h-20 flex items-center justify-center cursor-pointer hover:border-[#0052CC] hover:bg-[#DEEBFF]/20 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
              >
                <svg className="w-5 h-5 text-[#97A0AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[#DFE1E6] bg-[#F4F5F7]">
          <button className="btn-secondary text-xs" onClick={onClose}>Cancel</button>
          <button className="btn-danger text-xs" onClick={handleConfirm} disabled={loading}>
            {loading ? "Creating…" : "Create Bug Report"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BugModal;
