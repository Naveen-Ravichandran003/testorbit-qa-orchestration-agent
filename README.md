# 🛰️ TestOrbit AI Agent

> **Enterprise-Grade AI Orchestration Agent for QA** — An intelligent orchestration platform that coordinates LLMs, Jira, Xray, RAG pipelines, and real-time collaboration into a single, end-to-end QA lifecycle — from user story to bug report.

---

## 🪐 Why "TestOrbit"?

The name **TestOrbit** captures both the domain and the architecture in a single word:

- **Test** = QA / Software Testing
- **Orbit** = Everything revolves around the **User Story** in a connected, governed, traceable cycle

Just like planets orbit a central star, every QA artifact in TestOrbit orbits the User Story:

```
                         ┌──── Test Cases ────┐
                         │                    │
                    Test Plans            Execution
                         │                    │
                User Story ◉ (center)    Evaluation
                         │                    │
                     Bug Reports ◄──── Failures
                         │                    │
                         └──── RAG Store ─────┘
```

| Orbit Concept | TestOrbit Equivalent |
|---|---|
| **Central body (Sun)** | The **Jira User Story** — everything revolves around it |
| **Orbiting objects** | Test Cases, Test Plans, Executions, Bug Reports — all linked to the story |
| **Gravitational pull** | The **Orchestrator** keeps all entities connected and traceable |
| **Continuous cycle** | Generate → Execute → Evaluate → Bug → Fix → Re-test (iterative QA loop) |
| **Governed path** | Strict governance — no orphan entities, no unlinked artifacts |
| **Multiple satellites** | Multiple testers collaborate in real-time on the same orbit |

The orchestrator is the gravity — it ensures nothing drifts away unlinked or untraceable.

---

## 📌 What is TestOrbit AI?

TestOrbit AI is an **AI Orchestration Agent** purpose-built for QA teams. Rather than being a standalone tool, it acts as a **central orchestrator** that connects and coordinates multiple external systems — Jira Cloud, Xray Test Management, LLM providers (Groq, xAI, Mistral), and HuggingFace embeddings — into a seamless, automated QA pipeline.

The Node.js backend serves as the **orchestration layer**: it fetches user stories from Jira, retrieves similar test cases via a RAG pipeline, sends structured prompts to LLMs for generation, pushes results back to Jira/Xray, evaluates execution results with AI, and auto-generates linked bug reports — all without the QA engineer leaving the platform.

### Orchestration Chain

```
Jira (Fetch Story) → RAG (Deduplicate) → LLM (Generate) → Jira (Push Test Cases)
        → Xray (Create Plan + Execution) → LLM (Evaluate Pass/Fail)
        → LLM (Generate Bug Steps) → Jira (Create & Link Bug) → Xray (Update Status)
```

### Why Orchestration is the Perfect Pattern for This Project

TestOrbit AI is not just a CRUD app that talks to one API — it coordinates **6 external systems** in a specific sequence where each step depends on the output of the previous one. This is a textbook orchestration problem, and the Node.js backend (`server.js`) acts as the **central orchestrator** that makes it all work seamlessly:

#### 1. Multi-System Coordination in a Single Request

A single "Generate and Push" workflow touches **4 different APIs** in sequence:

```
One user action triggers:
  ① Jira REST API    → Fetch user story (summary, description, acceptance criteria)
  ② HuggingFace API  → Generate embedding for RAG query
  ③ SQLite RAG Store  → Retrieve Top-K similar test cases (cosine similarity)
  ④ LLM API (Groq)   → Generate test cases with story + RAG context injected
  ⑤ SQLite RAG Store  → Index newly generated test cases for future deduplication
  ⑥ Jira REST API    → Push each test case as Xray Test issue + link to story
  ⑦ Xray GraphQL API → Create Test Plan + add tests + create folder in repository
  ⑧ Jira REST API    → Link Test Plan ↔ User Story ↔ Test Cases
```

Without orchestration, the QA engineer would need to manually switch between Jira, an LLM chat, a spreadsheet, and Xray — copying and pasting data across 4+ browser tabs. The orchestrator eliminates all of that.

#### 2. Intelligent Fallback Chains

The orchestrator doesn't fail hard — it degrades gracefully at every step:

