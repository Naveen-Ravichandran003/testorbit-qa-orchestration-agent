import React, { useState, useEffect } from "react";
import { TestCase, Priority } from "../types";

interface EditableRowProps {
  tc: TestCase;
  selected: boolean;
  onSelect: () => void;
  onSave: (updated: TestCase) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  Highest: "text-[#BF2600] bg-[#FFEBE6] border-[#FFBDAD]",
  High:    "text-[#DE350B] bg-[#FFEBE6] border-[#FFBDAD]",
  Medium:  "text-[#974F0C] bg-[#FFFAE6] border-[#FFE380]",
  Low:     "text-[#5E6C84] bg-[#F4F5F7] border-[#DFE1E6]",
};

// Convert TestCase fields to a single editable text block
function tcToText(tc: TestCase): string {
  return [
    `Title: ${tc.title}`,
    ``,
    `Preconditions:`,
    ...tc.preconditions.map((p, i) => `${i + 1}. ${p}`),
    ``,
    `Steps:`,
    ...tc.steps.map((s, i) => `${i + 1}. ${s}`),
    ``,
    `Expected Result:`,
    tc.expectedResult,
    ``,
    `Test Data: ${tc.testData || ""}`,
    ``,
    `Post Conditions:`,
    ...(tc.postConditions || []).map((p, i) => `${i + 1}. ${p}`),
  ].join("\n");
}

// Parse the text block back into TestCase fields
function textToTc(text: string, base: TestCase): TestCase {
  const lines = text.split("\n");
  let title = base.title;
  const preconditions: string[] = [];
  const steps: string[] = [];
  let expectedResult = base.expectedResult;
  let testData = base.testData || "";
  const postConditions: string[] = [];

  let section = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("Title:")) { title = line.replace("Title:", "").trim(); continue; }
    if (line === "Preconditions:") { section = "pre"; continue; }
    if (line === "Steps:") { section = "steps"; continue; }
    if (line === "Expected Result:") { section = "expected"; continue; }
    if (line.startsWith("Test Data:")) { testData = line.replace("Test Data:", "").trim(); section = ""; continue; }
    if (line === "Post Conditions:") { section = "post"; continue; }
    if (!line) continue;

    const numbered = line.replace(/^\d+\.\s*/, "");
    if (section === "pre") preconditions.push(numbered);
    else if (section === "steps") steps.push(numbered);
    else if (section === "expected") expectedResult = (expectedResult === base.expectedResult ? "" : expectedResult + "\n") + line;
    else if (section === "post") postConditions.push(numbered);
  }

  return {
    ...base,
    title: title || base.title,
    preconditions: preconditions.length ? preconditions : base.preconditions,
    steps: steps.length ? steps : base.steps,
    expectedResult: expectedResult || base.expectedResult,
    testData,
    postConditions: postConditions.length ? postConditions : base.postConditions,
  };
}

