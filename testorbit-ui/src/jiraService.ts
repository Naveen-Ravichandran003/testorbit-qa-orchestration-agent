const BASE = "http://localhost:3001";

export interface JiraCredentials { jiraUrl: string; email: string; token: string; projectKey: string; }
export interface XrayCredentials { clientId: string; clientSecret: string; }

export function getCredentials(): JiraCredentials | null {
  try { return JSON.parse(localStorage.getItem("testorbit_jira") || ""); } catch { return null; }
}
export function saveCredentials(c: JiraCredentials) { localStorage.setItem("testorbit_jira", JSON.stringify(c)); }

export function getXrayCredentials(): XrayCredentials | null {
  try { return JSON.parse(localStorage.getItem("testorbit_xray") || ""); } catch { return null; }
}
export function saveXrayCredentials(c: XrayCredentials) { localStorage.setItem("testorbit_xray", JSON.stringify(c)); }

export function getLlmConfig() {
  try { return JSON.parse(localStorage.getItem("testorbit_llm") || ""); } catch { return null; }
}

function headers(): Record<string, string> {
  const c = getCredentials();
  if (!c) throw new Error("Jira credentials not configured. Go to Settings.");
  return { "Content-Type": "application/json", jiraurl: c.jiraUrl, email: c.email, token: c.token };
}

async function call(url: string, options: RequestInit = {}) {
  let res: Response;
  try { res = await fetch(url, options); } catch { throw new Error("Backend not running. Start server.js first."); }
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error("Backend returned unexpected response."); }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Extract Jira issue key from either a plain ID (SCRUM-5) or a full URL
export function extractJiraId(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/browse\/([A-Z]+-\d+)/i);
  if (urlMatch) return urlMatch[1].toUpperCase();
  const idMatch = trimmed.match(/^[A-Z]+-\d+$/i);
  if (idMatch) return trimmed.toUpperCase();
  return trimmed;
}

export async function fetchIssue(jiraId: string) {
  return call(`${BASE}/jira/issue/${jiraId}`, { headers: headers() });
}

export async function fetchProjects() {
  return call(`${BASE}/jira/projects`, { headers: headers() }) as Promise<{ key: string; name: string }[]>;
}

export function getHfConfig() {
  try { return JSON.parse(localStorage.getItem("testorbit_hf") || ""); } catch { return null; }
}

