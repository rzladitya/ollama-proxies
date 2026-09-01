# Ollama Proxy — Task Board V1

**Document:** Engineering Task Breakdown  
**Product:** Ollama Proxy  
**Version:** 1.0  
**Total Tasks:** 100  
**Phases:** 16 (0–15)

---

## Team Role Mapping

| Role | Phases | Focus |
|------|--------|-------|
| Backend Engineer 1 | 0, 1, 2 | Bootstrap, Database, Security |
| Backend Engineer 2 | 3, 4 | Upstream Client, OpenAI API |
| Backend Engineer 3 | 5, 6, 7 | Routing Core, Failover, Streaming |
| Backend Engineer 4 | 8, 9 | Admin API, Telemetry |
| Frontend Engineer 1 | 10, 11 | Shell, UI Components |
| Frontend Engineer 2 | 12, 13 | Pages, Data Hooks |
| DevOps / QA | 14, 15 | Build Integration, Testing |

---

## Phase Summary

| Phase | Domain | Tasks | Priority | Depends On |
|------:|--------|------:|----------|------------|
| 0 | Project Bootstrap | 4 | HIGH | — |
| 1 | Database & Schema | 8 | HIGH | Phase 0 |
| 2 | Security | 4 | HIGH | Phase 1 |
| 3 | Upstream Client | 5 | HIGH | Phase 0 |
| 4 | OpenAI-Compatible API | 7 | HIGH | Phase 2, 3 |
| 5 | Routing Core | 6 | HIGH | Phase 1 |
| 6 | Failover & Health | 5 | HIGH | Phase 5 |
| 7 | Streaming Safety | 4 | HIGH | Phase 3, 6 |
| 8 | Admin API | 11 | MEDIUM | Phase 2, 5 |
| 9 | Telemetry & Observability | 5 | MEDIUM | Phase 1, 4 |
| 10 | Frontend Shell | 5 | MEDIUM | Phase 0 |
| 11 | UI Components | 14 | MEDIUM | Phase 10 |
| 12 | Pages | 9 | MEDIUM | Phase 8, 11 |
| 13 | Frontend Data Hooks | 7 | MEDIUM | Phase 8, 10 |
| 14 | Build Integration | 3 | MEDIUM | Phase 4, 12 |
| 15 | Testing | 11 | LOW | Phase 7, 8 |

---

## Parallel Execution Map

```text
Week 1-2:
  BE1: Phase 0 ──▶ Phase 1 ──▶ Phase 2
  BE2:              Phase 3 (parallel with BE1 Phase 1)
  FE1:              Phase 10 (after Phase 0 done)

Week 3-4:
  BE2: Phase 4 (after Phase 2+3)
  BE3: Phase 5 ──▶ Phase 6 ──▶ Phase 7
  FE1: Phase 11

Week 4-5:
  BE4: Phase 8 ──▶ Phase 9
  FE2: Phase 12 ──▶ Phase 13

Week 5-6:
  ALL: Phase 14 (integration)
  QA:  Phase 15 (testing)
```

---

## PHASE 0 — Project Bootstrap

> **Owner:** Backend Engineer 1  
> **Priority:** HIGH  
> **Dependencies:** None

| # | Task | Status |
|--:|------|--------|
| 001 | Scaffold npm workspace (`apps/server`, `apps/web`, `packages/shared`, `packages/routing-core`, `packages/ollama-client`, `packages/storage`, `packages/ui`) | `done` |
| 002 | Fastify server skeleton — `apps/server/src/main.ts`, dev script, listen on port 11435 | `done` |
| 003 | React + Vite skeleton — `apps/web`, dev proxy API calls to Fastify | `done` |
| 004 | `.env.example` + config loader with Zod validation (`OLLAMA_PROXY_HOST`, `PORT`, `DATA_DIR`, `ENCRYPTION_KEY`, `ADMIN_SECRET`, `LOG_LEVEL`) | `done` |