| Step | Primary Path | Fallback |
|---|---|---|
| **Issue Type** | Create as Xray `Test` | Falls back to Jira `Task` if Xray not installed |
| **Test Plan** | Xray GraphQL `createTestPlan` | Falls back to Jira `Epic` issue type |
| **Test Execution** | Xray GraphQL `createTestExecution` | Falls back to Jira `Task` issue type |
| **Issue Linking** | `Test` link type | Falls back to `Relates` link type |
| **RAG Retrieval** | Semantic (HuggingFace embeddings) | Falls back to keyword TF-IDF cosine similarity |
| **Jira Search** | REST API v3 (`/search/jql`) | Falls back to REST API v2 (`/search` POST) |
| **Status Transition** | Match `Passed`/`Failed` transition | Falls back to first available transition |

This means the system works with **any Jira setup** — with or without Xray, with or without HuggingFace — adapting automatically.

#### 3. Cross-System Traceability (The Orchestrator's Core Value)

The most critical orchestration responsibility is maintaining **full traceability** across all systems. After a complete workflow, the orchestrator ensures:

```
User Story (SCRUM-64)
    ├── linked to → Test Case (SCRUM-71)  [via Jira issue link]
    ├── linked to → Test Case (SCRUM-72)  [via Jira issue link]
    ├── linked to → Test Plan (SCRUM-73)  [via Jira issue link]
    │                   ├── contains → SCRUM-71  [via Xray GraphQL]
    │                   └── contains → SCRUM-72  [via Xray GraphQL]
    ├── linked to → Test Execution (SCRUM-74)  [via Jira issue link]
    │                   ├── run → SCRUM-71 = PASSED  [via Xray test run]
    │                   └── run → SCRUM-72 = FAILED  [via Xray test run]
    └── linked to → Bug (SCRUM-75)  [via Jira issue link]
                        └── linked to → SCRUM-72 (failed test)  [via Jira issue link]
```

No single system can create this web of relationships on its own. Only the orchestrator has the context to link Story → Test → Plan → Execution → Bug across Jira + Xray simultaneously.

#### 4. Real-Time State Synchronization

The orchestrator also manages **real-time state** across multiple users via Socket.IO:

- **Execution boards** are persisted in SQLite and broadcast to all connected users
- **Row-level updates** (actual results, status changes) are debounced, merged, and synced
- **Presence tracking** shows who is on which page, editing which row
- **Activity events** (generate, push, evaluate, bug) are logged and broadcast as live toasts

This is orchestration at the collaboration layer — the server is the single source of truth that resolves conflicts and keeps all clients in sync.

#### 5. Error Isolation

Each orchestrated system can fail independently without bringing down the entire workflow:

- LLM rate limit → returns error, user retries — no Jira state corrupted
- Xray API failure → non-fatal warning, test cases still exist in Jira as Tasks
- HuggingFace timeout → RAG falls back to keyword mode silently
- Jira link failure → swallowed with `.catch(() => {})`, test case still created
- Socket disconnect → auto-reconnect with re-identification

The orchestrator wraps every external call with error boundaries, ensuring **partial success is always preserved**.

### Core Capabilities

| Capability | Description |
|---|---|
| **AI Test Case Generation** | Generates comprehensive positive, negative, and edge-case test cases from Jira user stories using LLMs (Groq, xAI, Mistral) |
| **RAG Deduplication** | Uses Retrieval-Augmented Generation with HuggingFace embeddings to prevent duplicate test cases across stories |
| **Jira + Xray Integration** | Bi-directional sync — fetches stories, pushes test cases, creates test plans/executions, links bugs, transitions statuses |
| **AI Test Evaluation** | LLM-powered pass/fail evaluation comparing expected vs actual results with reasoning |
| **AI Bug Report Generation** | Auto-generates structured bug reports with LLM-generated reproduction steps |
| **Real-Time Collaboration** | Socket.IO-powered multi-user execution boards with live presence, typing indicators, and activity toasts |
| **Sprint Coverage Analytics** | Per-story coverage heatmaps, pass rates, pie charts, and uncovered story detection |
| **Test Repository Management** | Folder-based organization with bulk operations, recycle bin, PDF export, and Jira sync |

---

## 🏗️ Architecture