const EditableRow: React.FC<EditableRowProps> = ({ tc, selected, onSelect, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftPriority, setDraftPriority] = useState<Priority>(tc.priority as Priority);

  useEffect(() => { if (!editing) setDraftPriority(tc.priority as Priority); }, [tc, editing]);

  const handleEdit = () => {
    setDraftText(tcToText(tc));
    setDraftPriority(tc.priority as Priority);
    setEditing(true);
    setExpanded(false);
  };

  const handleSave = () => {
    const updated = textToTc(draftText, tc);
    onSave({ ...updated, priority: draftPriority });
    setEditing(false);
  };

  const handleCancel = () => { setEditing(false); };

  const priorityColor = PRIORITY_COLORS[tc.priority] || PRIORITY_COLORS.Low;

  return (
    <>
      <tr className={`transition-colors ${editing ? "bg-[#DEEBFF]/20" : "hover:bg-[#F4F5F7]"}`}>
        <td className="table-td w-8">
          <input type="checkbox" checked={selected} onChange={onSelect} className="w-4 h-4 accent-[#0052CC]" />
        </td>
        <td className="table-td font-mono text-xs text-[#5E6C84] whitespace-nowrap">{tc.id}</td>
        <td className="table-td text-sm font-medium text-[#172B4D]">{tc.title}</td>
        <td className="table-td">
          <select
            className={`text-xs font-semibold px-2 py-1 rounded border cursor-pointer focus:outline-none ${priorityColor}`}
            value={tc.priority}
            onChange={e => onSave({ ...tc, priority: e.target.value as Priority })}
          >
            <option value="Highest">Highest</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </td>
        <td className="table-td">
          <div className="flex gap-2">
            <button
              className="btn-secondary py-1 px-2.5 text-xs flex items-center gap-1"
              onClick={() => { setExpanded(!expanded); setEditing(false); }}
            >
              <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
              {expanded ? "Collapse" : "Expand"}
            </button>
            <button className="btn-secondary py-1 px-2.5 text-xs" onClick={handleEdit}>Edit</button>
          </div>
        </td>
      </tr>

      {/* Edit mode — single textarea */}
      {editing && (
        <tr className="bg-[#DEEBFF]/10">
          <td colSpan={5} className="px-5 py-4 border-t border-[#DFE1E6]">
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-[#172B4D]">Editing {tc.id}</span>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-[#5E6C84]">Priority</label>
                  <select
                    className={`text-xs font-semibold px-2 py-1 rounded border cursor-pointer focus:outline-none ${PRIORITY_COLORS[draftPriority] || PRIORITY_COLORS.Low}`}
                    value={draftPriority}
                    onChange={e => setDraftPriority(e.target.value as Priority)}
                  >
                    <option value="Highest">Highest</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
              </div>
              <textarea
                className="input-field w-full font-mono text-xs resize-y"
                rows={20}
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                spellCheck={false}
              />
              <p className="text-[11px] text-[#97A0AF]">
                Edit freely — keep section headers (Title:, Preconditions:, Steps:, Expected Result:, Test Data:, Post Conditions:) intact for correct parsing.
              </p>
              <div className="flex gap-2">
                <button className="btn-primary text-xs py-1.5 px-4" onClick={handleSave}>Save</button>
                <button className="btn-secondary text-xs py-1.5 px-4" onClick={handleCancel}>Cancel</button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* Expand mode — read only */}
      {expanded && !editing && (
        <tr className="bg-[#F4F5F7]">
          <td colSpan={5} className="px-6 py-4 border-t border-[#DFE1E6]">
            <div className="grid grid-cols-2 gap-5 text-xs">
              <div>
                <p className="text-[11px] font-semibold text-[#5E6C84] uppercase tracking-wide mb-1.5">Preconditions</p>
                <ol className="space-y-1">
                  {tc.preconditions.map((p, i) => (
                    <li key={i} className="flex gap-2 text-[#172B4D]">
                      <span className="text-[#97A0AF] flex-shrink-0">{i + 1}.</span>{p}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#5E6C84] uppercase tracking-wide mb-1.5">Steps</p>
                <ol className="space-y-1">
                  {tc.steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-[#172B4D]">
                      <span className="text-[#97A0AF] flex-shrink-0">{i + 1}.</span>{s}
                    </li>
                  ))}
                </ol>
              </div>
              <div className="col-span-2">
                <p className="text-[11px] font-semibold text-[#5E6C84] uppercase tracking-wide mb-1.5">Expected Result</p>
                <p className="text-[#172B4D] leading-relaxed">{tc.expectedResult}</p>
              </div>
              {tc.testData && (
                <div className="col-span-2">
                  <p className="text-[11px] font-semibold text-[#5E6C84] uppercase tracking-wide mb-1.5">Test Data</p>
                  <p className="font-mono text-[#172B4D] bg-white border border-[#DFE1E6] px-2 py-1.5 rounded">{tc.testData}</p>
                </div>
              )}
              {tc.postConditions?.length > 0 && (
                <div className="col-span-2">
                  <p className="text-[11px] font-semibold text-[#5E6C84] uppercase tracking-wide mb-1.5">Post Conditions</p>
                  <ol className="space-y-1">
                    {tc.postConditions.map((p, i) => (
                      <li key={i} className="flex gap-2 text-[#172B4D]">
                        <span className="text-[#97A0AF] flex-shrink-0">{i + 1}.</span>{p}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export default EditableRow;