**Acceptance:** `npm install && npm run dev` starts both backend and frontend without errors. **VERIFIED**

---

## PHASE 1 — Database & Schema

> **Owner:** Backend Engineer 1  
> **Priority:** HIGH  
> **Dependencies:** Phase 0

| # | Task | Status |
|--:|------|--------|
| 005 | Drizzle ORM setup + SQLite driver (`better-sqlite3`), auto-create `./data/` directory | `done` |
| 006 | Schema: `upstream_accounts` (id, name, encrypted_api_key, enabled, state, priority, weight, timestamps, last_error_code) | `done` |
| 007 | Schema: `account_pools` + `account_pool_members` (pool_id, account_id, enabled) | `done` |
| 008 | Schema: `models` + `account_models` (public_model_id, upstream_model_id, availability, exclusion) | `done` |
| 009 | Schema: `proxy_api_keys` + `proxy_key_models` (key_prefix, secret_hash, pool_id, limits) | `done` |
| 010 | Schema: `request_logs` (request_id, timestamp, model, accounts, attempts, latency, status, tokens) | `done` |
| 011 | Schema: `settings` (key-value for routing config, gateway config) | `done` |
| 012 | Migration runner on startup + first-run bootstrap: create default `"all"` pool, insert default routing settings | `done` |

**Acceptance:** On first `npm run dev`, SQLite DB is created at `./data/ollama-proxy.db` with all tables. Restart preserves data. **VERIFIED**

---

## PHASE 2 — Security

> **Owner:** Backend Engineer 1  
> **Priority:** HIGH  
> **Dependencies:** Phase 1

| # | Task | Status |
|--:|------|--------|
| 013 | Encryption service — AES-256-GCM encrypt/decrypt for upstream API keys using `OLLAMA_PROXY_ENCRYPTION_KEY` | `done` |
| 014 | Proxy key hash — generate `sk-proxy-<random>`, store SHA-256 hash + `key_prefix`, show secret once | `done` |
| 015 | Redaction module — centralized function to strip secrets from any log output | `done` |
| 016 | Admin auth middleware — verify `OLLAMA_PROXY_ADMIN_SECRET` on all `/api/admin/*` routes | `done` |

**Acceptance:** Upstream keys encrypted in DB. Proxy key secret not recoverable. No secret in Pino logs. Admin routes reject unauthenticated requests. **VERIFIED**

---

## PHASE 3 — Upstream Client

> **Owner:** Backend Engineer 2  
> **Priority:** HIGH  
> **Dependencies:** Phase 0

| # | Task | Status |
|--:|------|--------|
| 017 | `packages/ollama-client` — non-streaming `POST /v1/chat/completions` to Ollama Cloud | `done` |
| 018 | SSE streaming chat completion + `onFirstOutput` callback hook | `done` |
| 019 | Model list fetch — `GET /v1/models` from Ollama Cloud, parse response | `done` |
| 020 | Error classification — map upstream HTTP status to `ErrorCategory` enum (CLIENT_AUTH, RATE_LIMIT, TIMEOUT, CONNECTION, 5XX) | `done` |
| 021 | AbortController support — wire timeout, client disconnect, and server shutdown signals | `done` |

**Acceptance:** Can call Ollama Cloud, stream SSE, classify errors, abort cleanly. No automatic invisible retries inside the client. **VERIFIED**

---

## PHASE 4 — OpenAI-Compatible API

> **Owner:** Backend Engineer 2  
> **Priority:** HIGH  
> **Dependencies:** Phase 2, Phase 3

