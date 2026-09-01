# Ollama Proxy — Implementation Specification V1

**Document:** Engineering Implementation Specification  
**Product:** Ollama Proxy  
**Version:** 1.0  
**Status:** Coding Baseline  
**Primary consumer:** OpenCode / coding agents / engineers

---

# 1. Objective

Implement Ollama Proxy as a local Node.js/TypeScript project.

The expected developer workflow is:

```bash
git clone <repository>
cd ollama-proxy
npm install
npm run dev
```

The implementation must not require:

- global npm package installation
- global CLI installation
- Redis
- PostgreSQL
- Docker

for normal local V1 operation.

---

# 2. Frozen Technology Stack

```text
Node.js            22+
TypeScript         strict mode
npm                workspaces
Backend            Fastify
Frontend           React + Vite
Routing            React Router or equivalent
Validation         Zod
ORM                Drizzle ORM
Default DB         SQLite
Optional DB        PostgreSQL later
Default cache      in-memory
Optional cache     Redis later
HTTP client        undici / native fetch-compatible
Logging            Pino
CSS                 Tailwind CSS
UI primitives      Radix/shadcn-compatible components
Charts              lightweight React chart library
Unit tests          Vitest
API tests           Vitest + Fastify inject
E2E                 Playwright
Formatting          Prettier
Lint                ESLint
```

Do not introduce a large framework without a concrete requirement.

---

# 3. Root Repository

```text
ollama-proxy/
├── apps/
│   ├── server/
│   └── web/
├── packages/
│   ├── shared/
│   ├── routing-core/
│   ├── ollama-client/
│   ├── storage/
│   └── ui/
├── data/
├── docs/
├── scripts/
├── .env.example
├── package.json
├── package-lock.json
├── tsconfig.base.json
└── README.md
```

---

# 4. Root npm Scripts

Required:

```json
{
  "scripts": {
    "dev": "run development server and web app",
    "build": "build all workspaces",
    "start": "start production build locally",
    "test": "run unit and API tests",
    "test:e2e": "run Playwright tests",
    "lint": "run linting",
    "typecheck": "run TypeScript checks",
    "format": "format repository",
    "db:generate": "generate Drizzle migration",
    "db:migrate": "apply local migrations"
  }
}
```

Exact command implementation may use a small task runner such as `concurrently`.

Do not require users to install it globally.

---

# 5. Local Runtime Behavior

## Development

```bash
npm install
npm run dev
```

Expected:

```text
Admin UI:
http://localhost:11435/admin

OpenAI API:
http://localhost:11435/v1
```

It is acceptable if Vite internally uses another development port as long as the user-facing workflow is clearly documented.

## Production-Style Local

```bash
npm run build
npm start
```

Expected:

```text
Fastify serves:
- /v1/*
- /api/admin/*
- /health/*
- built admin frontend
```

---

# 6. Environment Configuration

Create `.env.example`.

Minimum:

```env
OLLAMA_PROXY_HOST=127.0.0.1
OLLAMA_PROXY_PORT=11435

OLLAMA_PROXY_DATA_DIR=./data

OLLAMA_PROXY_ENCRYPTION_KEY=
OLLAMA_PROXY_ADMIN_SECRET=

OLLAMA_PROXY_LOG_LEVEL=info
OLLAMA_PROXY_REQUEST_TIMEOUT_SECONDS=120
OLLAMA_PROXY_MAX_ATTEMPTS=3
```

Development may generate safe local configuration through a bootstrap process, but production-like start must fail clearly if required encryption/security config is missing.

Never commit actual secrets.

---

# 7. Backend Modules

## `api/openai`

Contains:

```text
models.route.ts
chat-completions.route.ts
responses.route.ts optional
errors.ts
schemas.ts
```

Responsibilities:

- HTTP only
- no account scoring logic
- no direct DB queries except through service interfaces

---

## `api/admin`

Contains resources:

```text
accounts
models
pools
apiKeys
requests
routing
settings
status
```

---

## `auth`

```text
proxy-key.service.ts
admin-auth.service.ts
hash.ts
```

Responsibilities:

- key hash
- authorization
- key restrictions

---

## `accounts`

```text
account.service.ts
account.repository.ts
account-health.service.ts
account-secret.service.ts
```

---

## `models`

```text
model.service.ts
model.repository.ts
model-refresh.service.ts
```

---

## `routing`

Core implementation should live in shared package when possible.

```text
routing.service.ts
routing-key.ts
lease-store.ts
account-selector.ts
attempt-runner.ts
cooldown-store.ts
runtime-state.ts
error-classifier.ts
```

---

## `upstream`

```text
ollama.service.ts
stream-adapter.ts
upstream-errors.ts
```

---

## `storage`

```text
db.ts
schema.ts
migrations/
repositories/
```

---

## `telemetry`

```text
request-trace.ts
request-log.repository.ts
metrics.ts
redaction.ts
```

---

# 8. Shared Types

`packages/shared` should own request-independent domain types.

Examples:

