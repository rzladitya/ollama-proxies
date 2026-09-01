# Ollama Proxy — Project Overview

## Apa Ini?

**Ollama Proxy** adalah self-hosted multi-account LLM gateway. Menyediakan satu endpoint **OpenAI-compatible API** (`/v1/chat/completions`, `/v1/models`) untuk downstream apps (Dify, OpenCode, LangChain, OpenAI SDK) sambil melakukan load balancing request ke **pool of Ollama Cloud accounts**.

Bukan multi-provider router — ini single-provider (Ollama Cloud) dengan multi-credential load balancing + failover.

---

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| **Runtime** | Node.js, TypeScript 5.7 |
| **Server** | Fastify 5, Pino logger |
| **Database** | SQLite (better-sqlite3, WAL mode), Drizzle ORM |
| **Frontend** | React 19, React Router 7, TanStack Query 5, Tailwind CSS 4, Vite 6 |
| **Testing** | Vitest, Playwright, MSW |
| **Monorepo** | npm workspaces |

---

## Struktur Project

```
proxy-ollama/
├── apps/
│   ├── server/          # Fastify gateway server
│   │   └── src/
│   │       ├── main.ts              # Entry point (port 11435)
│   │       ├── telemetry.ts         # Request tracing
│   │       ├── config/env.ts        # Environment config
│   │       ├── middleware/
│   │       │   ├── admin-auth.ts    # Admin API auth
│   │       │   └── proxy-key-auth.ts # Proxy key auth
│   │       └── routes/
│   │           ├── v1.ts            # OpenAI-compatible proxy routes
│   │           ├── errors.ts        # Error envelope builder
│   │           ├── request-id.ts    # Request ID generator
│   │           ├── validation.ts    # Zod request validation
│   │           └── admin/           # Admin CRUD endpoints
│   └── web/             # React SPA admin dashboard
│       └── src/
│           ├── App.tsx
│           ├── api/                 # API client + React Query hooks
│           ├── components/          # Layout & UI components
│           └── pages/               # Dashboard pages
├── packages/
│   ├── shared/           # Types, encryption, key generation, redaction
│   ├── storage/          # SQLite schema, migrations, bootstrap
│   ├── routing-core/     # In-memory routing: leases, cooldown, selection
│   ├── ollama-client/    # HTTP client for Ollama Cloud API
│   └── ui/               # Placeholder
├── tests/                # Unit + E2E tests
├── data/                 # SQLite database files
└── docs/                 # Design & spec documents
```

---

## Fitur Utama

### 1. OpenAI-Compatible Proxy API
- `POST /v1/chat/completions` — chat completion dengan streaming SSE support
- `GET /v1/models` — list available models (filtered per key)
- Autentikasi via `Bearer sk-proxy-...` token

### 2. Multi-Account Load Balancing
- Pool beberapa Ollama Cloud account
- Routing: **Sticky Lease → Eligible Filter → Least Load → Weighted Selection → Failover**
- Automatic failover ke account lain saat failure (max 3 attempts default)
- Sticky session support via `X-Proxy-Session-ID` atau `request.user`

### 3. Account Health Management
- State machine: `ACTIVE → DEGRADED → COOLDOWN → INVALID`
- Auto-recovery saat upstream kembali sehat
- Background health check setiap 60 detik
- Cooldown otomatis saat rate limit (429)

### 4. API Key Management
- Generate proxy keys (`sk-proxy-<64 hex>`)
- Key disimpan sebagai SHA-256 hash (secret hanya tampil sekali)
- Per-key: pool binding, rate limit, concurrency limit, model allowlist

### 5. Model Management
- Auto-sync model catalog dari upstream saat account ditambahkan
- Public model ID ↔ upstream model ID mapping
- Tier-based filtering (free tier: 6 model spesifik, pro: semua)
- Per-model enable/disable toggle
- 1-click model inference test

### 6. Admin Dashboard (React SPA)
- Overview, Accounts, API Keys, Models, Requests, Quota, Routing, Settings
- Dark theme, terminal-style design
- Real-time topology visualization

### 7. Request Logging & Analytics
- Full telemetry per request: model, account, latency, TTFB, token count, error
- Analytics: timeline, model breakdown, cost estimates
- Quota tracking: 5h session + 7d weekly windows
- Auto-cleanup: max 1000 rows + 7-day retention

### 8. Streaming Safety
- `firstOutputCommitted` flag — setelah SSE data terkirim ke client, tidak bisa retry
- Client disconnect detection via AbortController
- Pre-output failure → retry, post-output failure → terminate stream