| # | Task | Status |
|--:|------|--------|
| 022 | `GET /v1/models` — return proxy-visible models (enabled + available on ≥1 eligible account) | `done` |
| 023 | `POST /v1/chat/completions` — non-streaming: validate, route, forward, return compatible response | `done` |
| 024 | `POST /v1/chat/completions` — SSE streaming: `stream=true`, forward SSE chunks to client | `done` |
| 025 | Proxy key auth middleware — parse `Authorization: Bearer sk-proxy-...`, verify hash, load key config (pool, models, limits) | `done` |
| 026 | Request validation — Zod schemas for chat completion request body (model, messages, temperature, stream, tools, user) | `done` |
| 027 | OpenAI-compatible error envelope — `{ error: { message, type, code } }` | `done` |
| 028 | `X-Request-ID` — generate `req_<sortable-random>` if not provided, return in response header | `done` |

**Acceptance:** Dify/OpenCode can call `/v1/chat/completions` with proxy key. Models listed. Errors are OpenAI-shaped. Request ID tracked. **VERIFIED**

---

## PHASE 5 — Routing Core

> **Owner:** Backend Engineer 3  
> **Priority:** HIGH  
> **Dependencies:** Phase 1

| # | Task | Status |
|--:|------|--------|
| 029 | Routing-key resolver — priority: `X-Proxy-Session-ID` > `request.user` > no affinity | `done` |
| 030 | In-memory lease store — `Map<string, LeaseEntry>` with TTL cleanup (30 min default) | `done` |
| 031 | Lease key generation — hash of `proxyKeyId + poolId + publicModelId + routingKey` | `done` |
| 032 | Eligible account resolver — filter by: enabled, pool membership, model support, state ≠ INVALID/DISABLED, cooldown expired, not already attempted | `done` |
| 033 | Account selector — highest priority group → lowest `activeRequests / normalizedWeight` → weighted tie-break (injectable RNG for tests) | `done` |
| 034 | Active request counter — atomic increment/decrement per account, never negative, cleaned in `finally` | `done` |

**Acceptance:** Unit tests prove: lease wins, priority wins, lower load wins, weight affects tie, invalid/cooldown account never selected, pool isolation enforced. **VERIFIED**

---

## PHASE 6 — Failover & Health

> **Owner:** Backend Engineer 3  
> **Priority:** HIGH  
> **Dependencies:** Phase 5

| # | Task | Status |
|--:|------|--------|
| 035 | Attempt runner — orchestrate up to 3 upstream attempts, no same account twice, yield accounts from selector | `done` |
| 036 | Cooldown manager — `Map<accountId, CooldownEntry>`, TTL-based: 429 → 300s, transient → 120s | `done` |
| 037 | Health manager — state machine: ACTIVE → DEGRADED → COOLDOWN → INVALID, success restores ACTIVE | `done` |
| 038 | Lease migration — on successful failover, update lease to point to new account | `done` |
| 039 | Failure window counter — track failures per account in rolling 120s window, ≥3 → COOLDOWN | `done` |

**Acceptance:** 429 triggers cooldown + failover. Lease migrates on success. Failed failover returns sanitized error. State transitions match spec. **VERIFIED**

---

## PHASE 7 — Streaming Safety

> **Owner:** Backend Engineer 3  
> **Priority:** HIGH  
> **Dependencies:** Phase 3, Phase 6

| # | Task | Status |
|--:|------|--------|
| 040 | Track `firstOutputCommitted` flag — set when first SSE payload written to downstream client | `done` |
| 041 | Pre-output retry allowed, post-output retry blocked — throw `STREAM_INTERRUPTED` after first token | `done` |
| 042 | Client disconnect handling — detect disconnect, abort upstream, decrement active counter, close trace | `done` |
| 043 | Graceful shutdown — stop accepting new requests, drain active up to timeout, flush logs, close DB | `done` |

**Acceptance:** Test proves: failure before first token → failover works. Failure after first token → stream terminated, no retry. Client disconnect cleans up. **VERIFIED**

---

## PHASE 8 — Admin API

> **Owner:** Backend Engineer 4  
> **Priority:** MEDIUM  
> **Dependencies:** Phase 2, Phase 5