export async function generateTestCases(story: any, notes: string, scope: Record<string, boolean>) {
  const llm = getLlmConfig();
  if (!llm?.apiKey) throw new Error("LLM not configured. Go to Settings and add your API key.");
  const hf = getHfConfig();
  const c = getCredentials();
  return call(`${BASE}/llm/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      story, notes, scope,
      projectKey: c?.projectKey || story.id.replace(/-\d+$/, ""),
      topK: parseInt(llm.topK) || 5,
      hfApiKey: hf?.apiKey || "",
      llmConfig: { model: llm.llm, apiKey: llm.apiKey, endpoint: llm.endpoint, provider: llm.provider || "groq" }
    })
  });
}

export async function fetchRagStats() {
  return call(`${BASE}/rag/stats`) as Promise<{ totalEntries: number; byProject: { project_key: string; cnt: number }[]; mode: string; model: string }>;
}

export async function clearRagStore() {
  return call(`${BASE}/rag/clear`, { method: "DELETE" }) as Promise<{ success: boolean; cleared: number }>;
}

export async function pushTestCase(testCase: object, userStoryId: string) {
  const c = getCredentials()!;
  const xray = getXrayCredentials();
  return call(`${BASE}/jira/testcase`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ projectKey: c.projectKey, testCase, userStoryId, xrayClientId: xray?.clientId || "", xrayClientSecret: xray?.clientSecret || "" })
  }) as Promise<{ key: string; url: string }>;
}

export async function fetchTestCasesByStory(storyId: string) {
  return call(`${BASE}/jira/testcases-by-story/${storyId}`, { headers: headers() }) as Promise<any[]>;
}

export async function fetchTestCasesByPlan(planId: string) {
  return call(`${BASE}/jira/testcases-by-plan/${planId}`, { headers: headers() }) as Promise<any[]>;
}

export async function fetchTestCaseById(testCaseId: string) {
  return call(`${BASE}/jira/testcase/${testCaseId}`, { headers: headers() }) as Promise<any[]>;
}

export async function createBug(bug: object) {
  const c = getCredentials()!;
  const xray = getXrayCredentials();
  return call(`${BASE}/jira/bug`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ projectKey: c.projectKey, bug, xrayClientId: xray?.clientId || "", xrayClientSecret: xray?.clientSecret || "" })
  }) as Promise<{ key: string; url: string }>;
}

export async function createTestPlan(planName: string, testCaseKeys: string[], userStoryId: string) {
  const c = getCredentials()!;
  const xray = getXrayCredentials();
  return call(`${BASE}/jira/testplan`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ projectKey: c.projectKey, planName, testCaseKeys, userStoryId, xrayClientId: xray?.clientId || "", xrayClientSecret: xray?.clientSecret || "" })
  }) as Promise<{ key: string; url: string }>;
}

export async function executeFolder(folderName: string, testCaseKeys: string[]) {
  const c = getCredentials()!;
  const xray = getXrayCredentials();
  // Step 1: create Test Plan
  const plan = await createTestPlan(folderName, testCaseKeys, "");
  // Step 2: create Test Execution linked to that plan
  const exec = await createTestExecution(plan.key, testCaseKeys, `Execution - ${folderName}`);
  return { planKey: plan.key, execKey: exec.key, planUrl: plan.url, execUrl: exec.url };
}

export async function fetchIssues(label?: string) {
  const c = getCredentials()!;
  const params = new URLSearchParams({ projectKey: c.projectKey });
  if (label) params.set("label", label);
  return call(`${BASE}/jira/issues?${params}`, { headers: headers() }) as Promise<any[]>;
}

export async function fetchBugs() {
  const c = getCredentials()!;
  return call(`${BASE}/jira/bugs?projectKey=${c.projectKey}`, { headers: headers() }) as Promise<any[]>;
}

export async function createTestExecution(planKey: string, testCaseKeys: string[], summary: string) {
  const c = getCredentials()!;
  const xray = getXrayCredentials();
  return call(`${BASE}/jira/testexecution`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      projectKey: c.projectKey, planKey, testCaseKeys, summary,
      xrayClientId: xray?.clientId || "", xrayClientSecret: xray?.clientSecret || ""
    })
  }) as Promise<{ key: string; url: string }>;
}

export async function updateTestExecutionStatus(execKey: string, testCaseKey: string, status: "Pass" | "Fail") {
  const xray = getXrayCredentials();
  return call(`${BASE}/jira/testexecution/status`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      execKey, testCaseKey, status,
      xrayClientId: xray?.clientId || "", xrayClientSecret: xray?.clientSecret || ""
    })
  });
}

export async function updateTestStatus(issueKey: string, status: "Pass" | "Fail", testPlanKey?: string) {
  return call(`${BASE}/jira/update-status`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ issueKey, status })
  });
}

export async function evaluateResult(expectedResult: string, actualResult: string) {
  const llm = getLlmConfig();
  if (!llm?.apiKey) throw new Error("LLM not configured.");
  return call(`${BASE}/llm/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedResult, actualResult, llmConfig: { model: llm.llm, apiKey: llm.apiKey, endpoint: llm.endpoint, provider: llm.provider || "groq" } })
  }) as Promise<{ status: "Pass" | "Fail"; reason: string }>;
}

export async function fetchActivity() {
  const c = getCredentials()!;
  return call(`${BASE}/jira/activity?projectKey=${c.projectKey}`, { headers: headers() }) as Promise<any[]>;
}

export async function fetchSprints(projectKey: string) {
  const c = getCredentials()!;
  return call(`${BASE}/jira/sprints?projectKey=${projectKey}`, { headers: headers() }) as Promise<any[]>;
}

export async function fetchSprintCoverage(projectKey: string, sprintId: number) {
  const c = getCredentials()!;
  return call(`${BASE}/jira/sprint-coverage?projectKey=${projectKey}&sprintId=${sprintId}`, { headers: headers() });
}

export async function deleteIssue(issueId: string) {
  return call(`${BASE}/jira/issue/${issueId}`, { method: "DELETE", headers: headers() });
}