### 9. Graceful Shutdown
- SIGINT/SIGTERM → stop new requests (503), drain active connections, close DB

---

## Mekanisme Handle Request

### Flow: Proxy Request (`/v1/chat/completions`)

```
Client Request (Bearer sk-proxy-xxx)
       │
       ▼
┌─────────────────────────┐
│ 1. Proxy Key Auth       │  Cek SHA-256(key) di DB, load pool/limits/allowedModels
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 2. Request ID           │  Pakai X-Request-ID header atau generate req_<ts>_<rand>
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 3. Validation (Zod)     │  Validate body: model, messages, temperature, dll
└───────────┬─────────────┘  (.passthrough() untuk vendor extensions)
            │
            ▼
┌─────────────────────────┐
│ 4. Model Resolution     │  publicModelId → upstreamModelId + cek allowlist
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 5. Routing Key          │  X-Proxy-Session-ID > request.user > null
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 6. Sticky Lease Check   │  Cek in-memory LeaseStore untuk account affinity
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 7. Account Selection    │
│   - Filter eligible     │  Pool membership + model + enabled + state
│   - Remove cooldown     │  Exclude attempted/disabled/invalid
│   - Priority grouping   │  Highest priority group first
│   - Least load          │  active_requests / normalized_weight
│   - Weighted random     │  Tie-break
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 8. Attempt Runner       │  Max 3 attempts, each on different account:
│   - Decrypt API key     │    AES-256-GCM
│   - Call Ollama Cloud   │    Via OllamaClient
│   - Success → done      │    Record health recovery, migrate lease
│   - Failure → classify  │    Record degradation, retry if retryable
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 9. Response             │  SSE stream atau JSON response
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 10. Telemetry Log       │  request_logs: model, account path, latency,
│                         │  TTFB, tokens, error category
└─────────────────────────┘
```

### Flow: Admin Request (`/api/admin/*`)

```
Admin Request (Bearer <admin-secret> atau X-Admin-Secret header)
       │
       ▼
┌─────────────────────────┐
│ Admin Auth Middleware    │  Match terhadap OLLAMA_PROXY_ADMIN_SECRET
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Route Handler           │  CRUD operations via Drizzle ORM
│ (accounts/pools/keys/   │  Response: stripEncryptedKey() removes secrets
│  models/requests/etc)   │
└─────────────────────────┘
```

---

## API Endpoints