| # | Task | Status |
|--:|------|--------|
| 044 | `GET/POST /api/admin/accounts` — list all, create new (encrypt key, optional test, persist) | `done` |
| 045 | `GET/PATCH/DELETE /api/admin/accounts/:id` — get detail, update fields, remove account | `done` |
| 046 | `POST /api/admin/accounts/:id/test` — test connection, return sanitized result (success/fail, model count, latency) | `done` |
| 047 | `POST /api/admin/accounts/:id/enable` + `/disable` — state transitions | `done` |
| 048 | `POST /api/admin/accounts/:id/refresh-models` — fetch upstream models, update account_models | `done` |
| 049 | `GET/POST/PATCH/DELETE /api/admin/pools` — CRUD account pools | `done` |
| 050 | `GET/POST/PATCH/DELETE /api/admin/api-keys` + `POST /:id/revoke` — CRUD proxy keys, show secret once | `done` |
| 051 | `GET/PATCH /api/admin/models` — list models, toggle enable/disable, set exclusions | `done` |
| 052 | `GET /api/admin/requests` + `GET /:id` — list with filters (time, status, model, account, failover), detail with routing timeline | `done` |
| 053 | `GET/PUT /api/admin/routing` — read/write routing config (sticky, TTL, failover, cooldown) | `done` |
| 054 | `GET/PUT /api/admin/settings` — read/write gateway settings (timeout, logging, security) | `done` |

**Acceptance:** All admin CRUD operations work via HTTP. Secrets never returned after creation. Connection test works. Models refresh from upstream. **VERIFIED**

---

## PHASE 9 — Telemetry & Observability

> **Owner:** Backend Engineer 4  
> **Priority:** MEDIUM  
> **Dependencies:** Phase 1, Phase 4

| # | Task | Status |
|--:|------|--------|
| 055 | `RequestTrace` class — accumulate routing events array, persist summary to `request_logs` on completion | `done` |
| 056 | Insert `request_logs` on every completed request (request_id, model, accounts, attempts, failovers, latency, status) | `done` |
| 057 | Log retention cleanup — delete logs older than 7 days, run at startup + every 6 hours | `done` |
| 058 | Pino structured logging — request_id, route, model, accountId, attempt, status, latency. Forbidden: secrets, prompts, response body | `done` |
| 059 | `GET /health/live` (always 200) + `GET /health/ready` (checks DB + runtime state) | `done` |

**Acceptance:** Every request logged with routing metadata. Pino output is structured JSON. Health endpoints respond correctly. Old logs cleaned. **VERIFIED**

---

## PHASE 10 — Frontend Shell

> **Owner:** Frontend Engineer 1  
> **Priority:** MEDIUM  
> **Dependencies:** Phase 0

| # | Task | Status |
|--:|------|--------|
| 060 | AppShell layout — fixed sidebar (230px) + main content area, responsive collapse at 700px | `done` |
| 061 | SidebarNav — 7 primary items (Overview, Accounts, Models, API Keys, Requests, Routing, Settings) + footer (System Status, Docs, Profile) | `done` |
| 062 | React Router setup — `/admin`, `/admin/accounts`, `/admin/accounts/:id`, `/admin/models`, `/admin/api-keys`, `/admin/requests`, `/admin/routing`, `/admin/settings`, `/admin/status` | `done` |
| 063 | Design tokens as CSS variables — `--color-bg-canvas`, `--color-accent` (teal), `--color-success/warning/degraded/danger`, `--radius-*`, `--space-*` | `done` |
| 064 | Tailwind config — extend with design system tokens, Space Grotesk + IBM Plex Mono fonts | `done` |

**Acceptance:** Shell renders with working navigation. All routes resolve. Design tokens applied. Responsive sidebar works. **VERIFIED**

---

## PHASE 11 — UI Components

> **Owner:** Frontend Engineer 1  
> **Priority:** MEDIUM  
> **Dependencies:** Phase 10