### High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TestOrbit AI Agent                          │
├────────────────────────────┬────────────────────────────────────────┤
│     testorbit-ui (React)   │        testorbit-backend (Node.js)    │
│                            │                                       │
│  ┌──────────────────────┐  │  ┌─────────────────────────────────┐  │
│  │   React + TypeScript  │  │  │   Express.js REST API Server    │  │
│  │   Tailwind CSS        │  │  │   Socket.IO Real-Time Engine    │  │
│  │   Vite Build          │  │  │   SQLite (better-sqlite3)       │  │
│  │   Recharts            │  │  │   Rate Limiting + Auth          │  │
│  │   Socket.IO Client    │  │  │                                 │  │
│  └──────────┬───────────┘  │  └──────────┬──────────────────────┘  │
│             │              │             │                          │
│             │   REST API   │             │                          │
│             ├──────────────┼─────────────┤                          │
│             │  WebSocket   │             │                          │
│             ├──────────────┼─────────────┤                          │
│             │              │             │                          │
├─────────────┴──────────────┴─────────────┴──────────────────────────┤
│                      External Integrations                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ Jira API │  │ Xray API │  │ LLM APIs │  │ HuggingFace API    │  │
│  │ (v2/v3)  │  │ (GraphQL)│  │(Groq/xAI)│  │ (Embeddings)       │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow Pipeline

```
User Story (Jira)
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Fetch Issue  │────▶│ RAG Retrieval │────▶│  LLM Generation  │
│  (Jira API)   │     │ (Top-K = 5-8) │     │  (Groq/xAI)      │
└──────────────┘     └──────────────┘     └────────┬─────────┘
                                                    │
       ┌────────────────────────────────────────────┘
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Edit/Select  │────▶│ Push to Jira  │────▶│ Create Test Plan  │
│  Test Cases   │     │ + Link Story  │     │ + Test Execution  │
└──────────────┘     └──────────────┘     └────────┬─────────┘
                                                    │
       ┌────────────────────────────────────────────┘
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Enter Actual │────▶│ AI Evaluate   │────▶│  Pass → Update    │
│  Results      │     │ (LLM Judge)   │     │  Fail → Bug Modal │
└──────────────┘     └──────────────┘     └────────┬─────────┘
                                                    │
       ┌────────────────────────────────────────────┘
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│ AI Bug Report │────▶│ Push Bug to   │────▶│ Link Bug → TC →   │
│ + Steps Gen   │     │ Jira          │     │ Story → Plan      │
└──────────────┘     └──────────────┘     └──────────────────┘
```

---

## 📂 Project Structure

```
TestOrbit AI Agent/
│
├── System Prompt.md              # RICEPOT system prompt for the AI agent
├── Task Prompt.md                # Task-level prompt template
├── UI Generation prompt.md       # UI design specification document
├── .gitignore
│
├── testorbit-backend/            # Node.js Backend (Express + Socket.IO)
│   ├── server.js                 # Main server — 1600+ lines, all API routes
│   ├── package.json              # Dependencies (express, socket.io, better-sqlite3)
│   ├── .env                      # Environment configuration
│   ├── testorbit.db              # SQLite database (RAG store, boards, activity)
│   └── rag_store.json            # Legacy JSON RAG store (migrated to SQLite)
│
├── testorbit-ui/                 # React Frontend (TypeScript + Tailwind)
│   ├── package.json              # Dependencies (react, recharts, socket.io-client)
│   ├── vite.config.ts            # Vite build configuration
│   ├── tailwind.config.cjs       # Tailwind CSS configuration
│   ├── tsconfig.json             # TypeScript configuration
│   ├── index.html                # Entry HTML
│   │
│   └── src/
│       ├── App.tsx               # Root — routing, TopBar, presence, error boundary
│       ├── index.tsx             # React DOM entry point
│       ├── index.css             # Global styles and design system
│       ├── types.ts              # TypeScript interfaces (TestCase, BugReport, etc.)
│       ├── jiraService.ts        # API client — all backend calls
│       ├── DataStore.tsx         # React Context — global state, polling, recycle bin
│       ├── useSync.ts            # Socket.IO hook — real-time collaboration
│       ├── mockData.ts           # Sample data for development
│       │
│       ├── components/
│       │   ├── Sidebar.tsx       # Navigation sidebar with collapsible menu
│       │   ├── Header.tsx        # Page header with actions
│       │   ├── InputForm.tsx     # Jira ID + scope selection form
│       │   ├── TestCaseTable.tsx  # Sortable test case table
│       │   ├── EditableRow.tsx   # Inline-editable test case row
│       │   ├── BugModal.tsx      # Bug creation modal with editable fields
│       │   └── LogoMark.tsx      # SVG logo component
│       │
│       └── pages/
│           ├── Dashboard.tsx     # KPIs, coverage heatmap, pie charts, activity
│           ├── Generator.tsx     # AI test case generation workflow
│           ├── Execution.tsx     # Test execution board with real-time sync
│           ├── Repository.tsx    # Folder-based test case management
│           ├── Coverage.tsx      # Sprint-level coverage analytics
│           └── Settings.tsx      # Jira, Xray, LLM, HuggingFace config
```

