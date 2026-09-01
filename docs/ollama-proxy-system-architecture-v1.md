# Ollama Proxy — System Architecture V1

**Document:** System Architecture  
**Product:** Ollama Proxy  
**Version:** 1.0  
**Status:** Implementation Baseline  
**Related documents:**  
- `ollama-proxy-product-technical-prd-v1.md`
- `ollama-proxy-design-system-v1.md`

---

# 1. Purpose

This document defines the implementation architecture for Ollama Proxy.

The architecture is intentionally optimized for:

- local project installation
- single-node operation by default
- low operational complexity
- OpenAI-compatible downstream integration
- multiple authorized Ollama Cloud accounts
- sticky account affinity
- automatic failover
- streaming support
- clear upgrade path to Redis/PostgreSQL without redesigning the router

The default runtime must work after:

```bash
git clone <repository>
cd ollama-proxy
npm install
npm run dev
```

No global npm installation is required.

---

# 2. Architecture Decision Summary

The implementation baseline is:

```text
Runtime             Node.js 22+
Language            TypeScript
API Server           Fastify
Frontend             React + Vite
UI                   Tailwind CSS + Radix/shadcn-compatible primitives
Validation           Zod
ORM                  Drizzle ORM
Default Database     SQLite
Optional Database    PostgreSQL
Default Runtime      In-process memory state
Optional Runtime     Redis
HTTP Client          undici / Node fetch-compatible client
Logging              Pino
Testing              Vitest + Playwright
Package Manager      npm
```

The backend is not embedded inside Next.js.

Reason:

The product is primarily an LLM proxy and streaming gateway. The HTTP proxy lifecycle, SSE handling, retries, timeouts, client disconnects, and active-request accounting should remain independent from a frontend framework.

---

# 3. Deployment Modes

## 3.1 Local Standalone Mode — Default

This is the default V1 runtime.

```text
┌─────────────────────────────────────┐
│          Ollama Proxy Process       │
│                                     │
│  Fastify API                        │
│  Routing Engine                     │
│  Ollama Upstream Client             │
│  Admin API                          │
│  React Static Admin UI              │
│                                     │
│  SQLite                             │
│  In-Memory Runtime State            │
└─────────────────────────────────────┘
                  |
                  v
          Ollama Cloud API
```

Used components:

```text
SQLite
├── accounts
├── models
├── account pools
├── proxy API keys
├── routing configuration
└── request metadata

Memory Store
├── sticky leases
├── cooldown state
├── active request counters
├── recent failure counters
└── health state cache
```

Advantages:

- no external service
- one repository
- one local Node.js runtime
- easy development
- easy internal deployment
- minimal setup

Tradeoff:

When the process restarts:

- sticky leases reset
- cooldown runtime state resets
- active counters reset
- health state is rebuilt

Durable configuration and historical request metadata remain in SQLite.

This behavior is acceptable for V1 standalone mode.

---

## 3.2 Persistent Runtime Mode — Optional

Optional enhancement:

```text
Fastify
   |
   +---- SQLite/PostgreSQL
   |
   +---- Redis
```

Redis may replace in-memory state for:

- sticky leases
- cooldowns
- active counters
- request-rate counters
- recent failure state

This provides state persistence across multiple API processes.

Not required for V1 acceptance.

---

## 3.3 Scale / HA Mode — Future

Future deployment:

```text
                 Load Balancer
                      |
          +-----------+-----------+
          |                       |
          v                       v
    Ollama Proxy A          Ollama Proxy B
          |                       |
          +-----------+-----------+
                      |
              PostgreSQL + Redis
                      |
                      v
                Ollama Cloud
```

This is explicitly not required for V1.

---

# 4. High-Level Runtime Flow

```text
Dify / OpenCode / n8n / SDK / Custom App
                    |
                    v
          /v1/chat/completions
                    |
                    v
             Request Gateway
                    |
                    v
             Proxy Key Auth
                    |
                    v
            Request Validation
                    |
                    v
             Model Resolution
                    |
                    v
          Routing Key Resolution
                    |
                    v
              Lease Lookup
              /         \
            HIT         MISS
             |           |
             v           v
       Validate Lease   Eligible Accounts
             |           |
             |           v
             |       Account Selector
             |           |
             +-----+-----+
                   |
                   v
              Attempt Runner
                   |
          +--------+--------+
          |                 |
       Success          Retryable Error
          |                 |
          |                 v
          |           Health/Cooldown
          |                 |
          |                 v
          |             Next Account
          |
          v
      Lease Refresh
          |
          v
       Client Response
```

---

# 5. System Components

## 5.1 API Gateway

Responsibilities:

- receive `/v1/*` requests
- generate request ID
- enforce maximum payload size
- validate proxy API key
- validate request shape
- resolve model
- initiate routing
- preserve compatible response format
- stream SSE responses
- sanitize internal errors

The gateway must not contain routing policy itself.

It delegates to the routing module.

---

## 5.2 Authentication Module

Responsibilities:

