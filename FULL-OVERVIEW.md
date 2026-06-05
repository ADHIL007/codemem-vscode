# CodeMem: Complete System Overview

## What is CodeMem?

CodeMem is a **persistent knowledge graph memory engine** for AI coding assistants. It consists of two components:

1. **CodeMem Server** — A standalone Rust binary that stores, indexes, and queries code-level knowledge across sessions
2. **CodeMem VS Code Extension** — A TypeScript extension that provides UI, local analysis, and integration with GitHub Copilot and other AI assistants

Together, they solve one problem: **AI assistants forget everything between sessions.** CodeMem makes them remember — files explored, decisions made, patterns discovered, relationships between symbols — and picks up exactly where the last session left off.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        VS Code Extension                            │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Setup    │  │ Analysis   │  │ Commands │  │ Tree Views     │  │
│  │ Wizard   │  │ (Parser,   │  │ (init,   │  │ (Memories,     │  │
│  │          │  │  Upload,   │  │  search, │  │  Sessions,     │  │
│  │          │  │  Watcher)  │  │  store)  │  │  Setup Steps)  │  │
│  └──────────┘  └─────┬──────┘  └────┬─────┘  └────────────────┘  │
│                       │              │                              │
│                       ▼              ▼                              │
│              ┌─────────────────────────────┐                       │
│              │   REST API Client            │                       │
│              │   (CodememClient class)      │                       │
│              └──────────────┬──────────────┘                       │
└─────────────────────────────┼──────────────────────────────────────┘
                              │ HTTP (default: localhost:4242)
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                     CodeMem Server (Rust)                           │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Transport Layer                                              │ │
│  │  ┌────────┐  ┌────────────┐  ┌──────────────────────────┐   │ │
│  │  │  CLI   │  │  MCP (32   │  │  REST API (Axum)         │   │ │
│  │  │ (26    │  │  tools via │  │  + Embedded React UI     │   │ │
│  │  │ cmds)  │  │  stdio/HTTP│  │  + SSE streaming         │   │ │
│  │  └────┬───┘  └──────┬─────┘  └────────────┬─────────────┘   │ │
│  └───────┼──────────────┼─────────────────────┼─────────────────┘ │
│          ▼              ▼                     ▼                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Domain Engine (codemem-engine)                               │ │
│  │  • Index (ast-grep + SCIP, 14 languages)                     │ │
│  │  • Hooks (9 lifecycle hooks, payload extraction)              │ │
│  │  • Recall (9-component hybrid scoring)                        │ │
│  │  • BM25 (code-aware tokenization)                             │ │
│  │  • Consolidation (5 cycles: decay, creative, cluster, etc.)   │ │
│  │  • Temporal (git commits as graph nodes)                      │ │
│  │  • Review (diff parsing, blast radius)                        │ │
│  │  • Watch (file watcher, <50ms debounce)                       │ │
│  └──────────────────────┬───────────────────────────────────────┘ │
│                         ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Foundation                                                   │ │
│  │  ┌───────────────┐  ┌──────────────────┐  ┌──────────────┐  │ │
│  │  │ codemem-core  │  │ codemem-storage  │  │ codemem-     │  │ │
│  │  │ (types, traits│  │ (SQLite WAL +    │  │ embeddings   │  │ │
│  │  │  errors,      │  │  HNSW vector +   │  │ (Candle /    │  │ │
│  │  │  config)      │  │  petgraph)       │  │  Ollama /    │  │ │
│  │  └───────────────┘  └──────────────────┘  │  OpenAI)     │  │ │
│  │                                            └──────────────┘  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  Storage: ~/.codemem/                                              │
│  • codemem.db (SQLite WAL)                                         │
│  • codemem.idx (HNSW vector index)                                 │
│  • models/ (bge-base-en-v1.5, 768-dim)                            │
│  • config.toml (persistent settings)                               │
└────────────────────────────────────────────────────────────────────┘
```

---

## Server (Rust) — Feature List

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **Single binary, zero deps** | `cargo install codemem` — no Docker, no Postgres, no Redis |
| **<100ms startup** | SQLite WAL + lazy init. Hooks execute in <5ms |
| **Fully offline** | Default embeddings use Candle (pure Rust ML). No API keys required |
| **14 language support** | Rust, TS, JS, JSX/TSX, Python, Go, C, C++, Java, Ruby, C#, Kotlin, Swift, PHP |
| **Compiler-grade SCIP** | Optional integration with rust-analyzer, scip-typescript, etc. for exact edges |
| **System-wide storage** | All data in `~/.codemem/` — one DB across all projects, namespace-scoped |

### Knowledge Graph

| Feature | Description |
|---------|-------------|
| **13 node kinds** | File, Module, Class, Function, Method, Interface, Type, Constant, Endpoint, Test, Package, External, Commit |
| **24 relationship types** | CALLS, IMPORTS, CONTAINS, INHERITS, IMPLEMENTS, EXTENDS, DEPENDS_ON, CO_CHANGED, MODIFIED_BY, TESTS, READS, WRITES, EVOLVED_INTO, RELATES_TO, PART_OF, SUMMARIZES, SHARES_THEME, etc. |
| **25 graph algorithms** | PageRank, Louvain community detection, betweenness centrality, SCC, BFS/DFS, shortest path, topological sort, degree centrality — all cached per session |
| **Temporal graph** | Git commits as first-class nodes with MODIFIED_BY edges to files/symbols |

### Memory System

| Feature | Description |
|---------|-------------|
| **7 memory types** | Decision, Pattern, Preference, Style, Habit, Insight, Context |
| **Self-editing memory** | `refine_memory` (EVOLVED_INTO), `split_memory` (PART_OF), `merge_memories` (SUMMARIZES) |
| **Memory expiration** | Optional `expires_at` field with automatic cleanup |
| **9-component hybrid scoring** | Vector cosine (25%), graph strength (20%), BM25 (15%), scope context (10%), temporal (10%), importance (10%), confidence (10%), tags (5%), recency (5%) |
| **Graph-expanded recall** | `expand=true` traverses edges to surface related knowledge |
| **Consolidation** | 5 automatic cycles: Decay, Creative (KNN + Union-Find), Cluster (dedup), Summarize (LLM), Forget |

### Indexing & Analysis

| Feature | Description |
|---------|-------------|
| **AST parsing** | ast-grep tree-sitter grammars extract symbols, references, metadata |
| **Manifest parsing** | Cargo.toml, package.json, go.mod, pyproject.toml → Package nodes + DEPENDS_ON |
| **Chunking** | Overlapping code chunks with parent-symbol assignment for embedding |
| **Reference resolution** | Resolves CALLS, IMPORTS, EXTENDS, IMPLEMENTS edges from AST references |
| **Incremental reindex** | Watches files, re-indexes only changed content, <50ms debounce |
| **SCIP enrichment** | Fuses compiler-grade cross-references with AST pattern edges |

### Transports

| Transport | Protocol | Use Case |
|-----------|----------|----------|
| **CLI** | 26 commands | `codemem init`, `analyze`, `search`, `stats`, `review`, `serve`, etc. |
| **MCP** | JSON-RPC 2.0 (stdio or HTTP) | 32 tools callable by any MCP-compatible AI assistant |
| **REST API** | HTTP (Axum) | Extension communication, embedded UI, team server mode |
| **SSE** | Server-Sent Events | Real-time streaming from server to UI |

### Lifecycle Hooks (Claude Code integration)

| Hook | Trigger | Action |
|------|---------|--------|
| `SessionStart` | New session begins | Inject prior context into assistant |
| `UserPromptSubmit` | User sends a message | Capture prompt context |
| `PostToolUse` | Edit/Write/MultiEdit | Re-index modified file, store observation |
| `PostToolUseFailure` | Tool call fails | Record error pattern |
| `Stop` | Session ends normally | Generate structured summary |
| `SubagentStart` | Sub-agent spawned | Track delegated work |
| `SubagentStop` | Sub-agent finishes | Capture agent findings |
| `SessionEnd` | Session closes | Clean session state |
| `PreCompact` | Context about to compact | Save checkpoint memories |

### Diff-Aware Code Review

```
codemem review < diff.patch
```

- Parses unified diffs
- Maps changed lines to graph symbols via line-range intersection
- Computes multi-hop blast radius (direct + transitive dependents)
- Calculates risk score (PageRank × log(deps))
- Surfaces relevant memories for each changed symbol
- Suggests potentially missing changes

### Configuration

All settings persistent in `~/.codemem/config.toml`:

| Category | Key Settings |
|----------|-------------|
| **Embeddings** | Provider, model, batch size, dimensions, cache size |
| **Scoring** | All 9 weight components independently tunable |
| **Vector** | HNSW M, efConstruction, efSearch |
| **Graph** | Compaction thresholds, centrality caching |
| **SCIP** | Enabled/disabled, TTL, indexer paths |
| **Chunking** | Overlap, max size, min size |
| **Enrichment** | Which enrichments run, fan-out limits |
| **Compression** | LLM provider, model (for observation compression) |

---

## VS Code Extension — Feature List

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codemem.serverUrl` | `http://localhost:4242` | CodeMem server URL (local or team server) |
| `codemem.namespace` | _(folder name)_ | Memory namespace for this workspace |
| `codemem.autoConnect` | `true` | Auto-connect to server on startup |
| `codemem.chunkSize` | `60` | Lines per code chunk for embedding |
| `codemem.ignorePatterns` | `[node_modules, .git, dist, ...]` | Patterns to exclude from analysis |
| `codemem.autoAnalyzeOnSave` | `false` | Full re-analysis on file changes (heavy) |
| `codemem.copilotHookIndexing` | `true` | Lightweight on-save edge upload (PostToolUse equivalent) |
| `codemem.embeddingProvider` | _(prompt on first use)_ | nvidia-nim, openai, ollama, or skip |
| `codemem.embeddingUrl` | _(from preset)_ | Base URL for embedding API |
| `codemem.embeddingModel` | _(from preset)_ | Model name |
| `codemem.embeddingApiKey` | _(from preset)_ | API key (stored globally) |

### Commands

| Command | Description |
|---------|-------------|
| `codemem.connect` | Connect/reconnect to server |
| `codemem.init` | Initialize workspace (hooks, MCP, agents, Copilot instructions) |
| `codemem.registerRepo` | Register workspace on server with a namespace |
| `codemem.analyzeWorkspace` | Full local analysis: parse → enrich → upload → embed |
| `codemem.reanalyzeChanged` | Re-analyze only files changed since last run |
| `codemem.search` | Semantic search over memories |
| `codemem.storeSelection` | Store selected code as a memory |
| `codemem.storeFromClipboard` | Store clipboard content as a memory |
| `codemem.deleteMemory` | Delete a memory by selection |
| `codemem.showMemoryDetail` | View full memory details in a webview |
| `codemem.setupWizard` | Show the guided 3-step onboarding wizard |
| `codemem.doctor` | Diagnostic health checks (server, MCP, embeddings, DB) |
| `codemem.refresh` | Refresh all tree views |

### Setup Wizard (3-Step Onboarding)

1. **Initialize Workspace** → `.mcp.json`, `.claude/settings.json` (hooks), `.claude/agents/`, `.github/copilot-instructions.md`
2. **Register Repository** → Creates namespace on server, links workspace path
3. **Analyze Workspace** → Full parse + upload + embed

Step completion is persisted across restarts and detects current state automatically:
- Step 1: Checks for `.mcp.json` with codemem entry
- Step 2: Matches registered repos by namespace, path, or name
- Step 3: Checks analysis cache for this workspace

### Copilot On-Save Hook

When `codemem.copilotHookIndexing` is enabled (default):
- Every file save triggers lightweight re-parsing of that single file
- Extracted edges are uploaded to the server in the background
- No user interaction required — fully transparent
- Supports: TS, JS, Python, Rust, Go, Java, Kotlin, C#

This is the **VS Code equivalent of Claude Code's `PostToolUse/Edit` hook** — the graph stays current as you code.

### File Watcher (Full Re-Analysis)

When `codemem.autoAnalyzeOnSave` is enabled:
- Watches all supported files in the workspace
- On changes, waits 3s debounce, then runs full re-analysis
- Heavier than on-save hook but includes enrichment + git edges

### Incremental Analysis (Edge Hash Dedup)

The analysis system avoids redundant work:
1. **File-level cache**: Stores `mtime` + `size` per file. Only re-parses changed files.
2. **No-change short-circuit**: If zero files changed, immediately shows "Indexing up to date"
3. **Edge hash**: Computes a fingerprint of all deduped edges. If identical to last run, skips the upload entirely.
4. **Force full rebuild**: Available as an option to bypass all caching

### Analysis Pipeline (10 Phases)

```
Phase 1: Scan files (respects .gitignore + settings)
Phase 2: Parse all files (regex-based AST for TS/JS/Python/Rust/generic)
Phase 3: Map test files to source files (TESTS edges)
Phase 4: Git enrichment (co-change + modified-by edges)
Phase 5: Deduplicate edges by (relationship|from|to)
Phase 6: Upload edges to server (chunked, retried, with hash check)
Phase 7: Embed code chunks (external API: OpenAI, NVIDIA NIM, Ollama)
Phase 8: Generate auto-memories from graph patterns
Phase 9: Save analysis cache to workspaceState
Phase 10: Build & display quality report
```

### Local Parser (No External Dependencies)

The extension includes a regex-based parser that extracts:
- **TypeScript/JavaScript**: Classes, functions, methods, imports, exports, interfaces, types, decorators, test blocks
- **Python**: Classes, functions, methods, imports, decorators
- **Rust**: Structs, enums, impl blocks, functions, use statements, traits, modules
- **Generic**: Function/class heuristics for other languages

### Tree Views (Sidebar)

| View | Content |
|------|---------|
| **Memories** | Paginated list of memories (filterable by type/namespace) |
| **Sessions** | Active and historical coding sessions |
| **Setup** | 3-step checklist with green/grey indicators |

### Status Bar

| State | Display |
|-------|---------|
| Connecting | `$(loading~spin) CodeMem` |
| Connected | `$(database) CodeMem` |
| All setup complete | `$(check) CodeMem: indexing up to date` |
| Disconnected | `$(database) CodeMem $(warning)` |

### `codemem.init` — What It Creates

| Target | Files Created |
|--------|--------------|
| **Claude Code** | `.claude/settings.json` (9 hooks + permissions), `.claude/agents/` (8 agent definitions), `.claude/skills/codemem/SKILL.md` |
| **GitHub Copilot** | `.github/copilot-instructions.md` (behavioral instructions + full MCP tool reference) |
| **MCP** | `.mcp.json` (stdio if CLI available, HTTP otherwise) |
| **All** | Detects installed assistants (Claude Code, Cursor, Windsurf, Copilot) |

### Agent Definitions (8 Agents)

Installed to `.claude/agents/` by `codemem.init`:

| Agent | Role |
|-------|------|
| `code-mapper` | Team lead — orchestrates all other agents |
| `baseline-scanner` | Wave 1: creates context memories per file/package |
| `symbol-analyst` | Wave 2: deep analysis of critical symbols |
| `api-mapper` | Wave 2: documents API endpoints |
| `pattern-hunter` | Wave 2: discovers cross-file patterns |
| `architecture-reviewer` | Wave 3: module boundaries + layering |
| `security-reviewer` | Wave 3: auth, validation, trust boundaries |
| `test-mapper` | Wave 3: testing patterns + coverage gaps |

---

## Data Model

### Memory Node

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `content` | String | The actual memory text |
| `memory_type` | Enum | decision, pattern, preference, style, habit, insight, context |
| `importance` | f64 (0-1) | How critical this memory is |
| `confidence` | f64 (0-1) | How reliable this memory is |
| `tags` | Vec<String> | Searchable tags |
| `links` | Vec<String> | Graph node references (e.g. `sym:FunctionName`, `file:path`) |
| `namespace` | Option<String> | Project scope |
| `access_count` | u32 | Times recalled |
| `created_at` | DateTime | Creation timestamp |
| `updated_at` | DateTime | Last modification |
| `expires_at` | Option<DateTime> | TTL (auto-pruned) |

### Graph Node

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Qualified name (e.g. `sym:path/file.ts#function:handleClick`) |
| `kind` | NodeKind | One of 13 kinds |
| `label` | String | Display name |
| `payload` | Map | Arbitrary metadata (source, parameters, etc.) |
| `centrality` | f64 | Cached PageRank score |
| `namespace` | Option<String> | Project scope |
| `valid_from` / `valid_to` | Option<DateTime> | Temporal validity |

### Edge

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `src` / `dst` | String | Source and destination node IDs |
| `relationship` | RelationshipType | One of 24 types |
| `weight` | f64 | Edge strength |
| `properties` | Map | File, line, source |
| `valid_from` / `valid_to` | Option<DateTime> | Temporal validity |

---

## Recall Scoring (How Search Works)

When you query `recall("how does auth work?")`, the result is ranked by 9 weighted components:

| Component | Weight | How It Works |
|-----------|--------|-------------|
| Vector cosine | 25% | Embedding similarity between query and memory |
| Graph strength | 20% | Node's PageRank + betweenness + degree + cluster coefficient |
| BM25 token overlap | 15% | Okapi BM25 with camelCase/snake_case tokenization |
| Scope context | 10% | Matches repo, branch, user |
| Temporal alignment | 10% | Recency-weighted by creation time |
| Importance | 10% | Memory's declared importance |
| Confidence | 10% | Memory's confidence score |
| Tag matching | 5% | Overlap between query terms and tags |
| Recency | 5% | How recently the memory was accessed |

All weights are configurable in `~/.codemem/config.toml`.

---

## How the Extension and Server Communicate

```
Extension                          Server
   │                                  │
   │  GET /api/health                 │  ← Health check
   │  GET /api/stats                  │  ← Memory/node/edge counts
   │  GET /api/memories?ns=X&page=1   │  ← Paginated memory list
   │  POST /api/memories              │  ← Store a memory
   │  DELETE /api/memories/:id         │  ← Delete a memory
   │  POST /api/search                │  ← Semantic search (recall)
   │  GET /api/sessions               │  ← Session history
   │  GET /api/namespaces             │  ← Namespace list
   │  GET /api/repos                  │  ← Registered repositories
   │  POST /api/repos                 │  ← Register new repo
   │  POST /api/graph/ingest-local-edges │ ← Upload parsed edges (chunked)
   │  GET /api/graph/subgraph         │  ← Fetch graph visualization data
   │                                  │
```

The extension also serves as a **lightweight local analyzer** — parsing files, extracting edges, and uploading them. The server handles:
- Persistent storage (SQLite WAL)
- Vector indexing (HNSW)
- Graph algorithms (PageRank, Louvain, etc.)
- Multi-namespace isolation
- MCP tool serving for Claude Code and other assistants

---

## Deployment Modes

### 1. Solo Developer (Local)

```
codemem serve --api --http --port 4242
```

- Server and extension on same machine
- Extension uses `http://localhost:4242`
- No network exposure

### 2. Team Server (LAN)

```
codemem serve --api --http --port 4242
# Server already binds to 0.0.0.0
# Open firewall: New-NetFirewallRule -DisplayName "CodeMem" -Direction Inbound -Protocol TCP -LocalPort 4242 -Action Allow
```

- Server runs on one machine, team connects via IP
- Each team member's extension points to `http://<server-ip>:4242`
- Shared knowledge graph across the team

### 3. Remote (Dev Tunnel)

```
# On server machine:
codemem serve --api --http --port 4242
devtunnel host -p 4242

# In extension settings:
"codemem.serverUrl": "https://your-tunnel-url.devtunnels.ms"
```

- Access from anywhere (home, office, mobile)
- Dev tunnel provides HTTPS termination
- Gateway timeout ~60s limits chunk sizes

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Single SQLite file** | No ops burden. WAL mode handles concurrent reads. Backup = copy one file |
| **Namespace-scoped, not DB-per-project** | Cross-project queries, team shared knowledge, simpler administration |
| **9-component scoring** | No single retrieval method works universally — hybrid outperforms pure vector |
| **Edge hash dedup** | Avoids re-uploading 100K+ edges when only 3 files changed |
| **On-save hook (not file watcher)** | File watchers are heavy and noisy. On-save is surgical and user-intentional |
| **Local-first analysis** | Extension can parse and upload without CLI binary (pure TS parser) |
| **Persisted setup state** | Completed steps survive restarts — no re-prompting when server is temporarily offline |
| **Centrality skipped during bulk ingest** | O(V+E) recompute on every chunk upload was the 504 timeout root cause |

---

## File Structure

### Server (Rust)

```
crates/
├── codemem/            # Binary: CLI + MCP + REST API
│   └── src/
│       ├── cli/        # 26 commands (init, serve, stats, analyze, etc.)
│       ├── mcp/        # MCP JSON-RPC server (32 tools)
│       └── api/        # Axum REST API + embedded React UI
├── codemem-engine/     # Domain logic (index, hooks, recall, consolidation)
├── codemem-storage/    # SQLite + HNSW + petgraph
├── codemem-embeddings/ # Candle / Ollama / OpenAI / Gemini providers
├── codemem-core/       # Shared types, traits, errors, config
└── codemem-bench/      # Criterion benchmarks
ui/                     # React + Vite control plane UI
```

### Extension (TypeScript)

```
src/
├── extension.ts         # Activation, auto-connect, wiring
├── api/
│   └── client.ts        # REST client (all server endpoints)
├── analysis/
│   ├── parser.ts        # Regex-AST parser (TS/JS/Python/Rust/generic)
│   ├── upload.ts        # Chunked upload queue with retry
│   ├── watcher.ts       # FileSystemWatcher wrapper
│   ├── enrichment.ts    # Complexity analysis, code smells
│   ├── git.ts           # Git co-change + modified-by extraction
│   ├── memories.ts      # Auto-memory generation from graph patterns
│   ├── quality-report.ts# Visual analysis report
│   ├── types.ts         # All analysis types
│   └── util.ts          # Helpers
├── commands/
│   └── index.ts         # All command registrations + init + analysis pipeline
├── providers/
│   ├── memoriesProvider.ts  # Tree data provider for memories sidebar
│   ├── sessionsProvider.ts  # Tree data provider for sessions sidebar
│   └── setupWizard.ts      # 3-step guided onboarding webview
└── utils/
    ├── statusBar.ts     # Status bar manager (connected/disconnected/up-to-date)
    └── mcpConfig.ts     # MCP configuration writer
```

---

## Comparison vs Alternatives

| Feature | CodeMem | claude-mem | Mem0 | Zep | Cognee |
|---------|:-------:|:----------:|:----:|:---:|:------:|
| Zero dependencies | ✅ | ❌ | ❌ | ❌ | ❌ |
| Fully offline | ✅ | ❌ | ❌ | ❌ | ❌ |
| <100ms startup | ✅ | ❌ | ❌ | ❌ | ❌ |
| Code-aware (14 langs) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Knowledge graph | ✅ | ❌ | ❌ | ✅ | ✅ |
| Graph algorithms | ✅ | ❌ | ❌ | ❌ | ❌ |
| Temporal graph | ✅ | ❌ | ❌ | ✅ | ❌ |
| Diff-aware review | ✅ | ❌ | ❌ | ❌ | ❌ |
| 9-component scoring | ✅ | ❌ | ❌ | ❌ | ❌ |
| Memory consolidation | ✅ | ❌ | ❌ | ❌ | ❌ |
| Self-editing memory | ✅ | ❌ | ❌ | ❌ | ❌ |
| 32 MCP tools | ✅ | ❌ | ❌ | ❌ | ❌ |
| VS Code extension | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Quick Start Commands

```bash
# Install server
cargo install codemem

# Start server
codemem serve --api --http --port 4242

# Initialize a project
cd your-project && codemem init

# Full analysis (AST + SCIP + temporal)
codemem analyze

# Search memories
codemem search "authentication flow"

# Check health
codemem stats

# Review a diff
git diff main | codemem review

# Watch for changes
codemem watch
```

In VS Code:
1. Install the CodeMem Team extension
2. Set `codemem.serverUrl` to your server
3. Run command: "CodeMem: Initialize Workspace"
4. Run command: "CodeMem: Register Repository"
5. Run command: "CodeMem: Analyze Workspace"
6. Done — on-save hooks keep the graph current automatically