---

## 🔧 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18 + TypeScript | Component-based UI |
| **Styling** | Tailwind CSS 3 | Enterprise-grade UI design |
| **Build** | Vite 5 | Fast dev server + HMR |
| **Charts** | Recharts | Pie charts, coverage visuals |
| **PDF Export** | jsPDF + jspdf-autotable | Test case PDF generation |
| **Backend** | Express.js 5 | REST API server |
| **Real-Time** | Socket.IO 4 | Multi-user collaboration |
| **Database** | SQLite (better-sqlite3) | RAG store, boards, activity log |
| **LLM Providers** | Groq, xAI (Grok-2), Mistral | Test case generation + evaluation |
| **Embeddings** | HuggingFace (all-MiniLM-L6-v2) | Semantic RAG similarity |
| **Project Mgmt** | Jira Cloud REST API v2/v3 | Issue CRUD, transitions, links |
| **Test Mgmt** | Xray Cloud GraphQL API | Test/Plan/Execution management |
| **Security** | express-rate-limit + API tokens | Rate limiting + auth |

---

## 🚀 How It Works

### 1. Test Case Generation (Generator Page)

1. **Input**: Enter a Jira Issue ID (e.g., `SCRUM-64`) or paste a Jira URL
2. **Fetch**: System retrieves the user story — summary, description, acceptance criteria, priority, status
3. **RAG Context**: Queries the RAG store for similar test cases from other stories to avoid duplication
4. **LLM Generation**: Sends a structured prompt to the configured LLM with the story + RAG context
5. **Output**: Generates atomic, independent test cases with:
   - Title (always starts with "Verify that...")
   - Preconditions, Steps, Expected Result, Post-Conditions
   - Test Data, Priority (High/Medium/Low), Type (Smoke/Regression/Functional), Scope (Positive/Negative/Edge)
6. **Edit**: Full inline editing — modify any field before pushing
7. **Push to Jira**: Creates each test case as an Xray `Test` issue linked to the user story
8. **Test Plan**: Auto-creates a Test Plan + Test Execution in Jira/Xray with all pushed test cases

### 2. Test Execution (Execution Page)

1. **Load**: Enter a Test Plan ID + Test Execution ID to load test cases
2. **Real-Time Board**: Socket.IO-powered collaborative board — multiple testers work simultaneously
3. **Enter Actual Results**: Free-text input with character count
4. **AI Refine**: LLM rephrases informal tester notes into professional QA language
5. **Evaluate**: LLM compares expected vs actual results → Pass/Fail with reasoning
6. **Auto-Sync**: Results automatically update Jira issue status + Xray test run status
7. **Bug Creation**: Failed tests show a "Create Bug" button → opens modal with AI-generated reproduction steps

### 3. Bug Reporting (Bug Modal)

1. **Auto-Generated**: Title, description, steps to reproduce, expected/actual results, severity
2. **LLM Steps**: AI generates specific reproduction steps based on the test context
3. **Editable**: All fields are editable before confirmation
4. **Push to Jira**: Creates a `Bug` issue linked to the failed test case + user story
5. **Xray Integration**: If configured, links the defect to the Xray test run

### 4. Test Repository (Repository Page)

- **Folder Organization**: Categorize test cases by User Story, Smoke, Regression, Releases
- **Bulk Operations**: Select multiple test cases, delete, or execute as a batch
- **Jira Sync**: Pull latest test cases from Jira, organized by story
- **Recycle Bin**: Soft-delete with restore capability
- **PDF Export**: Generate formatted test case documents

### 5. Sprint Coverage Analytics (Coverage Page)

- **Sprint Selector**: View coverage for active, closed, or future sprints
- **KPI Dashboard**: Stories, tests generated, passed, failed, bugs raised
- **Coverage Tiers**: None (0 tests) → Low (1-2) → Medium (3-5) → Good (6+)
- **Story Breakdown**: Per-story pass rate, bug count, and coverage level
- **Uncovered Stories Alert**: Highlights stories with zero test cases with "Generate" quick-action

### 6. Real-Time Collaboration (Socket.IO)

- **Presence Tracking**: See who is online and which page they're on
- **Live Execution Boards**: Multiple testers can edit actual results simultaneously
- **Typing Indicators**: Shows which user is editing which row
- **Activity Toasts**: Real-time notifications when teammates generate, push, or evaluate
- **Board Persistence**: Execution state is persisted in SQLite — survives page refresh

