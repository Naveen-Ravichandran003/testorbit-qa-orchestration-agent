require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000
});
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." }
});
app.use("/llm/", rateLimit({ windowMs: 60000, max: 30, message: { error: "LLM rate limit exceeded." } }));
app.use("/jira/", limiter);
app.use("/rag/", limiter);

// ─── API token auth (optional — only enforced when API_TOKEN is set in .env) ──
const API_TOKEN = process.env.API_TOKEN;
app.use((req, res, next) => {
  if (!API_TOKEN) return next();
  // Skip auth for health-check and read-only sync endpoints
  if (req.path === "/" || req.path.startsWith("/sync/")) return next();
  const provided = req.headers["x-api-token"];
  if (!provided || provided !== API_TOKEN) return res.status(401).json({ error: "Unauthorized: invalid or missing x-api-token header." });
  next();
});

// ─── SQLite shared DB ────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, "testorbit.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS rag_store (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_key TEXT NOT NULL,
    story_id TEXT NOT NULL,
    title TEXT NOT NULL,
    expected_result TEXT,
    vec TEXT,
    embedding TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_key, story_id, title)
  );
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_key TEXT NOT NULL,
    folder_key TEXT NOT NULL,
    label TEXT NOT NULL,
    items TEXT DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_key, folder_key)
  );
  CREATE TABLE IF NOT EXISTS recycle_bin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_key TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    data TEXT NOT NULL,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_key, issue_id)
  );
  CREATE TABLE IF NOT EXISTS board_rows (
    board_id TEXT NOT NULL,
    row_id   TEXT NOT NULL,
    data     TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (board_id, row_id)
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_key TEXT NOT NULL,
    board_id   TEXT,
    user_name  TEXT NOT NULL,
    user_color TEXT NOT NULL,
    action     TEXT NOT NULL,
    detail     TEXT,
    ts         DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
console.log("SQLite DB ready at", path.join(__dirname, "testorbit.db"));

// ─── Prepared statements ─────────────────────────────────────────────────────
const stmtUpsertRow  = db.prepare(`INSERT INTO board_rows (board_id, row_id, data, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(board_id,row_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`);
const stmtGetRows    = db.prepare(`SELECT row_id, data FROM board_rows WHERE board_id = ? ORDER BY rowid ASC`);
const stmtDeleteBoard= db.prepare(`DELETE FROM board_rows WHERE board_id = ?`);
const stmtInsertLog  = db.prepare(`INSERT INTO activity_log (project_key, board_id, user_name, user_color, action, detail) VALUES (?,?,?,?,?,?)`);
const stmtGetLog     = db.prepare(`SELECT * FROM activity_log WHERE project_key = ? ORDER BY ts DESC LIMIT 50`);

// ─── Presence map  projectKey -> Map<socketId, {name,color,page,boardId}> ────
const presence = {};

function getPresence(projectKey) {
  return Object.values(presence[projectKey] || {});
}

function setPresence(projectKey, socketId, info) {
  if (!presence[projectKey]) presence[projectKey] = {};
  presence[projectKey][socketId] = info;
}

function removePresence(socketId) {
  for (const pk of Object.keys(presence)) {
    delete presence[pk][socketId];
  }
}

// ─── Debounce helper ─────────────────────────────────────────────────────────
const writeTimers = {};
function debouncedWrite(key, fn, delay = 300) {
  clearTimeout(writeTimers[key]);
  writeTimers[key] = setTimeout(fn, delay);
}

// ─── Socket.IO — professional multi-user sync ────────────────────────────────
io.on("connection", socket => {
  let socketProjectKey = null;
  let socketBoardId    = null;
  let socketUser       = { name: "Tester", color: "#6366f1" };

  // ── 1. Identify user & join project channel ──────────────────────────────
  socket.on("identify", ({ projectKey, user }) => {
    socketProjectKey = projectKey;
    socketUser = user || socketUser;
    socket.join(`project:${projectKey}`);
    setPresence(projectKey, socket.id, { ...socketUser, page: "dashboard", boardId: null, socketId: socket.id });
    // Send current presence to the joining user
    socket.emit("presence", getPresence(projectKey));
    // Broadcast updated presence to everyone in the project
    io.to(`project:${projectKey}`).emit("presence", getPresence(projectKey));
    // Send last 50 activity items
    const logs = stmtGetLog.all(projectKey);
    socket.emit("activity_history", logs.reverse());
  });

  // ── 2. Page navigation tracking ─────────────────────────────────────────
  socket.on("page_change", ({ page }) => {
    if (!socketProjectKey) return;
    setPresence(socketProjectKey, socket.id, { ...presence[socketProjectKey]?.[socket.id], page });
    io.to(`project:${socketProjectKey}`).emit("presence", getPresence(socketProjectKey));
  });

  // ── 3. Join execution board ──────────────────────────────────────────────
  socket.on("join_board", ({ boardId }) => {
    if (socketBoardId && socketBoardId !== boardId) socket.leave(`board:${socketBoardId}`);
    socketBoardId = boardId;
    socket.join(`board:${boardId}`);
    if (socketProjectKey) {
      setPresence(socketProjectKey, socket.id, { ...presence[socketProjectKey]?.[socket.id], boardId, page: "execution" });
      io.to(`project:${socketProjectKey}`).emit("presence", getPresence(socketProjectKey));
    }
    // Send persisted board state to the joining user
    const rows = stmtGetRows.all(boardId).map(r => JSON.parse(r.data));
    if (rows.length) socket.emit("board_state", rows);
    // Tell the room how many peers are on this board
    const peerCount = io.sockets.adapter.rooms.get(`board:${boardId}`)?.size || 1;
    io.to(`board:${boardId}`).emit("board_peers", peerCount);
  });

  // ── 4. Seed board (first user loads test cases) ──────────────────────────
  socket.on("rows_loaded", ({ boardId, rows }) => {
    // Only seed if DB has no rows yet for this board
    const existing = stmtGetRows.all(boardId);
    if (existing.length === 0) {
      const insertMany = db.transaction(rs => rs.forEach(r => stmtUpsertRow.run(boardId, r.id, JSON.stringify(r))));
      insertMany(rows);
    }
    // Always broadcast fresh rows to latecomers
    const persisted = stmtGetRows.all(boardId).map(r => JSON.parse(r.data));
    socket.to(`board:${boardId}`).emit("board_state", persisted);
  });

  // ── 5. Row update (actual result / status / reason) ──────────────────────
  socket.on("row_update", ({ boardId, rowId, patch }) => {
    // Merge patch into persisted row
    debouncedWrite(`${boardId}:${rowId}`, () => {
      const existing = stmtGetRows.all(boardId).find(r => r.row_id === rowId);
      const current  = existing ? JSON.parse(existing.data) : {};
      stmtUpsertRow.run(boardId, rowId, JSON.stringify({ ...current, ...patch }));
    });
    // Broadcast immediately to all OTHER users on the board
    socket.to(`board:${boardId}`).emit("row_updated", { rowId, patch, by: socketUser });
    // Also broadcast a typing/editing indicator
    socket.to(`board:${boardId}`).emit("row_editing", { rowId, user: socketUser });
  });

  // ── 6. Activity event (generate, push, evaluate, bug) ────────────────────
  socket.on("activity", ({ projectKey, boardId, action, detail }) => {
    const pk = projectKey || socketProjectKey;
    if (!pk) return;
    const entry = {
      project_key: pk,
      board_id: boardId || socketBoardId || null,
      user_name: socketUser.name,
      user_color: socketUser.color,
      action,
      detail: detail || null,
      ts: new Date().toISOString()
    };
    stmtInsertLog.run(entry.project_key, entry.board_id, entry.user_name, entry.user_color, entry.action, entry.detail);
    // Broadcast to everyone in the project
    io.to(`project:${pk}`).emit("activity", entry);
  });

  // ── 7. Board reset (clear persisted state for a board) ───────────────────
  socket.on("reset_board", ({ boardId }) => {
    stmtDeleteBoard.run(boardId);
    io.to(`board:${boardId}`).emit("board_reset");
  });

  // ── 8. Disconnect cleanup ────────────────────────────────────────────────
  socket.on("disconnecting", () => {
    if (socketBoardId) {
      const size = (io.sockets.adapter.rooms.get(`board:${socketBoardId}`)?.size || 1) - 1;
      socket.to(`board:${socketBoardId}`).emit("board_peers", size);
    }
  });

  socket.on("disconnect", () => {
    removePresence(socket.id);
    if (socketProjectKey) {
      io.to(`project:${socketProjectKey}`).emit("presence", getPresence(socketProjectKey));
    }
  });
});

// ─── GET /sync/activity ── REST fallback for activity log ────────────────────
app.get("/sync/activity", (req, res) => {
  const { projectKey } = req.query;
  if (!projectKey) return res.status(400).json({ error: "projectKey required" });
  const logs = stmtGetLog.all(projectKey);
  res.json(logs.reverse());
});

// ─── GET /sync/board/:boardId ── REST fallback to get persisted board rows ───
app.get("/sync/board/:boardId", (req, res) => {
  const rows = stmtGetRows.all(req.params.boardId).map(r => JSON.parse(r.data));
  res.json(rows);
});

// ─── Jira client ────────────────────────────────────────────────────────────
function jiraClient(req) {
  let { jiraurl, email, token } = req.headers;
  if (!jiraurl || !email || !token) throw new Error("Missing Jira credentials in headers");
  jiraurl = jiraurl.replace(/\/+$/, "");
  return axios.create({
    baseURL: `${jiraurl}/rest/api/3`,
    auth: { username: email, password: token },
    headers: { "Content-Type": "application/json" }
  });
}

// Jira search helper — paginates through ALL results automatically
async function jiraSearch(req, jql, fields, maxResults = 100) {
  let { jiraurl, email, token } = req.headers;
  jiraurl = jiraurl?.replace(/\/+$/, "");
  const auth = { username: email, password: token };
  const headers = { "Content-Type": "application/json" };

  const fetchPage = async (startAt) => {
    try {
      const { data } = await axios.get(`${jiraurl}/rest/api/3/search/jql`, {
        params: { jql, maxResults: Math.min(maxResults, 100), startAt, fields },
        auth, headers
      });
      return data;
    } catch {
      const { data } = await axios.post(`${jiraurl}/rest/api/2/search`, {
        jql, maxResults: Math.min(maxResults, 100), startAt, fields: fields.split(",")
      }, { auth, headers });
      return data;
    }
  };

  // If caller wants ≤100, single page
  if (maxResults <= 100) return fetchPage(0);

  // Paginate to get ALL results
  const first = await fetchPage(0);
  const total = first.total || 0;
  if (total <= 100) return first;

  const pages = [first];
  const remaining = Math.min(total, maxResults) - 100;
  const extraPages = Math.ceil(remaining / 100);
  await Promise.all(
    Array.from({ length: extraPages }, (_, i) => fetchPage((i + 1) * 100).then(d => pages.push(d)))
  );
  return { ...first, issues: pages.flatMap(p => p.issues || []) };
}

// ─── Xray Cloud client ───────────────────────────────────────────────────────
async function getXrayToken(clientId, clientSecret) {
  const { data } = await axios.post(
    "https://xray.cloud.getxray.app/api/v2/authenticate",
    { client_id: clientId, client_secret: clientSecret },
    { headers: { "Content-Type": "application/json" } }
  );
  return data;
}

// ─── ADF helpers ─────────────────────────────────────────────────────────────
function adfDoc(...paragraphs) {
  return {
    type: "doc", version: 1,
    content: paragraphs.map(text => ({
      type: "paragraph",
      content: [{ type: "text", text }]
    }))
  };
}

function extractText(doc) {
  if (!doc) return "";
  if (typeof doc === "string") return doc;
  if (doc.content) return doc.content.map(extractText).join(" ");
  if (doc.text) return doc.text;
  return "";
}

// ─── RAG store ── SQLite-backed, project-scoped, with keyword + optional HF semantic ──
let hfApiKey = process.env.HF_API_KEY || null;
const RAG_MAX = parseInt(process.env.RAG_MAX_ENTRIES) || 10000;

// Prepared RAG statements
const stmtRagUpsert = db.prepare(`
  INSERT INTO rag_store (project_key, story_id, title, expected_result, vec, embedding, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(project_key, story_id, title) DO UPDATE SET
    expected_result = excluded.expected_result,
    vec = excluded.vec,
    embedding = excluded.embedding,
    updated_at = excluded.updated_at
`);
const stmtRagQuery  = db.prepare(`SELECT * FROM rag_store WHERE project_key = ? AND story_id != ? ORDER BY updated_at DESC LIMIT 500`);
const stmtRagCount  = db.prepare(`SELECT COUNT(*) as cnt FROM rag_store WHERE project_key = ?`);
const stmtRagEvict  = db.prepare(`DELETE FROM rag_store WHERE project_key = ? AND id IN (SELECT id FROM rag_store WHERE project_key = ? ORDER BY updated_at ASC LIMIT ?)`);
const stmtRagStats  = db.prepare(`SELECT project_key, COUNT(*) as cnt FROM rag_store GROUP BY project_key`);
const stmtRagClear  = db.prepare(`DELETE FROM rag_store`);

function tokenize(text) { return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean); }
function buildVec(tokens) { const f = {}; tokens.forEach(t => f[t] = (f[t] || 0) + 1); return f; }