```ts
export type AccountState =
  | "ACTIVE"
  | "DEGRADED"
  | "COOLDOWN"
  | "INVALID"
  | "DISABLED"

export type ErrorCategory =
  | "CLIENT_AUTH_ERROR"
  | "CLIENT_VALIDATION_ERROR"
  | "MODEL_NOT_AVAILABLE"
  | "NO_ELIGIBLE_ACCOUNT"
  | "UPSTREAM_AUTH_ERROR"
  | "UPSTREAM_RATE_LIMIT"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_CONNECTION_ERROR"
  | "UPSTREAM_5XX"
  | "STREAM_INTERRUPTED"
  | "INTERNAL_ERROR"
```

Avoid duplicate enum strings across frontend/backend.

---

# 9. Database Schema

Implement Drizzle schema for:

```text
upstream_accounts
account_pools
account_pool_members
models
account_models
proxy_api_keys
proxy_key_models
request_logs
routing_events optional
settings
```

SQLite is default.

Do not model runtime leases as SQL rows in standalone V1.

---

# 10. Secret Encryption

Upstream API keys:

```text
plaintext input
   |
   v
server-side encryption
   |
   v
ciphertext in SQLite
```

Required:

- authenticated encryption
- external encryption key
- no homemade crypto
- versioned ciphertext format if practical

Proxy API keys:

```text
random secret
-> display once
-> cryptographic hash
-> persist hash only
```

---

# 11. API Key Generation

Recommended shape:

```text
sk-proxy_<random>
```

Store:

```text
id
name
prefix
hash
status
poolId
limits
timestamps
```

Do not make secret recoverable.

---

# 12. Routing Core Interface

`packages/routing-core`

Suggested interfaces:

```ts
interface LeaseStore {
  get(key: string): Promise<Lease | null>
  set(key: string, lease: Lease, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
}

interface RuntimeState {
  getActive(accountId: string): number
  incrementActive(accountId: string): void
  decrementActive(accountId: string): void

  getCooldown(accountId: string): Cooldown | null
  setCooldown(accountId: string, cooldown: Cooldown): void

  recordFailure(accountId: string, error: RoutingError): void
  recordSuccess(accountId: string): void
}

interface AccountSelector {
  select(accounts: EligibleAccount[]): EligibleAccount
}
```

In-memory implementations are mandatory.

Redis implementation is future/optional.

---

# 13. Routing Determinism

Do not hide routing behavior inside random helpers.

The account selector must be unit-testable with fixed inputs.

Tests must prove:

```text
lease wins
priority wins
lower load wins
weight affects tie
invalid account never selected
cooldown account never selected
```

If weighted selection uses randomness, inject RNG so tests can control it.

---

# 14. Upstream Client Requirements

Must support:

- non-stream request
- streamed request
- request cancellation
- timeout
- status code access
- response headers
- first-byte event
- structured errors

Never perform automatic invisible retries.

Retry is owned by `AttemptRunner`.

---

# 15. Streaming Implementation

Use backpressure-aware Node streaming.

Behavior:

```text
upstream stream starts
   |
   +-- no client bytes sent
   |     -> retry may occur on failure
   |
   +-- bytes sent
         -> request locked to account
```

Track:

```ts
let outputCommitted = false
```

Set when first SSE payload is successfully written downstream.

---

# 16. Abort Handling

Use `AbortController`.

Triggers:

- client disconnect
- request timeout
- server shutdown

Cleanup must always:

```text
abort upstream
decrement account active counter
close trace
```

---

# 17. Logging

Use Pino structured logs.

Allowed:

```text
requestId
route
model
accountId
clientName
attempt
status
latency
errorCategory
```

Forbidden by default:

```text
Authorization header
upstream API key
proxy key secret
prompt/messages
response content
raw routing session ID
```

Implement redaction centrally.

---

# 18. Admin Frontend Routes

```text
/admin
/admin/accounts
/admin/accounts/:id
/admin/models
/admin/models/:id
/admin/api-keys
/admin/requests
/admin/routing
/admin/settings
/admin/status
```

---

# 19. Frontend Feature Structure

```text
src/features/
├── accounts/
├── models/
├── api-keys/
├── requests/
├── routing/
├── settings/
└── status/
```

Each feature owns:

```text
api
types
components
hooks
pages
```

Shared primitives remain in `packages/ui`.

---

# 20. State Management

Do not introduce Redux by default.

Recommended:

- server state: TanStack Query or equivalent
- local form state: component/form library
- routing: React Router
- small global UI state only if necessary

Operational data comes from backend APIs.

---

# 21. UI Implementation Rules

Use the Design System Specification.

Required reusable components:

```text
PageHeader
MetricCard
StatusBadge
AccountStatusBadge
DataTable
TableToolbar
RequestStatus
RoutingTimeline
CodeValue
SecretValue
CopyButton
InlineAlert
ConfirmDialog
DetailDrawer
ConfigSection
EmptyState
```

Do not hand-style duplicate status badges per page.

---

# 22. Account Create Workflow

Implementation:

```text
form input
-> POST /api/admin/accounts
-> server encrypts key
-> optional connection test
-> model refresh
-> persist result
-> return sanitized account
```

UI states:

```text
idle
testing
test success
test failure
saving
saved
```

---

# 23. Connection Test

