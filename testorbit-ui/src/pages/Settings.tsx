import React, { useState, useEffect } from "react";
import Header from "../components/Header";
import { getCredentials, saveCredentials, fetchProjects, getXrayCredentials, saveXrayCredentials, fetchRagStats, clearRagStore } from "../jiraService";

const LLM_MODELS = [
  { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", provider: "groq" },
  { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", provider: "groq" },
  { value: "llama3-70b-8192", label: "Llama 3 70B", provider: "groq" },
  { value: "llama3-8b-8192", label: "Llama 3 8B", provider: "groq" },
  { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B", provider: "groq" },
  { value: "gemma2-9b-it", label: "Gemma 2 9B", provider: "groq" },
  { value: "gemma-7b-it", label: "Gemma 7B", provider: "groq" },
  { value: "grok-2", label: "Grok-2", provider: "xai" },
  { value: "mistral-7b", label: "Mistral 7B", provider: "mistral" },
];

const PROVIDER_LINKS: Record<string, { label: string; url: string }> = {
  groq: { label: "Get Groq API key ↗", url: "https://console.groq.com/keys" },
  xai: { label: "Get xAI API key ↗", url: "https://console.x.ai" },
  mistral: { label: "Get Mistral API key ↗", url: "https://console.mistral.ai/api-keys" }
};

const PROVIDER_ENDPOINTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  mistral: "https://api.mistral.ai/v1"
};

type StatusMsg = { type: "success" | "error"; msg: string } | null;

const Settings: React.FC = () => {
  // Jira
  const [jiraUrl, setJiraUrl] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projects, setProjects] = useState<{ key: string; name: string }[]>([]);
  const [jiraStatus, setJiraStatus] = useState<StatusMsg>(null);
  const [testing, setTesting] = useState(false);
  const [jiraConnected, setJiraConnected] = useState(false);

  // Xray
  const [xrayClientId, setXrayClientId] = useState("");
  const [xrayClientSecret, setXrayClientSecret] = useState("");
  const [xrayConnected, setXrayConnected] = useState(false);
  const [xrayStatus, setXrayStatus] = useState<StatusMsg>(null);
  const [testingXray, setTestingXray] = useState(false);

  // LLM
  const [llm, setLlm] = useState("llama-3.3-70b-versatile");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [topK, setTopK] = useState("5");
  const [llmStatus, setLlmStatus] = useState<StatusMsg>(null);
  const [testingLlm, setTestingLlm] = useState(false);

  // HuggingFace
  const [hfApiKey, setHfApiKey] = useState("");
  const [hfStatus, setHfStatus] = useState<StatusMsg>(null);
  const [testingHf, setTestingHf] = useState(false);

  // RAG store
  const [ragStats, setRagStats] = useState<{ totalEntries: number; byProject: { project_key: string; cnt: number }[]; mode: string; model: string } | null>(null);
  const [ragClearing, setRagClearing] = useState(false);
  const [ragStatus, setRagStatus] = useState<StatusMsg>(null);

  // Save / Reset
  const [saveStatus, setSaveStatus] = useState<StatusMsg>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const selectedModel = LLM_MODELS.find(m => m.value === llm);
  const provider = selectedModel?.provider || "groq";
  const providerLink = PROVIDER_LINKS[provider];

  useEffect(() => {
    const c = getCredentials();
    if (c) {
      setJiraUrl(c.jiraUrl); setEmail(c.email); setToken(c.token); setProjectKey(c.projectKey);
      setJiraConnected(true);
    }
    const pName = localStorage.getItem("testorbit_project_name");
    if (pName) setProjectName(pName);
    const xray = getXrayCredentials();
    if (xray) {
      setXrayClientId(xray.clientId);
      setXrayClientSecret(xray.clientSecret);
      setXrayConnected(true);
    }
    const llmConfig = localStorage.getItem("testorbit_llm");
    if (llmConfig) {
      const p = JSON.parse(llmConfig);
      setLlm(p.llm || "llama-3.3-70b-versatile");
      setLlmApiKey(p.apiKey || "");
      setLlmEndpoint(p.endpoint || "");
      setTopK(p.topK || "5");
    }
    const hf = localStorage.getItem("testorbit_hf");
    if (hf) setHfApiKey(JSON.parse(hf).apiKey || "");
    fetchRagStats().then(setRagStats).catch(() => {});
  }, []);

  const handleTestConnection = async () => {
    setTesting(true); setJiraStatus(null);
    try {
      if (!jiraUrl.trim())     throw new Error("Jira Base URL is required.");
      if (!email.trim())       throw new Error("Email is required.");
      if (!token.trim())       throw new Error("API Token is required.");
      if (!projectKey.trim())  throw new Error("Project Key is required.");
      if (!/^https?:\/\/.+/.test(jiraUrl.trim())) throw new Error("Jira Base URL must start with http:// or https://");
      if (!email.includes("@")) throw new Error("Enter a valid email address.");
      saveCredentials({ jiraUrl, email, token, projectKey });
      let res: Response;
      try {
        res = await fetch("http://localhost:3001/jira/projects", {
          headers: { "Content-Type": "application/json", jiraurl: jiraUrl, email, token }
        });
      } catch { throw new Error("Backend not running. Start the backend server first: node server.js"); }
      const text = await res.text();
      let list: { key: string; name: string }[];
      try { list = JSON.parse(text); } catch { throw new Error("Backend not running or returned unexpected response."); }
      if (!res.ok) throw new Error((list as any).error || "Connection failed.");
      if (list.length === 0) throw new Error("No projects found. Check your Project Key or Jira permissions.");
      const matched = list.find(p => p.key.toUpperCase() === projectKey.toUpperCase());
      if (!matched) throw new Error(`Project key "${projectKey}" not found. Available: ${list.map(p => p.key).join(", ")}`);
      setProjects(list);
      setProjectKey(matched.key);
      setProjectName(matched.name);
      localStorage.setItem("testorbit_project_name", matched.name);
      setJiraStatus({ type: "success", msg: `Connected! Project: ${matched.key} - ${matched.name}` });
      setJiraConnected(true);
    } catch (err: any) {
      setJiraStatus({ type: "error", msg: err.message });
    } finally { setTesting(false); }
  };

  const handleTestXray = async () => {
    setTestingXray(true); setXrayStatus(null);
    try {
      if (!xrayClientId.trim())     throw new Error("Client ID is required.");
      if (!xrayClientSecret.trim()) throw new Error("Client Secret is required.");
      let res: Response;
      try {
        res = await fetch("http://localhost:3001/xray/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: xrayClientId, clientSecret: xrayClientSecret })
        });
      } catch { throw new Error("Backend not running. Start the backend server first: node server.js"); }
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error("Backend not running or returned unexpected response."); }
      if (!res.ok) throw new Error(data.error || "Connection failed.");
      setXrayStatus({ type: "success", msg: "Xray connected! Test cases will be created as Xray Test issues." });
      setXrayConnected(true);
      saveXrayCredentials({ clientId: xrayClientId, clientSecret: xrayClientSecret });
    } catch (err: any) {
      setXrayStatus({ type: "error", msg: err.message });
    } finally { setTestingXray(false); }
  };

  const handleTestLlm = async () => {
    setTestingLlm(true); setLlmStatus(null);
    try {
      if (!llmApiKey.trim()) throw new Error("API Key is required.");
      let res: Response;
      try {
        res = await fetch("http://localhost:3001/llm/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: llm, apiKey: llmApiKey, endpoint: llmEndpoint, provider })
        });
      } catch { throw new Error("Backend not running. Start the backend server first: node server.js"); }
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error("Backend not running or returned unexpected response."); }
      if (!res.ok) throw new Error(data.error || "Connection failed.");
      setLlmStatus({ type: "success", msg: `Connected! Model: ${data.model}` });
    } catch (err: any) {
      setLlmStatus({ type: "error", msg: err.message });
    } finally { setTestingLlm(false); }
  };

  const handleTestHf = async () => {
    setTestingHf(true); setHfStatus(null);
    try {
      if (!hfApiKey.trim()) throw new Error("HuggingFace API key is required.");
      const res = await fetch("http://localhost:3001/rag/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hfApiKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed.");
      setHfStatus({ type: "success", msg: `Connected! Embedding model: ${data.model}` });
      localStorage.setItem("testorbit_hf", JSON.stringify({ apiKey: hfApiKey }));
      fetchRagStats().then(setRagStats).catch(() => {});
    } catch (err: any) {
      setHfStatus({ type: "error", msg: err.message });
    } finally { setTestingHf(false); }
  };

  const handleClearRag = async () => {
    setRagClearing(true); setRagStatus(null);
    try {
      const result = await clearRagStore();
      setRagStatus({ type: "success", msg: `Cleared ${result.cleared} entries from RAG store.` });
      setRagStats(prev => prev ? { ...prev, totalEntries: 0, storyCount: 0, hasEmbeddings: 0 } : null);
    } catch (err: any) {
      setRagStatus({ type: "error", msg: err.message });
    } finally { setRagClearing(false); }
  };

  const handleProjectSelect = (key: string) => {
    setProjectKey(key);
    const matched = projects.find(p => p.key === key);
    if (matched) { setProjectName(matched.name); localStorage.setItem("testorbit_project_name", matched.name); }
  };

  const handleSave = () => {
    const prev = getCredentials();
    saveCredentials({ jiraUrl, email, token, projectKey });
    localStorage.setItem("testorbit_llm", JSON.stringify({ llm, apiKey: llmApiKey, endpoint: llmEndpoint, topK }));
    if (hfApiKey) localStorage.setItem("testorbit_hf", JSON.stringify({ apiKey: hfApiKey }));
    if (projectName) localStorage.setItem("testorbit_project_name", projectName);
    if (xrayClientId && xrayClientSecret) {
      saveXrayCredentials({ clientId: xrayClientId, clientSecret: xrayClientSecret });
      setXrayConnected(true);
    }
    if (jiraUrl && email && token && projectKey) setJiraConnected(true);
    // Only trigger DataStore reload if Jira credentials actually changed
    const jiraChanged = !prev || prev.jiraUrl !== jiraUrl || prev.email !== email || prev.token !== token || prev.projectKey !== projectKey;
    if (jiraChanged) window.dispatchEvent(new Event("testorbit:credentials-saved"));
    setSaveStatus({ type: "success", msg: "Configuration saved successfully." });
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const handleReset = () => {
    ["testorbit_jira", "testorbit_llm", "testorbit_project_name", "testorbit_xray"].forEach(k => localStorage.removeItem(k));
    setJiraUrl(""); setEmail(""); setToken(""); setProjectKey(""); setProjectName(""); setProjects([]);
    setXrayClientId(""); setXrayClientSecret(""); setXrayStatus(null); setXrayConnected(false);
    setLlm("llama-3.3-70b-versatile"); setLlmApiKey(""); setLlmEndpoint(""); setTopK("5");
    setJiraStatus(null); setLlmStatus(null);
    setSaveStatus({ type: "success", msg: "Configuration reset. All credentials cleared." });
    setConfirmReset(false);
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const StatusBanner = ({ s }: { s: StatusMsg }) => s ? (
    <div className={`text-sm px-3 py-2 rounded border ${s.type === "success" ? "bg-[#e3fcef] border-[#abf5d1] text-green-800" : "bg-[#ffebe6] border-[#ffbdad] text-[#bf2600]"}`}>
      {s.type === "success" ? "✓" : "✗"} {s.msg}
    </div>
  ) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div><Header title="Settings" subtitle="System configuration and integrations" /></div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4 max-w-4xl">

        {/* Connection status summary */}
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: "Jira",
              sub: "Atlassian Jira Cloud",
              connected: jiraConnected,
              detail: jiraConnected ? (projectName || projectKey || "Connected") : "No credentials configured",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
                </svg>
              )
            },
            {
              label: "Xray",
              sub: "Test Management",
              connected: xrayConnected,
              detail: xrayConnected ? "Test issues & executions enabled" : "Optional integration",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                </svg>
              )
            },
            {
              label: "LLM Engine",
              sub: "AI Test Generation",
              connected: !!llmApiKey,
              detail: llmApiKey ? (selectedModel?.label || llm) : "No API key configured",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                </svg>
              )
            },
          ].map(({ label, sub, connected, detail, icon }) => (
            <div key={label} className="bg-white border rounded p-4" style={{ borderColor: connected ? "#ABF5D1" : "#DFE1E6" }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: connected ? "#E3FCEF" : "#F4F5F7", color: connected ? "#006644" : "#97A0AF" }}>
                  {icon}
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{
                  backgroundColor: connected ? "#E3FCEF" : "#F4F5F7",
                  color: connected ? "#006644" : "#5E6C84",
                  border: `1px solid ${connected ? "#ABF5D1" : "#DFE1E6"}`
                }}>
                  {connected ? "● Active" : "○ Inactive"}
                </span>
              </div>
              <div className="text-sm font-semibold" style={{ color: "#172B4D" }}>{label}</div>
              <div className="text-[11px] font-medium mb-1" style={{ color: "#97A0AF" }}>{sub}</div>
              <div className="text-xs truncate" style={{ color: connected ? "#5E6C84" : "#97A0AF" }}>{detail}</div>
            </div>
          ))}
        </div>

        {/* Jira + Xray side by side */}
        <div className="grid grid-cols-2 gap-5">

        {/* Jira */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-[#1e293b] uppercase tracking-wide">Jira Integration</h2>
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">Jira Base URL</label>
            <input className="input-field" placeholder="https://your-org.atlassian.net" value={jiraUrl} onChange={e => setJiraUrl(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">Email</label>
            <input className="input-field" type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">
              API Token
              <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" className="ml-2 text-[#0e7490] font-normal normal-case">Generate token ↗</a>
            </label>
            <input className="input-field" type="password" placeholder="••••••••••••••••" value={token} onChange={e => setToken(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">Project Key</label>
            <div className="flex gap-2">
              <input className="input-field" placeholder="e.g. PROJ" value={projectKey} onChange={e => setProjectKey(e.target.value)} />
              <button className="btn-secondary whitespace-nowrap" onClick={handleTestConnection} disabled={testing}>
                {testing ? "Testing…" : "Test Connection"}
              </button>
            </div>
            {projectName && <p className="text-xs text-[#006644] mt-1.5 font-medium">✓ Project: {projectName}</p>}
          </div>
          <StatusBanner s={jiraStatus} />
        </div>

        {/* Xray */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#1e293b] uppercase tracking-wide">Xray Integration</h2>
            <a href="https://docs.getxray.app/display/XRAYCLOUD/Global+Settings%3A+API+Keys" target="_blank" rel="noreferrer" className="text-xs text-[#0e7490] hover:underline">Get Xray API keys ↗</a>
          </div>
          <p className="text-xs text-[#64748b]">When configured, test cases are pushed as Xray <strong>Test</strong> issues with structured steps instead of plain Tasks.</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">Client ID</label>
              <input className="input-field" type="password" placeholder="••••••••••••••••" value={xrayClientId} onChange={e => setXrayClientId(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">Client Secret</label>
              <div className="flex gap-2">
                <input className="input-field" type="password" placeholder="••••••••••••••••" value={xrayClientSecret} onChange={e => setXrayClientSecret(e.target.value)} />
                <button className="btn-secondary whitespace-nowrap" onClick={handleTestXray} disabled={testingXray}>
                  {testingXray ? "Testing…" : "Test Connection"}
                </button>
              </div>
            </div>
          </div>
          <StatusBanner s={xrayStatus} />
        </div>
        </div> {/* end Jira+Xray grid */}

        {/* LLM + Embedding side by side */}
        <div className="grid grid-cols-2 gap-5">

        {/* LLM */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-[#1e293b] uppercase tracking-wide">LLM Configuration</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">Model</label>
              <select className="input-field" value={llm} onChange={e => setLlm(e.target.value)}>
                <optgroup label="Groq (Open Source — Recommended)">
                  {LLM_MODELS.filter(m => m.provider === "groq").map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </optgroup>
                <optgroup label="Other Providers">
                  {LLM_MODELS.filter(m => m.provider !== "groq").map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">RAG Top-K</label>
              <select className="input-field" value={topK} onChange={e => setTopK(e.target.value)}>
                {["3", "5", "8", "10"].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">
              API Key
              <a href={providerLink.url} target="_blank" rel="noreferrer" className="ml-2 text-[#0e7490] font-normal normal-case">{providerLink.label}</a>
            </label>
            <div className="flex gap-2">
              <input className="input-field" type="password" placeholder="••••••••••••••••••••••••••••••••" value={llmApiKey} onChange={e => setLlmApiKey(e.target.value)} />
              <button className="btn-secondary whitespace-nowrap" onClick={handleTestLlm} disabled={testingLlm}>
                {testingLlm ? "Testing…" : "Test Connection"}
              </button>
            </div>
            <StatusBanner s={llmStatus} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">
              Custom Endpoint
              <span className="ml-2 text-[#94a3b8] font-normal normal-case">(optional — leave blank to use default)</span>
            </label>
            <input className="input-field" type="url" placeholder={PROVIDER_ENDPOINTS[provider]} value={llmEndpoint} onChange={e => setLlmEndpoint(e.target.value)} />
          </div>
        </div>

        {/* Embedding & RAG */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#1e293b] uppercase tracking-wide">RAG Embedding</h2>
            <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer" className="text-xs text-[#0e7490] hover:underline">Get HuggingFace token ↗</a>
          </div>
          <p className="text-xs text-[#64748b]">Uses <strong>sentence-transformers/all-MiniLM-L6-v2</strong> (free, open-source) for semantic similarity. Enables RAG to find truly similar test cases across stories.</p>
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">HuggingFace API Key</label>
            <div className="flex gap-2">
              <input className="input-field" type="password" placeholder="hf_••••••••••••••••" value={hfApiKey} onChange={e => setHfApiKey(e.target.value)} />
              <button className="btn-secondary whitespace-nowrap" onClick={handleTestHf} disabled={testingHf}>
                {testingHf ? "Testing…" : "Test Connection"}
              </button>
            </div>
          </div>
          <StatusBanner s={hfStatus} />
          {ragStats && (
            <div className="bg-[#f0f4f8] border border-[#e2e8f0] rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#475569]">RAG Store</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  ragStats.mode === "semantic" ? "bg-green-100 text-[#006644]" : "bg-[#e2e8f0] text-[#475569]"
                }`}>{ragStats.mode}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div><div className="text-lg font-semibold text-[#1e293b]">{ragStats.totalEntries}</div><div className="text-xs text-[#64748b]">total entries</div></div>
                <div><div className="text-lg font-semibold text-[#1e293b]">{ragStats.byProject?.length ?? 0}</div><div className="text-xs text-[#64748b]">projects</div></div>
              </div>
              {ragStats.byProject?.length > 0 && (
                <div className="text-xs text-[#64748b] space-y-0.5">
                  {ragStats.byProject.map(p => (
                    <div key={p.project_key} className="flex justify-between">
                      <span className="font-mono text-[#0e7490]">{p.project_key}</span>
                      <span>{p.cnt} entries</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-[#64748b]">Model: {ragStats.model}</p>
              <div className="flex items-center gap-2">
                <button className="btn-secondary text-xs py-1 px-3" onClick={() => fetchRagStats().then(setRagStats).catch(() => {})}>Refresh</button>
                {ragStats.totalEntries > 0 && (
                  <button className="btn-danger text-xs py-1 px-3" onClick={handleClearRag} disabled={ragClearing}>
                    {ragClearing ? "Clearing…" : "Clear Store"}
                  </button>
                )}
              </div>
              <StatusBanner s={ragStatus} />
            </div>
          )}
        </div>
        </div> {/* end LLM+Embedding grid */}

        <StatusBanner s={saveStatus} />
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={handleSave}>Save Configuration</button>
          {confirmReset ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#bf2600] font-medium">Reset all config?</span>
              <button className="btn-danger py-1.5 px-3 text-xs" onClick={handleReset}>Yes, Reset</button>
              <button className="btn-secondary py-1.5 px-3 text-xs" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn-secondary" onClick={() => setConfirmReset(true)}>Reset Configuration</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