function keywordSim(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, mA = 0, mB = 0;
  keys.forEach(k => { const va = a[k]||0, vb = b[k]||0; dot+=va*vb; mA+=va*va; mB+=vb*vb; });
  return mA && mB ? dot / (Math.sqrt(mA) * Math.sqrt(mB)) : 0;
}

function embeddingCosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

async function getEmbedding(text) {
  if (!hfApiKey) return null;
  try {
    const { data } = await axios.post(
      "https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2",
      { inputs: text },
      { headers: { Authorization: `Bearer ${hfApiKey}`, "Content-Type": "application/json" } }
    );
    return Array.isArray(data[0]) ? data[0] : (Array.isArray(data) && typeof data[0] === "number" ? data : null);
  } catch (e) {
    console.warn("HF embedding failed, using keyword fallback:", e.message);
    return null;
  }
}

async function ragIndex(projectKey, storyId, title, expectedResult) {
  const text = `${title} ${expectedResult}`;
  const vec = JSON.stringify(buildVec(tokenize(text)));
  const embedding = await getEmbedding(text);
  stmtRagUpsert.run(projectKey, storyId, title, expectedResult, vec, embedding ? JSON.stringify(embedding) : null);
  // Evict oldest entries if over limit
  const { cnt } = stmtRagCount.get(projectKey);
  if (cnt > RAG_MAX) stmtRagEvict.run(projectKey, projectKey, cnt - RAG_MAX);
}