### 7. RAG (Retrieval-Augmented Generation)

- **Indexing**: Every generated test case is indexed into the SQLite-backed RAG store
- **Dual Mode**: Keyword-based (TF-IDF cosine similarity) or Semantic (HuggingFace embeddings)
- **Top-K Retrieval**: Retrieves 5-8 most similar test cases from other stories
- **Deduplication**: LLM is instructed not to duplicate RAG context examples
- **Project-Scoped**: RAG store is isolated per Jira project
- **Auto-Eviction**: Oldest entries evicted when exceeding 10,000 entries per project

---

## ⚡ Quick Start

### Prerequisites

- **Node.js** 18+
- **Jira Cloud** account with API token
- **LLM API key** (Groq recommended — free tier available)
- **Xray Cloud** (optional) — for native test management

### 1. Backend Setup

```bash
cd testorbit-backend
npm install

# Configure environment (optional)
# Edit .env to add HF_API_KEY for semantic RAG

npm start
# Server runs on http://localhost:3001
```

### 2. Frontend Setup

```bash
cd testorbit-ui
npm install
npm run dev
# UI runs on http://localhost:5173
```

### 3. Configure Integrations (Settings Page)

1. **Jira**: Enter Base URL, Email, API Token, Project Key → Test Connection
2. **LLM**: Select model (Llama 3.3 70B recommended), enter API key → Test Connection
3. **Xray** (optional): Enter Client ID + Secret → Test Connection
4. **HuggingFace** (optional): Enter API key for semantic RAG → Test Connection
5. Click **Save Configuration**

---

## 🧠 AI / LLM Integration Details

### Supported LLM Providers

| Provider | Models | Use Case |
|---|---|---|
| **Groq** (recommended) | Llama 3.3 70B, Llama 3.1 8B, Mixtral 8x7B, Gemma 2 9B | Fast inference, free tier |
| **xAI** | Grok-2 | High-quality generation |
| **Mistral** | Mistral 7B | Lightweight alternative |

### LLM-Powered Features

| Feature | Endpoint | Temperature | Purpose |
|---|---|---|---|
| Test Case Generation | `/llm/generate` | 0.3 | Generate comprehensive test cases from user stories |
| Test Result Evaluation | `/llm/evaluate` | 0.0 | Deterministic pass/fail with reasoning |
| Actual Result Refinement | `/llm/refine` | 0.2 | Rephrase informal notes to QA language |
| Bug Steps Generation | `/llm/generate-steps` | 0.2 | Generate reproduction steps for bug reports |

### RAG Pipeline

```
Test Case Text → Tokenize → Build TF-IDF Vector → Store in SQLite
                                   │
                          (If HuggingFace configured)
                                   │
                                   ▼
               Text → HuggingFace API → 384-dim Embedding → Store
                                   │
                        Query Time:
                                   │
                                   ▼
              Query → Embed → Cosine Similarity → Top-K → Inject into Prompt
```

---

## 🎯 Positive Impact for QA Teams

### 1. Massive Time Savings

| Task | Manual Effort | With TestOrbit | Savings |
|---|---|---|---|
| Writing test cases per story | 2-4 hours | 30 seconds | **~95%** |
| Creating Jira test issues | 10-15 min each | Automated batch | **~98%** |
| Test plan creation | 30-60 min | 1 click | **~95%** |
| Bug report writing | 20-30 min | AI-generated | **~90%** |
| Test result evaluation | 5-10 min per TC | AI-powered | **~85%** |

### 2. Quality Improvements

- **Comprehensive Coverage**: AI generates positive, negative, AND edge cases — testers often miss edge cases
- **Consistent Format**: Every test case follows the same enterprise-grade structure
- **No Duplicates**: RAG deduplication ensures test cases don't overlap across stories
- **Professional Bug Reports**: AI-generated steps to reproduce with proper severity classification
- **Deterministic Evaluation**: LLM evaluation removes human bias from pass/fail decisions

### 3. Full Traceability

- **User Story → Test Case → Test Plan → Execution → Bug** — every entity is linked in Jira
- No orphan test cases or unlinked bugs
- Complete audit trail via activity logs

### 4. Team Collaboration

- **Real-time execution boards** — multiple testers execute simultaneously without conflicts
- **Live presence** — see who is working on what page
- **Activity notifications** — stay informed about teammate actions

### 5. Sprint Visibility