- parse `Authorization: Bearer ...`
- securely verify proxy API key hash
- load key configuration
- verify:
  - enabled status
  - allowed models
  - account pool
  - optional rate/concurrency limit

Output:

```ts
type AuthContext = {
  proxyKeyId: string
  clientName: string
  poolId: string
  allowedModels: string[] | "*"
  rpmLimit?: number
  concurrencyLimit?: number
}
```

---

## 5.3 Request Normalizer

Responsibilities:

- parse supported OpenAI-compatible request fields
- preserve optional upstream-compatible fields
- prevent unsupported internal fields from leaking upstream
- extract:
  - model
  - stream
  - user
  - messages
  - tools
  - temperature
  - max tokens / equivalent
  - optional metadata

No prompt rewriting occurs.

---

## 5.4 Model Registry

Responsibilities:

- expose public model IDs
- map public model ID to upstream model ID
- track account-level availability
- exclude disabled models/accounts
- produce `/v1/models`

Example:

```text
Public Model
qwen3.5:cloud

Account Availability
acc_01    available
acc_02    available
acc_03    unavailable
```

---

## 5.5 Routing Key Resolver

Priority:

```text
1. X-Proxy-Session-ID
2. request.user
3. no affinity
```

Output:

```ts
type RoutingIdentity =
  | {
      affinity: true
      source: "header" | "user"
      value: string
    }
  | {
      affinity: false
    }
```

The full prompt must never be used to infer session identity.

---

## 5.6 Lease Manager

Responsibilities:

- generate lease key
- read existing lease
- validate lease target account
- create lease after success
- refresh lease after success
- migrate lease after failover
- delete invalid lease

Logical lease identity:

```text
proxy_key_id
+
pool_id
+
public_model_id
+
routing_key
```

Default TTL:

```text
30 minutes
```

Standalone mode implementation:

```text
Map<string, LeaseEntry>
```

Optional Redis implementation:

```text
lease:{hash}
```

---

## 5.7 Eligible Account Resolver

Filters accounts by:

```text
enabled == true
state not INVALID
state not DISABLED
cooldown expired
pool membership
model availability
model exclusion rule
hard concurrency limit
not already attempted
```

Output:

```ts
type EligibleAccount = {
  accountId: string
  priority: number
  weight: number
  activeRequests: number
  state: "ACTIVE" | "DEGRADED"
}
```

---

## 5.8 Account Selector

Selection order:

```text
1. valid sticky lease
2. highest priority group
3. lowest effective load
4. weighted tie-break
```

Effective load baseline:

```text
activeRequests / max(weight, minimumWeight)
```

V1 must favor predictable and testable behavior over overly complex scoring.

---

## 5.9 Attempt Runner

Responsibilities:

- execute one logical client request over one or more upstream attempts
- guarantee max-attempt behavior
- track attempted accounts
- update active counter
- distinguish retryable vs terminal error
- enforce streaming first-token boundary
- update request trace

The attempt runner owns failover sequencing.

---

## 5.10 Upstream Ollama Client

Responsibilities:

- inject selected Ollama Cloud credential
- forward compatible request payload
- set upstream timeout
- handle streaming response
- classify upstream response
- normalize connection errors
- expose first-response-byte / first-token event

The router must not know HTTP transport details.

Suggested interface:

```ts
interface OllamaClient {
  chatCompletion(
    account: UpstreamAccountSecret,
    request: ChatCompletionRequest,
    hooks?: UpstreamHooks
  ): Promise<UpstreamResponse>
}
```

---

## 5.11 Health Manager

Responsibilities:

- record success
- record 429
- record timeout
- record connection errors
- record 5xx
- transition account state
- apply cooldown
- restore state after cooldown/success

Simple V1 state policy:

```text
ACTIVE
  |
  +-- transient failures -> DEGRADED
  |
  +-- threshold / 429 -> COOLDOWN
  |
  +-- invalid auth -> INVALID
```

No machine-learning health scoring.

---

## 5.12 Cooldown Manager

Standalone:

```text
Map<accountId, CooldownEntry>
```

Entry:

```ts
type CooldownEntry = {
  reason: string
  until: number
}
```

When the cooldown expires:

- account becomes eligible again
- first new successful request restores ACTIVE
- failure may return it to DEGRADED/COOLDOWN

---

## 5.13 Request Telemetry

Captures:

- request ID
- client
- model
- lease hit
- initial account
- final account
- attempts
- failovers
- latency
- streaming
- status
- error category

Default excludes:

- prompt body
- response body
- raw routing ID
- secrets

---

# 6. Process Architecture

Development:

```text
npm run dev
```

Runs:

```text
Vite Dev Server          Frontend
Fastify Dev Server       Backend
SQLite                   Local database
```

Recommended development ports:

```text
Web/API unified public URL: http://localhost:11435
Vite internal dev port:     implementation-specific
```

Preferred developer behavior:

- browser accesses admin UI from one URL
- frontend proxies admin/API calls to Fastify in dev
- production build is served through Fastify or bundled static hosting

---

# 7. Repository Structure

