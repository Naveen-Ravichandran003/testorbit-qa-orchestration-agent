import React from "react";
import { TestCase } from "../types";
import EditableRow from "./EditableRow";

interface TestCaseTableProps {
  testCases: TestCase[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onSave: (updated: TestCase) => void;
}

const TestCaseTable: React.FC<TestCaseTableProps> = ({
  testCases, selectedIds, onToggleSelect, onToggleAll, onSave
}) => {
  const allSelected = testCases.length > 0 && testCases.every(tc => selectedIds.has(tc.id));

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">
          Generated Test Cases <span className="text-slate-400 font-normal">({testCases.length})</span>
        </span>
        <span className="text-xs text-slate-500">{selectedIds.size} selected</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-th w-10">
                <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="w-4 h-4" />
              </th>
              <th className="table-th">ID</th>
              <th className="table-th">Title</th>
              <th className="table-th">Priority</th>
              <th className="table-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {testCases.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-td text-center text-slate-400 py-10">
                  No test cases generated yet. Enter a Jira ID and click Generate.
                </td>
              </tr>
            ) : (
              testCases.map(tc => (
                <EditableRow
                  key={tc.id}
                  tc={tc}
                  selected={selectedIds.has(tc.id)}
                  onSelect={() => onToggleSelect(tc.id)}
                  onSave={onSave}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TestCaseTable;