### Proxy API (`/v1/*`) — Auth: `Bearer sk-proxy-...`

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET` | `/v1/models` | List available models (filtered per key) |
| `POST` | `/v1/chat/completions` | Chat completion + streaming |

### Admin API (`/api/admin/*`) — Auth: Admin Secret

| Method | Path | Deskripsi |
|--------|------|-----------|
| `POST` | `/api/admin/auth/login` | Verify admin password |
| **Accounts** | | |
| `GET` | `/api/admin/accounts` | List upstream accounts |
| `POST` | `/api/admin/accounts` | Create account (auto-sync models) |
| `GET` | `/api/admin/accounts/:id` | Get account detail |
| `PATCH` | `/api/admin/accounts/:id` | Update account |
| `DELETE` | `/api/admin/accounts/:id` | Delete account + cascade cleanup |
| `POST` | `/api/admin/accounts/test-key` | Test API key before saving |
| `POST` | `/api/admin/accounts/:id/test` | Test existing account |
| `POST` | `/api/admin/accounts/:id/enable` | Enable account |
| `POST` | `/api/admin/accounts/:id/disable` | Disable account |
| `POST` | `/api/admin/accounts/:id/refresh-models` | Re-sync models |
| **Pools** | | |
| `GET` | `/api/admin/pools` | List pools |
| `POST` | `/api/admin/pools` | Create pool |
| `PATCH` | `/api/admin/pools/:id` | Update pool |
| `DELETE` | `/api/admin/pools/:id` | Delete pool |
| `GET` | `/api/admin/pools/:id/members` | List pool members |
| `POST` | `/api/admin/pools/:id/members` | Add pool member |
| **API Keys** | | |
| `GET` | `/api/admin/api-keys` | List proxy API keys |
| `POST` | `/api/admin/api-keys` | Generate key (secret shown once) |
| `PATCH` | `/api/admin/api-keys/:id` | Update key settings |
| `DELETE` | `/api/admin/api-keys/:id` | Delete key |
| `POST` | `/api/admin/api-keys/:id/revoke` | Revoke key |
| **Models** | | |
| `GET` | `/api/admin/models` | List all models |
| `PATCH` | `/api/admin/models/:id` | Toggle model enabled |
| `DELETE` | `/api/admin/models/:id` | Delete model |
| `POST` | `/api/admin/models/:id/test` | Test model inference |
| **Observability** | | |
| `GET` | `/api/admin/requests` | List request logs |
| `GET` | `/api/admin/requests/:id` | Get request detail |
| `DELETE` | `/api/admin/requests` | Clear all logs |
| `GET` | `/api/admin/analytics` | Usage analytics + timeline |
| `GET` | `/api/admin/quota` | Per-account quota tracking |
| **Config** | | |
| `GET` | `/api/admin/routing` | Get routing config |
| `PUT` | `/api/admin/routing` | Update routing config |
| `GET` | `/api/admin/settings` | Get all settings |
| `PUT` | `/api/admin/settings` | Update settings |

### Health Checks

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe (tests DB) |

---

## Database Schema (SQLite)

| Tabel | Deskripsi |
|-------|-----------|
| `upstream_accounts` | Akun Ollama Cloud (API key encrypted AES-256-GCM), state machine, priority/weight, tier |
| `account_pools` | Named groups of accounts |
| `account_pool_members` | Many-to-many pool ↔ account |
| `models` | Public model ID ↔ upstream model ID mapping |
| `account_models` | Account ↔ model availability |
| `proxy_api_keys` | Client-facing keys (hash, prefix, pool binding, rate/concurrency limits) |
| `proxy_key_models` | Per-key model allowlist |
| `request_logs` | Telemetry log (18 columns) |
| `settings` | Key-value config store |

---

## Security

| Aspek | Implementasi |
|-------|-------------|
| **API Key Encryption** | AES-256-GCM, random IV, key dari SHA-256(`OLLAMA_PROXY_ENCRYPTION_KEY`) |
| **Proxy Key Storage** | SHA-256 hash only, secret ditampilkan sekali saat creation |
| **Admin Auth** | Bearer token / `X-Admin-Secret` header |
| **Log Redaction** | `redact()` + `redactObject()` strip secrets dari logs |
| **Response Sanitization** | `stripEncryptedKey()` hapus encrypted key dari API responses |

---

## Error Handling

Format response error: OpenAI-compatible envelope `{ error: { message, type, code } }`

| Kategori | HTTP | Retryable |
|----------|------|-----------|
| `CLIENT_AUTH_ERROR` | 401 | Tidak |
| `CLIENT_VALIDATION_ERROR` | 400 | Tidak |
| `MODEL_NOT_AVAILABLE` | 404 | Ya |
| `NO_ELIGIBLE_ACCOUNT` | 503 | — |
| `UPSTREAM_AUTH_ERROR` | 502 | Ya (beda account) |
| `UPSTREAM_RATE_LIMIT` | 429 | Ya |
| `UPSTREAM_TIMEOUT` | 504 | Ya |
| `UPSTREAM_CONNECTION_ERROR` | 502 | Ya |
| `UPSTREAM_5XX` | 502 | Ya |
| `STREAM_INTERRUPTED` | 502 | — |
| `INTERNAL_ERROR` | 500 | Tidak |

---

## Environment Variables

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `OLLAMA_PROXY_HOST` | `127.0.0.1` | Bind address |
| `OLLAMA_PROXY_PORT` | `11435` | Listen port |
| `OLLAMA_PROXY_DATA_DIR` | `./data` | Lokasi SQLite DB |
| `OLLAMA_PROXY_ENCRYPTION_KEY` | dev fallback | AES-256 key seed |
| `OLLAMA_PROXY_ADMIN_SECRET` | `"ollama"` | Admin API auth token |
| `OLLAMA_PROXY_LOG_LEVEL` | `info` | Pino log level |
| `OLLAMA_PROXY_REQUEST_TIMEOUT_SECONDS` | `120` | Upstream timeout |
| `OLLAMA_PROXY_MAX_ATTEMPTS` | `3` | Max failover attempts |

---

## Background Jobs

| Job | Interval | Deskripsi |
|-----|----------|-----------|
| Log retention cleanup | 60 detik | Max 1000 rows + 7-day cutoff |
| Account health check | 60 detik | Ping upstream `listModels` per account |

---

## Cara Menjalankan

```bash
# Install dependencies
npm install

# Development (server + web concurrent)
npm run dev

# Build
npm run build

# Production
npm start
```

Server berjalan di `http://127.0.0.1:11435`. Admin dashboard di-serve sebagai SPA fallback dari root path.