Must not persist an account merely because test is executed unless the user saves.

Test result should include sanitized:

```text
success/failure
status category
detected model count
latency
```

No raw secret echo.

---

# 24. Model Refresh

Per account:

```text
admin action
-> use account secret
-> fetch upstream model inventory
-> update account_models
-> update last_checked_at
```

Global refresh may iterate enabled accounts with bounded concurrency.

---

# 25. Request Trace

Create one trace at ingress.

Suggested object:

```ts
class RequestTrace {
  requestId
  startedAt
  events[]
  initialAccountId?
  finalAccountId?
  attemptCount
  failoverCount
}
```

Persist summary at completion.

Persist event details only if enabled/needed.

---

# 26. Request Log Retention

Default:

```text
7 days
```

V1 implementation may run cleanup:

- at startup
- periodically every N hours

Do not add a job queue.

---

# 27. Database Migration

On local startup:

```text
ensure data directory
open DB
apply pending migrations
start app
```

Never silently destroy incompatible data.

---

# 28. First-Run Bootstrap

If database does not exist:

```text
create SQLite
run schema migrations
create default "all" account pool
create default routing settings
```

Admin security must be initialized from environment or explicit setup flow.

---

# 29. Default Routing Settings

```json
{
  "stickyEnabled": true,
  "leaseTtlSeconds": 1800,
  "extendLeaseOnSuccess": true,
  "maxAttempts": 3,
  "rateLimitCooldownSeconds": 300,
  "transientFailureCooldownSeconds": 120,
  "transientFailureThreshold": 3,
  "selection": "PRIORITY_LEAST_LOAD_WEIGHTED"
}
```

---

# 30. Unit Test Requirements

`routing-core` must have highest test coverage priority.

Tests:

```text
routing-key.spec.ts
lease-store.spec.ts
account-selector.spec.ts
attempt-runner.spec.ts
cooldown.spec.ts
error-classifier.spec.ts
stream-boundary.spec.ts
```

---

# 31. API Test Requirements

Use Fastify injection where possible.

Cover:

```text
auth
model list
chat request validation
account CRUD
API key CRUD
pool isolation
request log filtering
routing settings
```

---

# 32. End-to-End Tests

Playwright:

```text
open overview
add test account using mocked upstream
create API key
view models
send request
see request log
simulate 429
see failover
see cooldown state
```

Use controlled mocked upstream in CI.

Do not require real Ollama Cloud credentials for automated CI.

---

# 33. Mock Upstream Server

Create internal test fixture server.

Capabilities:

```text
return 200
stream chunks
return 401
return 429
return 500
delay response
disconnect before first token
disconnect after first token
list models
```

This is mandatory for reliable routing tests.

---

# 34. Build Phases

## Step 01 — Bootstrap

Deliver:

- npm workspace
- TypeScript
- Fastify
- React/Vite
- lint/typecheck/test
- basic app shell

Acceptance:

```bash
npm install
npm run dev
```

works.

---

## Step 02 — Persistence

Deliver:

- SQLite
- Drizzle
- migrations
- account/model/pool/API key schema

---

## Step 03 — Credential Security

Deliver:

- encryption
- proxy key hash
- redaction tests

---

## Step 04 — Ollama Client

Deliver:

- model fetch
- chat completion
- streaming
- abort
- error classification inputs

---

## Step 05 — OpenAI-Compatible API

Deliver:

- `/v1/models`
- `/v1/chat/completions`
- auth
- compatible error envelope

---

## Step 06 — Routing Core

Deliver:

- routing key
- in-memory lease
- active counters
- selector
- pool/model filtering

---

## Step 07 — Failover & Health

Deliver:

- attempts
- cooldown
- account states
- lease migration
- max attempts

---

## Step 08 — Streaming Safety

Deliver:

- first-output boundary
- pre-output retry
- post-output no retry
- disconnect cleanup

---

## Step 09 — Admin API

Deliver all required admin resources.

---

## Step 10 — Admin UI

Implement approved design system screens.

---

## Step 11 — Observability

Deliver:

- request logs
- timeline
- dashboard metrics
- health endpoints

---

## Step 12 — Hardening

Deliver:

- E2E tests
- mocked upstream
- install docs
- build/start workflow
- security review

---

# 35. Coding Agent Rules

OpenCode or another coding agent must:

1. Read PRD first.
2. Read API & Routing Spec before touching routing logic.
3. Read Design System before implementing UI.
4. Never invent provider-specific quota headers.
5. Never introduce prompt-based affinity.
6. Never retry after streamed output starts.
7. Never add global install requirements.
8. Keep Redis/PostgreSQL optional.
9. Keep default local mode functional without Docker.
10. Add tests with each routing behavior.

---

# 36. Definition of Done

Implementation is V1-ready when:

```bash
npm install
npm run dev
```

starts the project locally and a user can:

- open admin UI
- add multiple accounts
- test connections
- refresh models
- create a proxy API key
- call `/v1/models`
- call `/v1/chat/completions`
- stream responses
- use stable session affinity
- see automatic failover
- see cooldown state
- inspect request logs
- restart without losing durable configuration

No global package installation is required.
