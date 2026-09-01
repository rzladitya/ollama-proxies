# Ollama Proxy — Local Installation & Deployment Guide V1

**Document:** Installation, Development, Build, and Local Deployment  
**Product:** Ollama Proxy  
**Version:** 1.0  
**Installation model:** Local repository only

---

# 1. Installation Policy

Ollama Proxy V1 is not designed around global npm installation.

Primary workflow:

```bash
git clone <repository>
cd ollama-proxy
npm install
npm run dev
```

Production-style local workflow:

```bash
npm install
npm run build
npm start
```

Do not require:

```text
npm install -g ...
npx ...
global CLI
Docker
Redis
PostgreSQL
```

for normal use.

---

# 2. Prerequisites

Required:

```text
Node.js 22+
npm
Git
```

Recommended:

```text
modern Chromium/Firefox browser
```

Optional future integrations:

```text
Redis
PostgreSQL
Docker
```

They are not required in standalone mode.

---

# 3. Clone Repository

```bash
git clone <repository-url>
cd ollama-proxy
```

---

# 4. Install Dependencies

```bash
npm install
```

Expected:

- root workspace dependencies installed
- backend dependencies installed
- frontend dependencies installed
- no global package required

If using npm workspaces, root `npm install` must be sufficient.

---

# 5. Environment Setup

Copy:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Minimum local configuration example:

```env
OLLAMA_PROXY_HOST=127.0.0.1
OLLAMA_PROXY_PORT=11435

OLLAMA_PROXY_DATA_DIR=./data

OLLAMA_PROXY_ENCRYPTION_KEY=<generate-a-long-random-secret>
OLLAMA_PROXY_ADMIN_SECRET=<choose-local-admin-secret>

OLLAMA_PROXY_LOG_LEVEL=info
OLLAMA_PROXY_REQUEST_TIMEOUT_SECONDS=120
OLLAMA_PROXY_MAX_ATTEMPTS=3
```

Never commit `.env`.

---

# 6. Local Data Directory

Default:

```text
./data
```

Expected:

```text
data/
├── ollama-proxy.db
└── optional runtime files
```

This directory should normally be ignored by Git except placeholder files.

---

# 7. Start Development Mode

```bash
npm run dev
```

Expected user-facing endpoints:

```text
Admin UI:
http://localhost:11435/admin

OpenAI-Compatible API:
http://localhost:11435/v1

Health:
http://localhost:11435/health/live
```

Implementation may use Vite internal development port, but documentation should present one clear workflow.

---

# 8. First Run

On first run the application should:

```text
1. create ./data if missing
2. create SQLite database
3. run migrations
4. create default routing settings
5. create default account pool
6. start backend
7. start/serve admin UI
```

The user should not manually create database tables.

---

# 9. Open Admin UI

Browser:

```text
http://localhost:11435/admin
```

Authenticate using local admin credentials/configuration.

The exact login UX is implementation-specific, but admin endpoints must not remain accidentally public.

---

# 10. Add First Ollama Account

Navigate:

```text
Accounts
-> Add Account
```

Provide:

```text
Account Name
Ollama Cloud API Key
Priority
Weight
Enabled
```

Recommended starting values:

```text
Priority: 100
Weight:   1
```

Click:

```text
Test Connection
```

Expected:

```text
Connection successful
N models detected
```

Then:

```text
Add Account
```

---

# 11. Add Multiple Accounts

Example:

```text
ollama-main-01    Active
ollama-main-02    Active
ollama-main-03    Active
ollama-backup-01  Active
```

Routing behavior:

```text
existing session
-> existing healthy account

new session
-> priority
-> least load
-> weighted tie-break

temporary failure
-> fallback
-> lease migration
```

---

# 12. Create Proxy API Key

Navigate:

```text
API Keys
-> Create API Key
```

Example:

```text
Name:
Dify Local

Allowed Models:
All or selected models

Account Pool:
Default

Concurrency Limit:
optional
```