```text
ollama-proxy/
|
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   ├── openai/
│   │   │   │   ├── admin/
│   │   │   │   └── health/
│   │   │   ├── auth/
│   │   │   ├── accounts/
│   │   │   ├── models/
│   │   │   ├── routing/
│   │   │   ├── upstream/
│   │   │   ├── telemetry/
│   │   │   ├── storage/
│   │   │   ├── config/
│   │   │   └── main.ts
│   │   └── package.json
│   │
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── pages/
│       │   ├── components/
│       │   ├── features/
│       │   ├── hooks/
│       │   └── lib/
│       └── package.json
│
├── packages/
│   ├── shared/
│   ├── routing-core/
│   ├── ollama-client/
│   ├── storage/
│   └── ui/
│
├── data/
│   └── .gitkeep
│
├── docs/
├── .env.example
├── package.json
├── tsconfig.base.json
└── README.md
```

---

# 8. Storage Boundaries

## Durable

Must survive restart:

```text
accounts
encrypted credentials
models
model/account mapping
account pools
proxy API keys
routing configuration
request metadata
system settings
```

Stored in SQLite by default.

## Ephemeral

May reset in standalone mode:

```text
leases
cooldowns
active counters
short failure windows
current health cache
rate counters
```

Stored in memory by default.

---

# 9. SQLite Location

Default project-local runtime path:

```text
./data/ollama-proxy.db
```

The user may override:

```text
OLLAMA_PROXY_DATA_DIR=./runtime-data
```

Do not store runtime data inside `node_modules`.

---

# 10. Configuration Layer

Configuration priority:

```text
1. environment variables
2. persisted admin settings
3. application defaults
```

Examples:

```env
OLLAMA_PROXY_HOST=127.0.0.1
OLLAMA_PROXY_PORT=11435
OLLAMA_PROXY_DATA_DIR=./data
OLLAMA_PROXY_ENCRYPTION_KEY=...
OLLAMA_PROXY_ADMIN_SECRET=...
OLLAMA_PROXY_LOG_LEVEL=info
```

Sensitive values must not be committed.

---

# 11. Admin API Boundary

Admin API must be separated from public inference routes.

Suggested:

```text
/api/admin/*
```

Inference:

```text
/v1/*
```

Health:

```text
/health/*
```

Admin authentication is required even for local use unless explicitly configured otherwise for development.

---

# 12. Streaming Architecture

Streaming path:

```text
Client
  |
  v
Fastify Route
  |
  v
Attempt Runner
  |
  v
Ollama Upstream Stream
  |
  +-- no bytes emitted yet
  |      -> retry allowed
  |
  +-- first downstream bytes emitted
         -> retry disabled
```

The server must:

- detect client disconnect
- abort upstream request when possible
- decrement active request count
- close stream cleanly
- record incomplete stream

---

# 13. Error Classification

Internal categories:

```text
CLIENT_AUTH_ERROR
CLIENT_VALIDATION_ERROR
MODEL_NOT_AVAILABLE
NO_ELIGIBLE_ACCOUNT
UPSTREAM_AUTH_ERROR
UPSTREAM_RATE_LIMIT
UPSTREAM_TIMEOUT
UPSTREAM_CONNECTION_ERROR
UPSTREAM_5XX
STREAM_INTERRUPTED
INTERNAL_ERROR
```

Only sanitized errors leave the gateway.

---

# 14. Security Boundaries

```text
Frontend
   |
   | never receives upstream secret
   v
Admin API
   |
   v
Encrypted Credential Store
   |
   v
Ollama Client
```

Rules:

- upstream credentials only decrypted server-side
- proxy secret shown once
- prompt logging disabled
- raw session ID not stored in request log
- encryption key supplied externally

---

# 15. Startup Sequence

```text
1. load configuration
2. validate data directory
3. initialize SQLite
4. run database migrations
5. initialize encryption service
6. load accounts/models/settings
7. initialize runtime state store
8. rebuild account health baseline
9. register Fastify routes
10. start server
11. mark readiness true
```

---

# 16. Shutdown Sequence

```text
1. stop accepting new requests
2. mark readiness false
3. wait for active requests up to drain timeout
4. abort remaining upstream requests
5. flush logs
6. close database
7. exit
```

---

# 17. Architectural Invariants

Implementation must preserve:

1. No account selection inside route handlers.
2. No upstream secret exposed to frontend.
3. No prompt-based session guessing.
4. No retry after streamed output begins.
5. No disabled/invalid/cooldown account selected.
6. Model support checked before dispatch.
7. Attempt count bounded.
8. Active counter cleaned in `finally`.
9. Request body logging disabled by default.
10. SQLite is sufficient for default local mode.
11. Redis/PostgreSQL remain optional, not mandatory.

---

# 18. Architecture Acceptance Criteria

The architecture is considered implemented when:

- local `npm install` is sufficient to install dependencies
- local `npm run dev` starts usable UI and API
- SQLite is created automatically
- at least two accounts can be configured
- routing core is isolated from HTTP route code
- sticky leases work in memory
- failover works
- streaming works
- admin UI and inference API run from the same project
- external Redis/PostgreSQL are not required