async function ragQuery(queryText, projectKey, storyId, topK = 5) {
  const rows = stmtRagQuery.all(projectKey, storyId);
  if (rows.length === 0) return [];
  const qVec = buildVec(tokenize(queryText));
  const qEmbed = await getEmbedding(queryText);
  console.log(`RAG query mode: ${qEmbed ? "semantic" : "keyword"}, project: ${projectKey}, candidates: ${rows.length}`);
  return rows
    .map(r => {
      const vec = JSON.parse(r.vec || "{}");
      const emb = r.embedding ? JSON.parse(r.embedding) : null;
      return {
        storyId: r.story_id, title: r.title, expectedResult: r.expected_result,
        score: qEmbed && emb ? embeddingCosineSim(qEmbed, emb) : keywordSim(qVec, vec)
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(r => r.score > 0.1);
}

if (hfApiKey) console.log("RAG: HuggingFace key loaded from .env, mode = semantic");

// ─── GET /rag/stats ── RAG store statistics ─────────────────────────────────
app.get("/rag/stats", (req, res) => {
  const rows = stmtRagStats.all();
  const total = rows.reduce((s, r) => s + r.cnt, 0);
  res.json({
    totalEntries: total,
    byProject: rows,
    mode: hfApiKey ? "semantic" : "keyword",
    model: hfApiKey ? "sentence-transformers/all-MiniLM-L6-v2" : "TF-IDF keyword"
  });
});

// ─── DELETE /rag/clear ── clear RAG store ────────────────────────────────────
app.delete("/rag/clear", (req, res) => {
  const { cnt: count } = db.prepare("SELECT COUNT(*) as cnt FROM rag_store").get();
  stmtRagClear.run();
  console.log(`RAG: cleared ${count} entries`);
  res.json({ success: true, cleared: count });
});

// ─── POST /rag/test ── test HuggingFace embedding connection ─────────────────
app.post("/rag/test", async (req, res) => {
  try {
    const { hfApiKey: key } = req.body;
    if (!key) return res.status(400).json({ error: "HuggingFace API key is required." });
    const { data } = await axios.post(
      "https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2",
      { inputs: "test" },
      { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } }
    );
    if (!Array.isArray(data)) throw new Error("Unexpected response from HuggingFace.");
    hfApiKey = key;
    console.log("RAG: HuggingFace connected, mode = semantic");
    res.json({ success: true, model: "sentence-transformers/all-MiniLM-L6-v2" });
  } catch (err) {
    const status = err.response?.status;
    let msg = err.response?.data?.error || err.message;
    if (status === 401 || status === 403) msg = "Invalid HuggingFace API key.";
    else if (status === 503) msg = "Model is loading, please try again in a few seconds.";
    res.status(status || 500).json({ error: msg });
  }
});

// ─── POST /llm/generate ── LLM-powered test case generation ───────────────
app.post("/llm/generate", async (req, res) => {
  try {
    const { story, notes, scope, llmConfig } = req.body;
    const { model, apiKey, endpoint, provider } = llmConfig;

    const baseURL = endpoint || (
      provider === "groq"    ? "https://api.groq.com/openai/v1" :
      provider === "xai"     ? "https://api.x.ai/v1" :
                               "https://api.mistral.ai/v1"
    );

    const scopeList = Object.entries(scope).filter(([, v]) => v).map(([k]) => k).join(", ");

    // Set HF key from frontend if provided (overrides .env only for this session)
    if (req.body.hfApiKey) hfApiKey = req.body.hfApiKey;
    const topK = parseInt(req.body.topK) || 5;
    const projectKey = req.body.projectKey || story.id.replace(/-\d+$/, "");

    // RAG: retrieve similar test cases from same project, different story
    const ragContext = await ragQuery(`${story.summary} ${story.description}`, projectKey, story.id, topK);
    const ragSection = ragContext.length > 0
      ? `\n\nRAG Context — Similar test cases from other stories (use as reference, do NOT duplicate):\n${ragContext.map((r, i) => `${i + 1}. [${r.storyId}] ${r.title} → ${r.expectedResult}`).join('\n')}`
      : '';
    console.log(`RAG: retrieved ${ragContext.length} for ${story.id} (project: ${projectKey}, topK=${topK}, mode=${hfApiKey ? 'semantic' : 'keyword'})`);
    console.log(`RAG context scores:`, ragContext.map(r => `${r.title.slice(0,30)}... = ${r.score.toFixed(3)}`));

    const systemPrompt = `You are TestOrbit AI, a senior QA engineer and test architect with deep expertise in writing detailed, production-grade test cases.
Generate comprehensive, elaborated test cases from the given user story.
Output ONLY a valid JSON array. No explanation, no markdown, no extra text.
Each test case must have: title, preconditions (array of strings), steps (array of detailed strings), expectedResult (detailed multi-point string), postConditions (array of strings), testData (string with sample data), priority (High/Medium/Low), type (Smoke/Regression/Functional), scope (Positive/Negative/Edge).

Title format rules (STRICTLY follow these):
- ALWAYS start the title with "Verify that" followed by the subject and action
- Use full descriptive sentences: "Verify that a logged-in user can add a valid in-stock product to the cart successfully"
- Include the actor (user, admin, guest), the action, and the condition/context
- Positive: "Verify that <actor> can <action> when <valid condition>"
- Negative: "Verify that <actor> cannot <action> when <invalid condition>"
- Edge: "Verify that the system handles <edge scenario> correctly when <boundary condition>"
- Never use short phrases like "Add product to cart" or "Login test" — always full sentences starting with "Verify that"

Rules for elaboration:
- preconditions: list every setup requirement (user state, environment, data, permissions)
- steps: each step must be specific and actionable — include exact field names, button labels, URLs, and input values using placeholders like <valid_email>, <password>
- expectedResult: list all assertions — UI changes, redirects, messages, system state, tokens/sessions
- postConditions: describe the system state after the test (session active, data persisted, etc.)
- testData: provide concrete sample data or placeholders needed for the test
- Do NOT generate test cases that duplicate the RAG context examples`;

    const userPrompt = `User Story ID: ${story.id}
Summary: ${story.summary}
Description: ${story.description || "Not provided"}
Acceptance Criteria: ${story.acceptanceCriteria || story.description || "Not provided"}
${notes ? `Tester Notes: ${notes}` : ""}
Scope: Generate ${scopeList} test cases.${ragSection}

Return a JSON array of detailed test cases. Example format:
[
  {
    "title": "Verify that a registered user can log in successfully using valid email and password credentials",
    "preconditions": [
      "User account exists with email <valid_email> and is active",
      "User is not already logged in",
      "Application is accessible at /login",
      "Browser cookies and cache are cleared"
    ],
    "steps": [
      "Open browser and navigate to <app_url>/login",
      "Verify the login page is displayed with Email field, Password field, and Login button",
      "Enter a valid registered email address in the Email field",
      "Enter the correct password in the Password field",
      "Click the Login button",
      "Wait for the page to load and observe the response"
    ],
    "expectedResult": "User is redirected to /dashboard. Welcome message displays the user's name. Auth token or session cookie is created. Login button is no longer visible. Navigation menu is accessible.",
    "postConditions": [
      "User session is active and persisted",
      "User can navigate to all protected routes"
    ],
    "testData": "Email: <valid_email>, Password: <valid_password>",
    "priority": "High",
    "type": "Smoke",
    "scope": "Positive"
  }
]`;

    const { data } = await axios.post(
      `${baseURL}/chat/completions`,
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 4000
      },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
    );

    const raw = data.choices[0].message.content.trim();
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const testCases = JSON.parse(jsonStr);

    // Index generated test cases into RAG store (SQLite, project-scoped)
    await Promise.all(testCases.map(tc => ragIndex(projectKey, story.id, tc.title, tc.expectedResult)));
    const { cnt: storeSize } = stmtRagCount.get(projectKey);
    console.log(`RAG: indexed ${testCases.length} test cases for ${story.id} (project: ${projectKey}). Project store size: ${storeSize}`);

    res.json({ testCases, ragUsed: ragContext.length > 0, ragCount: ragContext.length });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

// ─── POST /llm/generate-steps ── generate steps to reproduce for bug report ───
app.post("/llm/generate-steps", async (req, res) => {
  try {
    const { summary, expectedResult, actualResult, llmConfig } = req.body;
    const { model, apiKey, endpoint, provider } = llmConfig;
    const baseURL = endpoint || (
      provider === "groq" ? "https://api.groq.com/openai/v1" :
      provider === "xai"  ? "https://api.x.ai/v1" :
                            "https://api.mistral.ai/v1"
    );
    const { data } = await axios.post(
      `${baseURL}/chat/completions`,
      {
        model,
        messages: [
          { role: "system", content: `You are a QA engineer writing a bug report. Generate clear, numbered steps to reproduce a bug based on the test scenario. Return ONLY a JSON array of step strings. No explanation, no markdown.` },
          { role: "user", content: `Test: ${summary}\nExpected: ${expectedResult}\nActual: ${actualResult}\n\nGenerate steps to reproduce this bug.` }
        ],
        temperature: 0.2,
        max_tokens: 300
      },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
    );
    const raw = data.choices[0].message.content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const steps = JSON.parse(raw);
    res.json({ steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /llm/refine ── rephrase actual result into professional QA language ──────
app.post("/llm/refine", async (req, res) => {
  try {
    const { actualResult, expectedPoints, llmConfig } = req.body;
    const { model, apiKey, endpoint, provider } = llmConfig;
    const baseURL = endpoint || (
      provider === "groq" ? "https://api.groq.com/openai/v1" :
      provider === "xai"  ? "https://api.x.ai/v1" :
                            "https://api.mistral.ai/v1"
    );
    const { data } = await axios.post(
      `${baseURL}/chat/completions`,
      {
        model,
        messages: [
          { role: "system", content: `You are a QA engineer. Rephrase the tester's informal actual result notes into clear, professional QA language. Map the notes to the expected result points where possible. Return ONLY the refined text, no explanation, no markdown.` },
          { role: "user", content: `Expected Points:\n${expectedPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nTester Notes:\n${actualResult}` }
        ],
        temperature: 0.2,
        max_tokens: 300
      },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
    );
    res.json({ refined: data.choices[0].message.content.trim() });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// ─── POST /llm/evaluate ── LLM-powered test result evaluation ───────────────
app.post("/llm/evaluate", async (req, res) => {
  try {
    const { expectedResult, actualResult, llmConfig } = req.body;
    const { model, apiKey, endpoint, provider } = llmConfig;
    const baseURL = endpoint || (
      provider === "groq"  ? "https://api.groq.com/openai/v1" :
      provider === "xai"   ? "https://api.x.ai/v1" :
                             "https://api.mistral.ai/v1"
    );
    const { data } = await axios.post(
      `${baseURL}/chat/completions`,
      {
        model,
        messages: [
          { role: "system", content: `You are a QA evaluator. Compare the actual result with the expected result and decide if the test passed or failed.
Rules:
- If the actual result confirms the core behavior works, mark as Pass even if not all details are explicitly mentioned
- Only mark as Fail if the actual result clearly indicates something broke, an error occurred, or the behavior is wrong
- Do not fail a test just because the tester did not mention every point from the expected result
Reply ONLY with a valid JSON object: {"status": "Pass" or "Fail", "reason": "one sentence explanation"}. No markdown, no extra text.` },
          { role: "user", content: `Expected Result: ${expectedResult}\n\nActual Result: ${actualResult}` }
        ],
        temperature: 0,
        max_tokens: 100
      },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
    );
    const raw = data.choices[0].message.content.trim();
    const result = JSON.parse(raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim());
    res.json(result);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

// ─── POST /llm/test ── test LLM connection ───────────────────────────────────
app.post("/llm/test", async (req, res) => {
  try {
    const { model, apiKey, endpoint, provider } = req.body;
    if (!apiKey) return res.status(400).json({ error: "API key is required." });
    if (!model)  return res.status(400).json({ error: "Model is required." });
    const baseURL = endpoint || (
      provider === "groq"    ? "https://api.groq.com/openai/v1" :
      provider === "xai"     ? "https://api.x.ai/v1" :
                               "https://api.mistral.ai/v1"
    );
    const { data } = await axios.post(
      `${baseURL}/chat/completions`,
      { model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
    );
    res.json({ success: true, model: data.model || model });
  } catch (err) {
    const status = err.response?.status;
    const raw = err.response?.data?.error?.message || err.message;
    let msg = raw;
    if (status === 401) msg = "Invalid API key. Please check and re-enter your key.";
    else if (status === 403) msg = "Access denied. Your API key does not have permission for this model.";
    else if (status === 404) msg = `Model "${req.body.model}" not found. Check the model name or your plan.`;
    else if (status === 429) msg = "Rate limit exceeded. Wait a moment and try again.";
    else if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") msg = "Cannot reach the LLM endpoint. Check the URL or your internet connection.";
    res.status(status || 500).json({ error: msg });
  }
});

// ─── POST /xray/test ── test Xray credentials ────────────────────────────────
app.post("/xray/test", async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;
    if (!clientId || !clientSecret) return res.status(400).json({ error: "Client ID and Client Secret are required." });
    await getXrayToken(clientId, clientSecret);
    res.json({ success: true });
  } catch (err) {
    const status = err.response?.status;
    let msg = err.response?.data?.error || err.message;
    if (status === 401 || status === 403) msg = "Invalid Xray Client ID or Client Secret.";
    else if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") msg = "Cannot reach Xray Cloud. Check your internet connection.";
    res.status(status || 500).json({ error: msg });
  }
});

// ─── GET /jira/issue/:id ─────────────────────────────────────────────────────
app.get("/jira/issue/:id", async (req, res) => {
  try {
    const client = jiraClient(req);
    const issueId = req.params.id.replace(/[^A-Za-z0-9_-]/g, "");
    const { data } = await client.get(`/issue/${issueId}`);
    const f = data.fields;
    res.json({
      id: data.key,
      summary: f.summary,
      description: extractText(f.description),
      acceptanceCriteria: extractText(f.description),
      status: f.status?.name,
      priority: f.priority?.name,
      issueType: f.issuetype?.name || "Story",
      assignee: f.assignee?.displayName || "Unassigned"
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── POST /jira/testcase ── create Xray Test or Jira Task ────────────────────
app.post("/jira/testcase", async (req, res) => {
  try {
    const jira = jiraClient(req);
    const { projectKey, testCase, userStoryId, xrayClientId, xrayClientSecret } = req.body;

    const stepsText = testCase.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const descText = `Preconditions:\n${testCase.preconditions}\n\nSteps:\n${stepsText}\n\nExpected Result:\n${testCase.expectedResult}`;

    let issueKey;

    if (xrayClientId && xrayClientSecret) {
      // Xray Cloud — create via Jira first as Test issue type, then update steps via Xray
      const jiraPayload = {
        fields: {
          project: { key: projectKey },
          summary: testCase.title,
          description: adfDoc(descText),
          issuetype: { name: "Test" },
          priority: { name: testCase.priority }
        }
      };

      const { data: created } = await jira.post("/issue", jiraPayload).catch(async (e) => {
        console.warn("Test issuetype failed, check Xray is installed:", e.response?.data?.errors);
        throw new Error("Test issue type not available. Ensure Xray is installed in your Jira project.");
      });
      issueKey = created.key;

      // Update Xray test steps via Xray REST API
      try {
        const token = await getXrayToken(xrayClientId, xrayClientSecret);
        const xraySteps = testCase.steps.map((s, i) => ({
          action: s,
          data: "",
          result: i === testCase.steps.length - 1 ? testCase.expectedResult : ""
        }));
        await axios.put(
          `https://xray.cloud.getxray.app/api/v2/test/${issueKey}/steps`,
          xraySteps,
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
        );
      } catch (xrayErr) {
        console.warn("Xray step update failed (non-fatal):", xrayErr.message);
      }
    } else {
      // No Xray — create as Test or Task
      const payload = {
        fields: {
          project: { key: projectKey },
          summary: testCase.title,
          description: adfDoc(descText),
          issuetype: { name: "Test" },
          priority: { name: testCase.priority }
        }
      };
      const { data: created } = await jira.post("/issue", payload).catch(async (e) => {
        console.warn("Test issuetype failed:", e.response?.data?.errors);
        throw new Error("Test issue type not available. Ensure Xray is installed in your Jira project.");
      });
      issueKey = created.key;
    }

    // Link test case to user story
    if (userStoryId && issueKey) {
      await jira.post("/issueLink", {
        type: { name: "Test" },
        inwardIssue: { key: issueKey },
        outwardIssue: { key: userStoryId }
      }).catch(() =>
        jira.post("/issueLink", {
          type: { name: "Relates" },
          inwardIssue: { key: issueKey },
          outwardIssue: { key: userStoryId }
        }).catch(() => {})
      );
    }

    res.json({ key: issueKey, url: `${req.headers.jiraurl}/browse/${issueKey}` });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message });
  }
});

// ─── GET /jira/testcases-by-story/:storyId ── fetch test cases linked to story
app.get("/jira/testcases-by-story/:storyId", async (req, res) => {
  try {
    const storyId = req.params.storyId;
    const fields = "summary,status,priority,labels,issuetype,description";
    const [linked, labelled] = await Promise.all([
      jiraSearch(req, `issue in linkedIssues("${storyId}") AND issuetype = "Test" ORDER BY created ASC`, fields, 2000).catch(() => ({ issues: [] })),
      jiraSearch(req, `labels = "${storyId}" ORDER BY created ASC`, fields, 2000).catch(() => ({ issues: [] })),
    ]);
    const seen = new Set();
    const all = [...(linked.issues || []), ...(labelled.issues || [])].filter(i => {
      if (seen.has(i.key)) return false; seen.add(i.key); return true;
    });
    res.json(all.map(i => {
      const desc = extractText(i.fields.description);
      const m = desc.match(/Expected Result[:\s]+(.+?)(\n|$)/i);
      return {
        id: i.key, summary: i.fields.summary, description: desc,
        expectedResult: m ? m[1].trim() : desc.slice(0, 150) || "Refer to Jira issue",
        status: i.fields.status?.name, priority: i.fields.priority?.name,
        labels: i.fields.labels, url: `${req.headers.jiraurl}/browse/${i.key}`
      };
    }));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});


app.get("/jira/testcases-by-plan/:planId", async (req, res) => {
  try {
    const planId = req.params.planId;
    const fields = "summary,status,priority,labels,issuetype,description";
    const linked = await jiraSearch(req, `issue in linkedIssues("${planId}") AND issuetype = "Test" ORDER BY created ASC`, fields, 2000).catch(() => ({ issues: [] }));
    res.json((linked.issues || []).map(i => {
      const desc = extractText(i.fields.description);
      const m = desc.match(/Expected Result[:\s]+(.+?)(\n|$)/i);
      return {
        id: i.key,
        summary: i.fields.summary,
        type: i.fields.issuetype?.name,
        expectedResult: m ? m[1].trim() : desc.slice(0, 150) || "Refer to Jira issue",
        status: i.fields.status?.name,
        priority: i.fields.priority?.name,
        url: `${req.headers.jiraurl}/browse/${i.key}`
      };
    }));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});


app.get("/jira/testcase/:id", async (req, res) => {
  try {
    const client = jiraClient(req);
    const { data } = await client.get(`/issue/${req.params.id}`);
    const f = data.fields;
    if (f.issuetype?.name !== 'Test') {
      return res.status(400).json({ error: `Issue ${req.params.id} is not a Test issue type.` });
    }
    const desc = extractText(f.description);
    const expectedMatch = desc.match(/Expected Result[:\s]+(.+?)(\n|$)/i);
    res.json([{
      id: data.key,
      summary: f.summary,
      expectedResult: expectedMatch ? expectedMatch[1].trim() : desc.slice(0, 150) || "Refer to Jira issue",
      status: f.status?.name,
      priority: f.priority?.name,
      url: `${req.headers.jiraurl}/browse/${data.key}`
    }]);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── POST /jira/bug ── create bug linked to test case + user story ────────────
app.post("/jira/bug", async (req, res) => {
  try {
    const jira = jiraClient(req);
    const { projectKey, bug, xrayClientId, xrayClientSecret } = req.body;

    const stepsText = bug.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const descText = `Description:\n${bug.description}\n\nSteps to Reproduce:\n${stepsText}\n\nExpected Result:\n${bug.expectedResult}\n\nActual Result:\n${bug.actualResult}\n\nLinked Test Case: ${bug.testCaseId}`;

    const payload = {
      fields: {
        project: { key: projectKey },
        summary: bug.title,
        description: adfDoc(descText),
        issuetype: { name: "Bug" },
        priority: { name: bug.severity === "Critical" ? "Highest" : bug.severity }
      }
    };

    const { data } = await jira.post("/issue", payload);
    const bugKey = data.key;

    // Link bug to user story
    if (bug.userStoryId) {
      await jira.post("/issueLink", {
        type: { name: "Relates" },
        inwardIssue: { key: bugKey },
        outwardIssue: { key: bug.userStoryId }
      }).catch(() => {});
    }

    // Link bug to test case
    if (bug.testCaseId) {
      await jira.post("/issueLink", {
        type: { name: "Relates" },
        inwardIssue: { key: bugKey },
        outwardIssue: { key: bug.testCaseId }
      }).catch(() => {});
    }

    // Update Xray test execution status if Xray configured
    if (xrayClientId && xrayClientSecret && bug.testCaseId) {
      try {
        const token = await getXrayToken(xrayClientId, xrayClientSecret);
        // Add defect to Xray test
        await axios.post(
          `https://xray.cloud.getxray.app/api/v2/test/${bug.testCaseId}/defects`,
          { defects: [bugKey] },
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
        );
      } catch (e) {
        console.warn("Xray defect link failed (non-fatal):", e.message);
      }
    }

    res.json({ key: bugKey, url: `${req.headers.jiraurl}/browse/${bugKey}` });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── POST /jira/testexecution ── create test execution linked to test plan ─────
app.post("/jira/testexecution", async (req, res) => {
  try {
    const jira = jiraClient(req);
    const { projectKey, planKey, testCaseKeys, summary, xrayClientId, xrayClientSecret } = req.body;

    let execKey;
    let xrayToken = null;

    if (xrayClientId && xrayClientSecret) {
      try { xrayToken = await getXrayToken(xrayClientId, xrayClientSecret); } catch (e) {
        console.warn("Xray auth failed:", e.message);
      }
    }

    if (xrayToken) {
      try {
        // Step 1: Resolve Jira keys to Xray internal issue IDs using variables (not inline)
        const { data: resolveData } = await axios.post(
          "https://xray.cloud.getxray.app/api/v2/graphql",
          {
            query: `query GetTests($jql: String!) {
              getTests(jql: $jql, limit: 100) {
                results { issueId jira(fields: ["key"]) }
              }
            }`,
            variables: { jql: `issueKey in (${testCaseKeys.join(",")})` }
          },
          { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
        );
        console.log("Xray resolve tests:", JSON.stringify(resolveData?.data), "errors:", JSON.stringify(resolveData?.errors));
        const xrayIssueIds = (resolveData?.data?.getTests?.results || []).map(t => t.issueId).filter(Boolean);
        console.log("Resolved Xray issue IDs:", xrayIssueIds);

        // Step 2: Resolve plan key to Xray plan issue ID
        let xrayPlanIds = [];
        if (planKey) {
          const { data: planData } = await axios.post(
            "https://xray.cloud.getxray.app/api/v2/graphql",
            {
              query: `query GetTestPlans($jql: String!) {
                getTestPlans(jql: $jql, limit: 1) {
                  results { issueId }
                }
              }`,
              variables: { jql: `issueKey = ${planKey}` }
            },
            { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
          );
          console.log("Xray resolve plan:", JSON.stringify(planData?.data), "errors:", JSON.stringify(planData?.errors));
          xrayPlanIds = (planData?.data?.getTestPlans?.results || []).map(p => p.issueId).filter(Boolean);
          console.log("Resolved Xray plan IDs:", xrayPlanIds);
        }

        // Step 3: Create Test Execution and add tests
        const { data: xrayData } = await axios.post(
          "https://xray.cloud.getxray.app/api/v2/graphql",
          {
            query: `mutation CreateTestExecution($jira: JSON!, $testIssueIds: [String]) {
              createTestExecution(jira: $jira, testIssueIds: $testIssueIds) {
                testExecution { issueId jira(fields: ["key"]) }
                warnings
              }
            }`,
            variables: {
              jira: { fields: { summary, project: { key: projectKey } } },
              testIssueIds: xrayIssueIds
            }
          },
          { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
        );
        console.log("Xray exec result:", JSON.stringify(xrayData?.data), "errors:", JSON.stringify(xrayData?.errors));
        execKey = xrayData?.data?.createTestExecution?.testExecution?.jira?.key;

        // Step 4: Add tests directly to Test Plan + link execution to plan
        if (xrayPlanIds.length > 0) {
          const execIssueId = xrayData?.data?.createTestExecution?.testExecution?.issueId;

          // Add tests to Test Plan
          await axios.post(
            "https://xray.cloud.getxray.app/api/v2/graphql",
            {
              query: `mutation AddTestsToPlan($issueId: String!, $testIds: [String]!) {
                addTestsToTestPlan(issueId: $issueId, testIssueIds: $testIds) {
                  addedTests
                  warning
                }
              }`,
              variables: { issueId: xrayPlanIds[0], testIds: xrayIssueIds }
            },
            { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
          ).then(r => console.log("Add tests to plan:", JSON.stringify(r.data?.data), JSON.stringify(r.data?.errors)))
           .catch(e => console.warn("Add tests to plan failed:", e.response?.data || e.message));

          // Link execution to Test Plan
          if (execIssueId) {
            await axios.post(
              "https://xray.cloud.getxray.app/api/v2/graphql",
              {
                query: `mutation AddExecToPlan($issueId: String!, $execIds: [String]!) {
                  addTestExecutionsToTestPlan(issueId: $issueId, testExecIssueIds: $execIds) {
                    addedTestExecutions
                    warning
                  }
                }`,
                variables: { issueId: xrayPlanIds[0], execIds: [execIssueId] }
              },
              { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
            ).then(r => console.log("Add exec to plan:", JSON.stringify(r.data?.data), JSON.stringify(r.data?.errors)))
             .catch(e => console.warn("Add exec to plan failed:", e.response?.data || e.message));
          }
        }
      } catch (e) {
        console.warn("Xray GraphQL exec failed:", e.response?.data || e.message);
      }
    }

    // Fallback: create via Jira issue API
    if (!execKey) {
      const payload = {
        fields: {
          project: { key: projectKey },
          summary,
          issuetype: { name: "Test Execution" }
        }
      };
      const { data: created } = await jira.post("/issue", payload).catch(async () => {
        payload.fields.issuetype = { name: "Task" };
        return jira.post("/issue", payload);
      });
      execKey = created.key;

      // Add tests via Xray REST
      if (xrayToken && testCaseKeys.length > 0) {
        try {
          await axios.post(
            `https://xray.cloud.getxray.app/api/v2/testexecution/${execKey}/test`,
            { add: testCaseKeys },
            { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
          );
        } catch (e) { console.warn("Xray add tests to exec failed:", e.message); }
      }
    }

    // Link execution to test plan via Jira issue link
    if (planKey && execKey) {
      await jira.post("/issueLink", {
        type: { name: "Relates" },
        inwardIssue: { key: execKey },
        outwardIssue: { key: planKey }
      }).catch(() => {});
    }

    res.json({ key: execKey, url: `${req.headers.jiraurl}/browse/${execKey}` });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── POST /jira/testexecution/status ── update test run status in execution ───
app.post("/jira/testexecution/status", async (req, res) => {
  try {
    const { execKey, testCaseKey, status, xrayClientId, xrayClientSecret } = req.body;
    if (!xrayClientId || !xrayClientSecret) return res.json({ success: false, reason: "Xray not configured" });

    const token = await getXrayToken(xrayClientId, xrayClientSecret);
    const xrayStatus = status === "Pass" ? "PASSED" : "FAILED";

    // Resolve execKey and testCaseKey to Xray internal IDs
    const { data: resolveData } = await axios.post(
      "https://xray.cloud.getxray.app/api/v2/graphql",
      {
        query: `query GetTestRuns($jql: String!) {
          getTestExecutions(jql: $jql, limit: 1) {
            results {
              issueId
              testRuns(limit: 100) {
                results { id status { name } test { jira(fields: ["key"]) } }
              }
            }
          }
        }`,
        variables: { jql: `issueKey = ${execKey}` }
      },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    const testRuns = resolveData?.data?.getTestExecutions?.results?.[0]?.testRuns?.results || [];
    console.log("Test runs found:", testRuns.length, "for exec:", execKey);

    const run = testRuns.find(r => r.test?.jira?.key === testCaseKey);
    if (run) {
      await axios.post(
        "https://xray.cloud.getxray.app/api/v2/graphql",
        {
          query: `mutation UpdateTestRunStatus($id: String!, $status: String!) {
            updateTestRunStatus(id: $id, status: $status)
          }`,
          variables: { id: run.id, status: xrayStatus }
        },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      console.log("Updated test run", run.id, "to", xrayStatus);
    } else {
      console.warn("Test run not found for", testCaseKey, "in", execKey);
    }
    res.json({ success: true });
  } catch (err) {
    console.warn("Test execution status update failed:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── POST /jira/update-status ── transition issue status after execution ─────
app.post("/jira/update-status", async (req, res) => {
  try {
    const jira = jiraClient(req);
    const { issueKey, status } = req.body;

    // Transition Jira issue status
    const { data: transData } = await jira.get(`/issue/${issueKey}/transitions`);
    const transitions = transData.transitions;
    const targetNames = status === "Pass"
      ? ["done", "passed", "pass", "closed", "resolved", "complete", "completed", "fixed"]
      : ["fail", "failed", "rejected", "won't fix", "wont fix", "in progress", "open", "reopen", "reopened"];
    const match = transitions.find(t =>
      targetNames.some(n => t.name.toLowerCase().includes(n))
    );
    // For Pass: use matched transition or first available
    // For Fail: only transition if a fail-specific transition exists, otherwise leave as-is
    const transition = status === "Pass" ? (match || transitions[0]) : match;
    if (transition) await jira.post(`/issue/${issueKey}/transitions`, { transition: { id: transition.id } });
    console.log(`Status update: ${issueKey} → ${status} via transition "${transition?.name || 'none (kept as-is)'}"`);
    res.json({ success: true, transition: transition?.name || "none" });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── POST /jira/testplan ── create test plan linked to user story ─────────────
app.post("/jira/testplan", async (req, res) => {
  try {
    const jira = jiraClient(req);
    const { projectKey, planName, testCaseKeys, userStoryId, xrayClientId, xrayClientSecret } = req.body;

    let planKey;
    let xrayToken = null;

    // Get Xray token first if configured
    if (xrayClientId && xrayClientSecret) {
      try { xrayToken = await getXrayToken(xrayClientId, xrayClientSecret); } catch (e) {
        console.warn("Xray auth failed:", e.message);
      }
    }

    if (xrayToken) {
      // Create Test Plan via Xray GraphQL API
      try {
        // Step 1: Resolve test case keys to Xray internal issue IDs
        const { data: resolveData } = await axios.post(
          "https://xray.cloud.getxray.app/api/v2/graphql",
          {
            query: `query GetTests($jql: String!) {
              getTests(jql: $jql, limit: 100) {
                results { issueId jira(fields: ["key"]) }
              }
            }`,
            variables: { jql: `issueKey in (${testCaseKeys.join(",")})` }
          },
          { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
        );
        const xrayIssueIds = (resolveData?.data?.getTests?.results || []).map(t => t.issueId).filter(Boolean);
        console.log("Resolved Xray test IDs for plan:", xrayIssueIds);

        // Step 2: Create Test Plan with resolved issue IDs
        const { data: xrayData } = await axios.post(
          "https://xray.cloud.getxray.app/api/v2/graphql",
          {
            query: `mutation CreateTestPlan($summary: String!, $projectKey: String!, $testIssueIds: [String]) {
              createTestPlan(summary: $summary, projectKey: $projectKey, testIssueIds: $testIssueIds) {
                testPlan { issueId jira(fields: ["key"]) }
                warnings
              }
            }`,
            variables: { summary: planName, projectKey, testIssueIds: xrayIssueIds.length > 0 ? xrayIssueIds : testCaseKeys }
          },
          { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
        );
        planKey = xrayData?.data?.createTestPlan?.testPlan?.jira?.key;
        console.log("Xray Test Plan created:", planKey, "warnings:", xrayData?.data?.createTestPlan?.warnings);

        // Step 3: Add tests to Xray Test Repository folder (creates folder if not exists)
        if (xrayIssueIds.length > 0) {
          try {
            // Create folder in Test Repository
            const { data: folderData } = await axios.post(
              "https://xray.cloud.getxray.app/api/v2/graphql",
              {
                query: `mutation CreateFolder($projectKey: String!, $path: String!) {
                  createFolder(projectKey: $projectKey, path: $path) {
                    folder { name path }
                    warnings
                  }
                }`,
                variables: { projectKey, path: `/${planName}` }
              },
              { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
            );
            console.log("Xray folder create:", JSON.stringify(folderData?.data), folderData?.data?.createFolder?.warnings);

            // Add tests to the folder
            const { data: addFolderData } = await axios.post(
              "https://xray.cloud.getxray.app/api/v2/graphql",
              {
                query: `mutation AddTestsToFolder($projectKey: String!, $path: String!, $testIssueIds: [String]!) {
                  addTestsToFolder(projectKey: $projectKey, path: $path, testIssueIds: $testIssueIds) {
                    folder { name path }
                    warnings
                  }
                }`,
                variables: { projectKey, path: `/${planName}`, testIssueIds: xrayIssueIds }
              },
              { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
            );
            console.log("Xray add to folder:", JSON.stringify(addFolderData?.data), addFolderData?.data?.addTestsToFolder?.warnings);
          } catch (folderErr) {
            console.warn("Xray Test Repository folder failed (non-fatal):", folderErr.response?.data || folderErr.message);
          }
        }
      } catch (e) {
        console.warn("Xray GraphQL create failed, falling back:", e.message);
      }
    }

    // Fallback: create via Jira issue API
    if (!planKey) {
      const payload = {
        fields: {
          project: { key: projectKey },
          summary: planName,
          description: adfDoc(`Test Plan for User Story: ${userStoryId}\nTest Cases: ${testCaseKeys.join(", ")}`),
          issuetype: { name: "Test Plan" }
        }
      };
      const { data } = await jira.post("/issue", payload).catch(async () => {
        payload.fields.issuetype = { name: "Epic" };
        return jira.post("/issue", payload);
      });
      planKey = data.key;

      // Add tests via Xray REST if token available
      if (xrayToken && testCaseKeys.length > 0) {
        try {
          await axios.post(
            `https://xray.cloud.getxray.app/api/v2/testplan/${planKey}/test`,
            { add: testCaseKeys },
            { headers: { Authorization: `Bearer ${xrayToken}`, "Content-Type": "application/json" } }
          );
        } catch (e) { console.warn("Xray add tests failed:", e.message); }
      }
    }

    // Link test plan to user story
    if (userStoryId) {
      await jira.post("/issueLink", {
        type: { name: "Relates" },
        inwardIssue: { key: planKey },
        outwardIssue: { key: userStoryId }
      }).catch(() => {});
    }

    // Link all test cases to test plan via Jira issue links
    for (const tcKey of testCaseKeys) {
      await jira.post("/issueLink", {
        type: { name: "Relates" },
        inwardIssue: { key: tcKey },
        outwardIssue: { key: planKey }
      }).catch(() => {});
    }

    res.json({ key: planKey, url: `${req.headers.jiraurl}/browse/${planKey}`, repositoryUrl: `${req.headers.jiraurl}/projects/${projectKey}?selectedItem=com.atlassian.plugins.atlassian-connect-plugin:com.xpandit.plugins.xray__testing-board#!page=test-repository&selectedFolder=-1` });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── GET /jira/issues ───────────────────────────────────────────────────────
app.get("/jira/issues", async (req, res) => {
  try {
    const projectKey = String(req.query.projectKey || "").replace(/[^A-Za-z0-9_]/g, "");
    const label = req.query.label ? String(req.query.label).replace(/["\\]/g, "") : null;
    if (!projectKey) return res.status(400).json({ error: "projectKey required" });
    const fields = "summary,status,priority,labels,issuetype,created,assignee,description";
    const [testData, labelData] = await Promise.all([
      jiraSearch(req, `project = "${projectKey}" AND issuetype = "Test" ORDER BY created DESC`, fields, 2000).catch(() => ({ issues: [] })),
      label
        ? jiraSearch(req, `project = "${projectKey}" AND labels = "${label}" ORDER BY created DESC`, fields, 2000).catch(() => ({ issues: [] }))
        : Promise.resolve({ issues: [] }),
    ]);
    const seen = new Set();
    const all = [...(testData.issues || []), ...(labelData.issues || [])].filter(i => {
      if (seen.has(i.key)) return false;
      seen.add(i.key);
      return true;
    });
    res.json(all.map(i => ({
      id: i.key, summary: i.fields.summary, status: i.fields.status?.name,
      priority: i.fields.priority?.name, type: i.fields.issuetype?.name,
      labels: i.fields.labels,
      userStoryId: (i.fields.labels || []).find(l => /^[A-Z]+-\d+$/.test(l)) || null,
      assignee: i.fields.assignee?.displayName || "Unassigned",
      created: i.fields.created, url: `${req.headers.jiraurl}/browse/${i.key}`
    })));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── GET /jira/bugs ──────────────────────────────────────────────────────────
app.get("/jira/bugs", async (req, res) => {
  try {
    const projectKey = String(req.query.projectKey || "").replace(/[^A-Za-z0-9_]/g, "");
    if (!projectKey) return res.status(400).json({ error: "projectKey required" });
    const jql = `project = "${projectKey}" AND issuetype = Bug ORDER BY created DESC`;
    const data = await jiraSearch(req, jql, "summary,status,priority,labels,created", 2000);
    res.json((data.issues || []).map(i => ({
      id: i.key, summary: i.fields.summary, status: i.fields.status?.name,
      priority: i.fields.priority?.name, created: i.fields.created,
      url: `${req.headers.jiraurl}/browse/${i.key}`
    })));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── GET /jira/activity ──────────────────────────────────────────────────────
app.get("/jira/activity", async (req, res) => {
  try {
    const projectKey = String(req.query.projectKey || "").replace(/[^A-Za-z0-9_]/g, "");
    if (!projectKey) return res.status(400).json({ error: "projectKey required" });
    const jql = `project = "${projectKey}" AND issuetype in ("Test", "Bug") ORDER BY updated DESC`;
    const data = await jiraSearch(req, jql, "summary,issuetype,updated,assignee,status", 20);
    res.json((data.issues || []).map(i => ({
      id: i.key, summary: i.fields.summary, type: i.fields.issuetype?.name,
      updated: i.fields.updated, assignee: i.fields.assignee?.displayName || "Unassigned",
      status: i.fields.status?.name, url: `${req.headers.jiraurl}/browse/${i.key}`
    })));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── DELETE /jira/issue/:id ──────────────────────────────────────────────────
app.delete("/jira/issue/:id", async (req, res) => {
  try {
    const client = jiraClient(req);
    await client.delete(`/issue/${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errorMessages?.[0] || err.message });
  }
});

// ─── GET /jira/sprints ── fetch all sprints for project ─────────────────────
app.get("/jira/sprints", async (req, res) => {
  try {
    let { jiraurl, email, token } = req.headers;
    jiraurl = jiraurl?.replace(/\/+$/, "");
    const auth = { username: email, password: token };
    const projectKey = String(req.query.projectKey || "").replace(/[^A-Za-z0-9_]/g, "");
    if (!projectKey) return res.status(400).json({ error: "projectKey required" });

    // Get board ID for project
    const { data: boardData } = await axios.get(`${jiraurl}/rest/agile/1.0/board`, {
      params: { projectKeyOrId: projectKey, type: "scrum" },
      auth, headers: { "Content-Type": "application/json" }
    });
    const board = boardData.values?.[0];
    if (!board) return res.json([]);

    // Get sprints for that board
    const { data: sprintData } = await axios.get(`${jiraurl}/rest/agile/1.0/board/${board.id}/sprint`, {
      params: { maxResults: 20, state: "active,closed,future" },
      auth, headers: { "Content-Type": "application/json" }
    });
    const sprints = (sprintData.values || []).reverse(); // newest first
    res.json(sprints.map(s => ({ id: s.id, name: s.name, state: s.state, startDate: s.startDate, endDate: s.endDate, completeDate: s.completeDate })));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
  }
});

// ─── GET /jira/sprint-coverage ── full sprint stats ───────────────────────────
app.get("/jira/sprint-coverage", async (req, res) => {
  try {
    let { jiraurl, email, token } = req.headers;
    jiraurl = jiraurl?.replace(/\/+$/, "");
    const auth = { username: email, password: token };
    const projectKey = String(req.query.projectKey || "").replace(/[^A-Za-z0-9_]/g, "");
    const sprintId = parseInt(req.query.sprintId);
    if (!projectKey || isNaN(sprintId)) return res.status(400).json({ error: "projectKey and sprintId required" });

    // 1. Fetch ALL stories in sprint
    const storiesData = await jiraSearch(req,
      `project = "${projectKey}" AND sprint = ${sprintId} AND issuetype in ("Story", "Task", "Epic") ORDER BY created ASC`,
      "summary,status,priority,issuetype", 2000
    );
    const stories = storiesData.issues || [];

    // 2. Fetch ALL tests — Xray Test type + TestOrbit-labelled, deduplicated
    const [testsXray, testsLabelled] = await Promise.all([
      jiraSearch(req,
        `project = "${projectKey}" AND sprint = ${sprintId} AND issuetype = "Test" ORDER BY created ASC`,
        "summary,status,priority,labels", 2000
      ).catch(() => ({ issues: [] })),
      jiraSearch(req,
        `project = "${projectKey}" AND sprint = ${sprintId} AND labels = "TestOrbit" ORDER BY created ASC`,
        "summary,status,priority,labels", 2000
      ).catch(() => ({ issues: [] })),
    ]);
    const seenT = new Set();
    const tests = [...(testsXray.issues || []), ...(testsLabelled.issues || [])].filter(t => {
      if (seenT.has(t.key)) return false; seenT.add(t.key); return true;
    });

    // 3. Fetch ALL bugs in sprint
    const bugsData = await jiraSearch(req,
      `project = "${projectKey}" AND sprint = ${sprintId} AND issuetype = "Bug" ORDER BY created ASC`,
      "summary,status,priority,issuelinks", 2000
    );
    const bugs = bugsData.issues || [];

    // 4. Build per-story coverage map
    const storyMap = {};
    stories.forEach(s => {
      storyMap[s.key] = {
        id: s.key,
        summary: s.fields.summary,
        status: s.fields.status?.name,
        type: s.fields.issuetype?.name,
        tests: [], bugs: []
      };
    });

    // Map tests to stories via labels
    tests.forEach(t => {
      const label = (t.fields.labels || []).find(l => /^[A-Z]+-\d+$/.test(l));
      if (label && storyMap[label]) {
        storyMap[label].tests.push({
          id: t.key,
          summary: t.fields.summary,
          status: t.fields.status?.name,
          priority: t.fields.priority?.name
        });
      }
    });

    // Map bugs to stories via Jira issue links (accurate, not summary guessing)
    bugs.forEach(b => {
      const links = b.fields.issuelinks || [];
      let linked = false;
      for (const link of links) {
        const linkedKey = link.inwardIssue?.key || link.outwardIssue?.key;
        if (linkedKey && storyMap[linkedKey]) {
          storyMap[linkedKey].bugs.push({ id: b.key, summary: b.fields.summary, status: b.fields.status?.name, priority: b.fields.priority?.name });
          linked = true;
        }
      }
      if (!linked) {
        if (!storyMap["__unlinked__"]) storyMap["__unlinked__"] = { id: "__unlinked__", summary: "Unlinked Bugs", tests: [], bugs: [] };
        storyMap["__unlinked__"].bugs.push({ id: b.key, summary: b.fields.summary, status: b.fields.status?.name, priority: b.fields.priority?.name });
      }
    });

    // 5. Aggregate totals
    const storyCoverage = Object.values(storyMap).map((s) => {
      const passed  = s.tests.filter(t => t.status === "Done" || t.status === "Passed").length;
      const failed  = s.tests.filter(t => t.status === "Failed").length;
      const pending = s.tests.length - passed - failed;
      return { ...s, totalTests: s.tests.length, passed, failed, pending, openBugs: s.bugs.filter(b => b.status !== "Done" && b.status !== "Closed" && b.status !== "Resolved").length };
    });

    const totalTests   = tests.length;
    const totalPassed  = tests.filter(t => t.fields.status?.name === "Done" || t.fields.status?.name === "Passed").length;
    const totalFailed  = tests.filter(t => t.fields.status?.name === "Failed").length;
    const totalPending = totalTests - totalPassed - totalFailed;
    const totalBugs    = bugs.length;
    const openBugs     = bugs.filter(b => b.fields.status?.name !== "Done" && b.fields.status?.name !== "Closed" && b.fields.status?.name !== "Resolved").length;
    const storiesWithTests    = storyCoverage.filter(s => s.id !== "__unlinked__" && s.totalTests > 0).length;
    const storiesWithoutTests = storyCoverage.filter(s => s.id !== "__unlinked__" && s.totalTests === 0).length;

    res.json({
      summary: { totalStories: stories.length, storiesWithTests, storiesWithoutTests, totalTests, totalPassed, totalFailed, totalPending, totalBugs, openBugs, passRate: totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0 },
      stories: storyCoverage.filter(s => s.id !== "__unlinked__"),
      unlinkedBugs: storyMap["__unlinked__"]?.bugs || []
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
  }
});

// ─── GET /jira/projects ──────────────────────────────────────────────────────
app.get("/jira/projects", async (req, res) => {
  try {
    const client = jiraClient(req);
    const { data } = await client.get("/project");
    if (!Array.isArray(data)) throw new Error("Unexpected response from Jira.");
    res.json(data.map(p => ({ key: p.key, name: p.name })));
  } catch (err) {
    const status = err.response?.status;
    let msg = err.response?.data?.errorMessages?.[0] || err.message;
    if (status === 401) msg = "Invalid email or API token. Please check your credentials.";
    else if (status === 403) msg = "Access denied. Your account does not have permission to access this Jira instance.";
    else if (status === 404) msg = "Jira URL not found. Check your Base URL.";
    else if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") msg = "Cannot reach Jira. Check your Base URL (e.g. https://your-org.atlassian.net).";
    else if (err.code === "ETIMEDOUT") msg = "Connection timed out. Check your Jira Base URL.";
    res.status(status || 500).json({ error: msg });
  }
});

const PORT = parseInt(process.env.PORT) || 3001;
httpServer.listen(PORT, () => console.log(`TestOrbit backend running on http://localhost:${PORT}`));

// ─── Graceful shutdown ───────────────────────────────────────────────────────
function shutdown() {
  // Flush any pending debounced writes before exit
  Object.values(writeTimers).forEach(t => clearTimeout(t));
  httpServer.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000); // force-exit after 5s
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);

// ─── Presence leak cleanup ── purge stale socket entries every 5 minutes ─────
setInterval(() => {
  const connected = new Set(io.sockets.sockets.keys());
  for (const pk of Object.keys(presence)) {
    for (const sid of Object.keys(presence[pk])) {
      if (!connected.has(sid)) delete presence[pk][sid];
    }
  }
}, 5 * 60 * 1000);