After create:

```text
sk-proxy-xxxxxxxx
```

Copy it immediately.

The full secret should not be recoverable later.

---

# 13. Configure Dify

Use OpenAI-compatible custom endpoint configuration.

Base URL:

```text
http://localhost:11435/v1
```

API key:

```text
sk-proxy-xxxxxxxx
```

Model:

```text
select one returned by /v1/models
```

If Dify supports supplying a stable conversation/user identifier, map it to:

```text
X-Proxy-Session-ID
```

or compatible `user` field.

This improves sticky account affinity.

Exact Dify field/header capabilities should be verified against the version being used.

---

# 14. Configure OpenCode or Other Clients

Generic configuration:

```text
Base URL:
http://localhost:11435/v1

API Key:
sk-proxy-xxxxxxxx

Model:
<proxy model ID>
```

The downstream client does not need upstream Ollama credentials.

---

# 15. Test API Manually

## Models

```bash
curl http://localhost:11435/v1/models \
  -H "Authorization: Bearer sk-proxy-xxxxxxxx"
```

## Non-Streaming Chat

```bash
curl http://localhost:11435/v1/chat/completions \
  -H "Authorization: Bearer sk-proxy-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Session-ID: test-conversation-001" \
  -d '{
    "model": "qwen3.5:cloud",
    "messages": [
      {
        "role": "user",
        "content": "Hello"
      }
    ],
    "stream": false
  }'
```

## Streaming Chat

```bash
curl -N http://localhost:11435/v1/chat/completions \
  -H "Authorization: Bearer sk-proxy-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Session-ID: test-conversation-001" \
  -d '{
    "model": "qwen3.5:cloud",
    "messages": [
      {
        "role": "user",
        "content": "Hello"
      }
    ],
    "stream": true
  }'
```

Model IDs are examples and must match actual configured upstream inventory.

---

# 16. Sticky Routing Verification

Send multiple requests with same header:

```http
X-Proxy-Session-ID: test-conversation-001
```

Expected:

```text
Request 1 -> ollama-main-02
Request 2 -> ollama-main-02
Request 3 -> ollama-main-02
```

As long as:

- lease remains valid
- account remains eligible
- model remains available

Inspect Requests page to verify account selection.

---

# 17. Stateless Routing Verification

Send request without:

```text
X-Proxy-Session-ID
```

and without stable `user`.

Expected:

```text
no lease
request is independently selected
```

This is intentional.

---

# 18. Failover Verification

Use development mock upstream or test mode.

Scenario:

```text
Account A -> 429
Account B -> 200
```

Expected:

```text
Account A enters cooldown
request succeeds through Account B
session lease moves to Account B
request log shows failover
```

Do not intentionally exhaust or abuse real upstream accounts for testing.

---

# 19. Stop Development Server

Use:

```text
Ctrl+C
```

The server should:

- stop accepting new traffic
- abort/drain active requests
- close SQLite cleanly

---

# 20. Build

```bash
npm run build
```

Expected output:

```text
backend build
frontend static build
shared packages build
```

Build must not depend on a globally installed tool.

---

# 21. Start Built Application

```bash
npm start
```

Expected:

```text
http://localhost:11435/admin
http://localhost:11435/v1
```

In built mode Fastify should serve or expose the compiled admin frontend through the same application deployment.

---

# 22. Local Production-Like Setup

Example `.env`:

```env
OLLAMA_PROXY_HOST=0.0.0.0
OLLAMA_PROXY_PORT=11435
OLLAMA_PROXY_DATA_DIR=./data
OLLAMA_PROXY_ENCRYPTION_KEY=<strong-random-secret>
OLLAMA_PROXY_ADMIN_SECRET=<strong-admin-secret>
OLLAMA_PROXY_LOG_LEVEL=info
```

Run:

```bash
npm install
npm run build
npm start
```