- **Coverage gaps detected instantly** — uncovered stories highlighted in red
- **Pass rate tracking** — per-story and sprint-level pass rates
- **Bug correlation** — see which stories have the most defects
- **Risk-based prioritization** — stories sorted by risk (failed tests first)

### 6. ROI Metrics

- **10x faster** test case creation compared to manual writing
- **Zero context-switching** — Jira + test management + execution in one tool
- **Reduced regression risk** — AI ensures edge cases are not missed
- **Lower bug escape rate** — comprehensive test coverage catches more defects before release
- **Knowledge retention** — RAG store builds institutional QA knowledge over time

---

## 🔐 Security

- **API Token Auth**: Optional `x-api-token` header for backend protection
- **Rate Limiting**: Configurable per-endpoint rate limits (LLM: 30/min, Jira/RAG: 100/min)
- **No Credential Storage on Server**: Jira/LLM credentials stored in browser `localStorage` only
- **Input Sanitization**: Jira IDs sanitized against injection
- **Graceful Shutdown**: Server flushes pending writes before exit

---

## 📊 Database Schema (SQLite)

| Table | Purpose |
|---|---|
| `rag_store` | Test case embeddings for RAG deduplication (project-scoped) |
| `board_rows` | Persisted execution board state for real-time collaboration |
| `activity_log` | User activity feed (generate, push, evaluate, bug create) |
| `folders` | Repository folder structure |
| `recycle_bin` | Soft-deleted test cases |

---

## 🔌 API Reference (Key Endpoints)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/jira/issue/:id` | Fetch Jira user story |
| `POST` | `/jira/testcase` | Create test case in Jira/Xray |
| `POST` | `/jira/testplan` | Create test plan + link test cases |
| `POST` | `/jira/testexecution` | Create test execution linked to plan |
| `POST` | `/jira/bug` | Create bug linked to test case + story |
| `POST` | `/jira/update-status` | Transition issue status (Pass/Fail) |
| `GET` | `/jira/sprint-coverage` | Full sprint coverage analytics |
| `POST` | `/llm/generate` | AI test case generation |
| `POST` | `/llm/evaluate` | AI pass/fail evaluation |
| `POST` | `/llm/refine` | AI actual result refinement |
| `POST` | `/llm/generate-steps` | AI bug reproduction steps |
| `GET` | `/rag/stats` | RAG store statistics |
| `GET` | `/sync/board/:boardId` | Get persisted board state |

---

## 🧩 Socket.IO Events

| Event | Direction | Purpose |
|---|---|---|
| `identify` | Client → Server | Register user + join project channel |
| `page_change` | Client → Server | Track which page user is on |
| `join_board` | Client → Server | Join execution board room |
| `row_update` | Client → Server | Send actual result / status change |
| `rows_loaded` | Client → Server | Seed board with test cases |
| `presence` | Server → Client | Broadcast online users |
| `board_state` | Server → Client | Send persisted board rows |
| `row_updated` | Server → Client | Broadcast row changes to peers |
| `row_editing` | Server → Client | Typing indicator |
| `activity` | Bidirectional | Activity feed events |

---

## 📋 System Prompt Architecture (RICEPOT Framework)

The AI agent operates under a structured **RICEPOT** prompt framework:

- **R (Role)**: Senior QA Automation Architect with 15+ years experience
- **I (Instructions)**: Strict mode-based operation (TEST_CASE_GENERATION / TEST_EXECUTION_EVALUATION / BUG_GENERATION)
- **C (Context)**: Full QA lifecycle workflow from user story to bug
- **E (Examples)**: Structured output templates for test cases, execution results, bug reports
- **P (Parameters)**: Enterprise QA standards, deterministic output, Jira-ready
- **O (Output)**: Mode-specific structured output only — no explanations, no hallucination
- **T (Tone)**: Professional, precise, QA-engineer style

---

## 🛣️ Key Design Decisions

1. **SQLite over external DB**: Zero-config deployment — no PostgreSQL/MongoDB setup required
2. **Socket.IO over polling**: Real-time collaboration requires sub-second latency
3. **Browser localStorage for credentials**: No server-side credential storage — better security model
4. **Multi-provider LLM support**: Avoids vendor lock-in — switch between Groq, xAI, Mistral freely
5. **Dual RAG modes**: Keyword fallback ensures RAG works even without HuggingFace API key
6. **Jira API v2/v3 dual support**: Handles both legacy and modern Jira Cloud instances

---

## 📄 License

ISC

---

> **Built by Naveen Ravichandran** — An AI-powered QA platform that transforms how teams approach software testing.
