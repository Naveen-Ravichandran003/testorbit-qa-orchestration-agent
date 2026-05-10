import React from "react";

interface Scope {
  positive: boolean;
  negative: boolean;
  edge: boolean;
}

interface InputFormProps {
  jiraId: string;
  notes: string;
  scope: Scope;
  onJiraIdChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onScopeChange: (key: keyof Scope) => void;
  onFetch: () => void;
  onGenerate: () => void;
  fetching: boolean;
  generating: boolean;
}

const InputForm: React.FC<InputFormProps> = ({
  jiraId, notes, scope, onJiraIdChange, onNotesChange,
  onScopeChange, onFetch, onGenerate, fetching, generating
}) => (
  <div className="card">
    <h2 className="text-sm font-semibold text-slate-700 mb-4 uppercase tracking-wide">Input Panel</h2>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-1">
        <label className="block text-xs font-medium text-slate-600 mb-1">Jira ID or URL</label>
        <div className="flex gap-2">
          <input
            className="input-field"
            placeholder="Issue ID or Jira URL"
            value={jiraId}
            onChange={e => onJiraIdChange(e.target.value)}
          />
          <button className="btn-secondary whitespace-nowrap" onClick={onFetch} disabled={!jiraId || fetching}>
            {fetching ? "Fetching…" : "Fetch"}
          </button>
        </div>
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">Additional Notes</label>
        <textarea
          className="input-field resize-none"
          rows={2}
          placeholder="Add constraints, focus areas or tester notes"
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
        />
      </div>
    </div>
    <div className="mt-4 flex items-center justify-between">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-2">Scope Selection</label>
        <div className="flex gap-5">
          {(["positive", "negative", "edge"] as (keyof Scope)[]).map(key => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={scope[key]}
                onChange={() => onScopeChange(key)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </label>
          ))}
        </div>
      </div>
      <button
        className="btn-primary"
        onClick={onGenerate}
        disabled={!jiraId || generating}
      >
        {generating ? "Generating…" : "Generate Test Cases"}
      </button>
    </div>
  </div>
);

export default InputForm;