If exposing outside the machine:

- place behind TLS/reverse proxy
- secure admin access
- restrict firewall
- use a strong encryption key
- protect local database backup

---

# 23. Local Network Access

To allow another machine on trusted LAN:

```env
OLLAMA_PROXY_HOST=0.0.0.0
```

Then:

```text
http://<host-ip>:11435/v1
```

Security warning:

Binding to `0.0.0.0` exposes the service to reachable network interfaces.

Do not do this on an untrusted network without proper firewall/TLS/access controls.

---

# 24. Database Backup

Default SQLite:

```text
./data/ollama-proxy.db
```

Backup while application is stopped, or use SQLite-safe backup mechanics.

Minimum backup set:

```text
ollama-proxy.db
.env or secret-management equivalent
```

Do not store the encryption key only inside the database it encrypts.

---

# 25. Reset Local Environment

Development-only reset:

```text
stop application
backup if needed
remove ./data/ollama-proxy.db
restart application
```

This deletes:

- accounts
- proxy API key metadata
- model mappings
- request logs
- settings

Do not expose one-click destructive reset without confirmation.

---

# 26. npm Scripts Reference

Expected:

```bash
npm run dev
npm run build
npm start
npm test
npm run test:e2e
npm run lint
npm run typecheck
npm run format
npm run db:generate
npm run db:migrate
```

---

# 27. Troubleshooting

## Port Already Used

Symptom:

```text
EADDRINUSE
```

Change:

```env
OLLAMA_PROXY_PORT=11436
```

---

## Database Cannot Open

Check:

```text
data directory exists
process has write permission
DB file is not locked by another incompatible process
```

---

## Encryption Key Missing

Expected behavior:

Production-style start should refuse to load stored upstream credentials without correct encryption key.

Do not silently create a new key and make old credentials unreadable.

---

## No Models Returned

Check:

```text
account enabled
connection test succeeds
model refresh completed
model enabled
account not invalid
```

---

## No Eligible Account

Check:

```text
account pool membership
model availability
account state
cooldown
concurrency limit
API key allowed models
```

---

## Repeated 429

Check:

```text
upstream account status
cooldown behavior
provider plan/rate limits
request volume
```

Do not reduce cooldown or rotate accounts solely to evade upstream restrictions.

---

## Streaming Disconnect

Inspect request detail.

If output had already started:

```text
no automatic failover is expected
```

This is intentional.

---

# 28. Development Mode with Mock Upstream

Recommended for engineering:

```bash
npm run dev:mock
```

Optional script may start:

```text
Ollama Proxy
Mock Ollama Upstream
Admin UI
```

Mock scenarios:

```text
200
401
429
500
timeout
stream success
stream failure before output
stream failure after output
```

This avoids dependency on live provider behavior during automated testing.

---

# 29. Upgrade Workflow

Normal code update:

```bash
git pull
npm install
npm run build
npm start
```

Database migrations run according to implementation policy.

Before major update:

```text
backup ./data
backup environment/secrets
```

---

# 30. Uninstall

Because installation is project-local:

```text
stop application
delete repository directory
```

If retaining configuration:

```text
backup ./data first
```

No global npm package cleanup is required.

---

# 31. Default Local User Journey

```text
git clone
   |
npm install
   |
copy .env
   |
npm run dev
   |
open /admin
   |
add Ollama accounts
   |
create proxy API key
   |
configure Dify/OpenCode
   |
use http://localhost:11435/v1
```

---

# 32. Local Installation Acceptance Criteria

The installation experience is correct when a fresh machine with Node.js/npm can:

```bash
git clone ...
cd ollama-proxy
npm install
npm run dev
```

and then:

- access admin UI
- create SQLite automatically
- add accounts
- create proxy key
- call `/v1/models`
- call `/v1/chat/completions`

without:

- global npm install
- Redis
- PostgreSQL
- Docker