| # | Task | Status |
|--:|------|--------|
| 065 | `PageHeader` — title, description, right-side actions | `done` |
| 066 | `MetricCard` — label, primary value, secondary context, optional mini trend | `done` |
| 067 | `StatusBadge` + `AccountStatusBadge` — dot + label for Active/Degraded/Cooldown/Invalid/Disabled | `done` |
| 068 | `DataTable` — sortable columns, row hover, compact density (44px), pagination, loading skeleton, empty state | `done` |
| 069 | `TableToolbar` — search input, filter selects, action buttons | `done` |
| 070 | Button variants — primary (teal), secondary, ghost, destructive. States: default, hover, active, focus, disabled, loading (spinner + preserve width) | `done` |
| 071 | Form controls — `Input`, `SecretInput` (masked + reveal toggle), `Select`/`Combobox` (searchable), `Toggle`, `Checkbox` | `done` |
| 072 | `Modal` + `ConfirmDialog` — overlay, title/description/body/footer, destructive confirms name the resource | `done` |
| 073 | `DetailDrawer` — 520–680px right panel, overlay, close button, preserves table behind | `done` |
| 074 | `CodeValue` + `CopyButton` (monospace + copy feedback) + `Toast` (transient 2.6s) | `done` |
| 075 | `EmptyState` (message + CTA) + `InlineAlert` (info/warning/error) + `ConfigSection` (card with settings rows) | `done` |
| 076 | `RoutingTimeline` — vertical event sequence with timestamps, semantic icons, expandable metadata | `done` |
| 077 | `Badge` variants — success, warning, degraded, danger, neutral, info (compact pill) | `done` |
| 078 | Skeleton loaders — shimmer placeholders for MetricCard, DataTable rows, chart area | `done` |

**Acceptance:** Component library renders all states (default, hover, focus, disabled, loading, error, empty). Accessible: keyboard focus visible, labels bound. **VERIFIED**

---

## PHASE 12 — Pages

> **Owner:** Frontend Engineer 2  
> **Priority:** MEDIUM  
> **Dependencies:** Phase 8, Phase 11

| # | Task | Status |
|--:|------|--------|
| 079 | **Overview** — 6 KPI cards, request traffic chart (1H/6H/24H/7D), account pool table, routing distribution bar, recent failovers list | `done` |
| 080 | **Accounts** — table (name, status, models, active, requests, error rate, last used, actions), toolbar (search, status filter, model filter) | `done` |
| 081 | **Account Detail** — header with status badge, 6 metric cards, tabs: Overview / Models / Requests / Health | `done` |
| 082 | **Models** — table (model ID, available accounts, health, requests, latency, routing), availability matrix detail | `done` |
| 083 | **API Keys** — table (name, masked key, models, pool, requests, last used, status), create modal, connection quickstart card | `done` |
| 084 | **Requests** — dense table (time, request ID, client, model, account, status, latency, failover, tokens), filters, detail drawer with routing timeline | `done` |
| 085 | **Routing** — strategy card, visual flow diagram, config sections (session affinity, account selection, failover, cooldown, streaming warning) | `done` |
| 086 | **Settings** — config cards: Gateway, Storage, Logging (toggles), Security. Page-level Save Changes button | `done` |
| 087 | **System Status** — 4 service health tiles (Gateway, Database, Redis, Ollama Cloud), account capacity summary | `done` |

**Acceptance:** All 9 pages render with real data from admin API. Loading/empty/error states work. Modals and drawers functional. **VERIFIED**

---

## PHASE 13 — Frontend Data Hooks

> **Owner:** Frontend Engineer 2  
> **Priority:** MEDIUM  
> **Dependencies:** Phase 8, Phase 10

| # | Task | Status |
|--:|------|--------|
| 088 | TanStack Query setup + typed API client (fetch wrapper with admin auth header) | `done` |
| 089 | `useAccounts`, `useAccount(id)`, `useCreateAccount`, `useUpdateAccount`, `useDeleteAccount`, `useTestConnection(id)` | `done` |
| 090 | `useModels`, `useModel(id)`, `useRefreshModels(accountId)` | `done` |
| 091 | `useApiKeys`, `useCreateApiKey`, `useRevokeApiKey(id)` | `done` |
| 092 | `useRequests(filters)`, `useRequestDetail(id)` | `done` |
| 093 | `useRoutingConfig`, `useUpdateRouting` | `done` |
| 094 | `useSettings`, `useUpdateSettings`, `useSystemStatus` | `done` |

**Acceptance:** All hooks fetch/mutate via admin API. Mutations invalidate relevant queries. Error states surfaced. **VERIFIED**

---

## PHASE 14 — Build Integration

> **Owner:** DevOps / QA  
> **Priority:** MEDIUM  
> **Dependencies:** Phase 4, Phase 12

| # | Task | Status |
|--:|------|--------|
| 095 | Vite production build → static files served by Fastify at `/admin/*` | `done` |
| 096 | `npm run build` → compiles all workspaces (server + web + packages) | `done` |
| 097 | `npm start` → runs production Fastify serving API + static admin UI on port 11435 | `done` |

**Acceptance:** `npm run build && npm start` → `http://localhost:11435/admin` works. `/v1/chat/completions` works. Single process, no external deps. **VERIFIED**

---

## PHASE 15 — Testing

> **Owner:** DevOps / QA  
> **Priority:** LOW  
> **Dependencies:** Phase 7, Phase 8

| # | Task | Status |
|--:|------|--------|
| 098 | Mock upstream server fixture — configurable responses: 200, 401, 429, 500, timeout, stream success, stream fail before/after output, disconnect | `done` |
| 099 | Unit: `routing-key.spec.ts` — header priority, user fallback, no affinity | `done` |
| 100 | Unit: `lease-store.spec.ts` — get, set, delete, TTL expiry, cleanup | `done` |
| 101 | Unit: `account-selector.spec.ts` — priority grouping, least load, weighted tie-break, exclusion filters | `done` |
| 102 | Unit: `attempt-runner.spec.ts` — retry on 429, max 3 attempts, no duplicate account, lease migration | `done` |
| 103 | Unit: `cooldown.spec.ts` — set cooldown, auto-expire, account re-eligible after TTL | `done` |
| 104 | Unit: `error-classifier.spec.ts` — retryable (429/timeout/5xx) vs terminal (400/proxy auth) | `done` |
| 105 | Unit: `stream-boundary.spec.ts` — retry before first token, no retry after, disconnect cleanup | `done` |
| 106 | API: auth, `/v1/models`, `/v1/chat/completions`, account CRUD, key CRUD, pool isolation | `done` |
| 107 | E2E Playwright: open admin, add account, test connection, create API key, send request, see request log, simulate 429 failover, see cooldown | `done` |
| 108 | Security: verify no upstream key in any API response, no proxy secret in logs, masked key display | `done` |

**Acceptance:** All tests pass in CI without real Ollama Cloud credentials. Mock upstream covers all error scenarios. Routing core has highest coverage. **VERIFIED**

---

## Definition of Done — V1

All phases complete when:

```text
npm install
npm run dev
```

A user can:

- [x] Open admin UI at `http://localhost:11435/admin`
- [x] Add multiple Ollama Cloud accounts
- [x] Test account connections
- [x] Refresh models from upstream
- [x] Create proxy API keys (secret shown once)
- [x] Call `GET /v1/models` with proxy key
- [x] Call `POST /v1/chat/completions` (non-streaming + streaming)
- [x] Use sticky session affinity with `X-Proxy-Session-ID`
- [x] See automatic failover on 429/timeout
- [x] See cooldown state in admin UI
- [x] Inspect request logs with routing timeline
- [x] Restart without losing accounts/keys/settings
- [x] No global npm install, no Redis, no PostgreSQL, no Docker required
