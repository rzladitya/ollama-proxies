# Ollama Proxy — Product & Technical PRD V1

**Document:** Product & Technical Requirements Document  
**Product:** Ollama Proxy  
**Version:** 1.0  
**Status:** Draft for implementation  
**Primary audience:** Product owner, backend engineer, frontend engineer, platform engineer, QA  
**Product type:** Self-hosted multi-account Ollama Cloud gateway  
**Primary compatibility target:** OpenAI-compatible clients such as Dify, OpenCode, n8n, LangChain, OpenAI SDK-compatible applications, and custom applications

---

## 1. Executive Summary

Ollama Proxy is a lightweight, self-hosted LLM gateway that exposes a single OpenAI-compatible endpoint to downstream applications while routing requests to a managed pool of authorized Ollama Cloud accounts/API credentials.

The product is intentionally narrower than a full multi-provider router. It focuses on one provider family, predictable compatibility, transparent multi-account routing, operational visibility, sticky account affinity, automatic failover, account cooldown, model-aware routing, and virtual proxy API keys.

The core architectural principle is:

> **Sticky Lease → Eligible Account Filter → Least Load → Weighted Selection → Failover**

The gateway should preserve conversation-to-account affinity when a stable routing key is available. New conversations are distributed across healthy accounts. If the assigned upstream account becomes unavailable, rate-limited, or unhealthy, the request can fail over to another eligible account and the affinity lease is updated.

This project does **not** attempt to bypass provider restrictions, obscure account identity from the upstream provider, or implement anti-detection mechanisms. All upstream accounts must be authorized for use by the operator and must remain subject to upstream terms and limits.

---

## 2. Product Goals

### 2.1 Primary Goals

1. Provide one stable OpenAI-compatible base URL for multiple LLM-consuming applications.
2. Centralize multiple authorized Ollama Cloud credentials behind a single proxy.
3. Distribute new sessions across healthy upstream accounts.
4. Keep a conversation on the same account when a stable session identifier is available.
5. Automatically fail over when an upstream account is unavailable.
6. Track account health, cooldown, routing decisions, and request outcomes.
7. Prevent downstream clients from seeing or managing upstream API credentials.
8. Make integration simple enough that a client only needs:
   - Base URL
   - Proxy API key
   - Model name
9. Provide an admin UI for operational management.
10. Remain small enough to implement, operate, and understand without reproducing a full 9router-like platform.

### 2.2 Secondary Goals

1. Support streaming responses.
2. Support tool/function-call pass-through where upstream behavior permits.
3. Support model discovery and availability across accounts.
4. Support separate account pools for different proxy API keys.
5. Expose operational metrics useful for troubleshooting.
6. Allow future extension to additional compatible endpoints without redesigning the core router.

---

## 3. Non-Goals

V1 will not include:

- Billing or payment processing
- User subscriptions
- Organizations and tenant hierarchy
- Complex RBAC
- Multi-provider routing
- Marketplace features
- Prompt management
- Prompt playground
- Agent builder
- RAG/vector database management
- Fine-tuning management
- Semantic response caching
- Automatic model benchmarking
- Cost optimization across providers
- Kubernetes control plane
- Kafka-based event architecture
- Provider-limit evasion logic
- Anti-detection behavior
- Account acquisition or credential automation

---

## 4. Target Users

### 4.1 Platform Administrator

Responsibilities:

- Add and remove upstream accounts
- Test credentials
- Enable or disable accounts
- Observe account health
- Configure routing behavior
- Create proxy API keys
- Inspect request and failover logs

### 4.2 Application Integrator

Responsibilities:

- Configure Dify/OpenCode/n8n/custom application
- Use the proxy base URL and virtual API key
- Select exposed model IDs
- Optionally provide a stable session identifier

### 4.3 Developer / Operator

Responsibilities:

- Investigate errors
- Inspect routing decisions
- Determine which account served a request
- Review rate-limit or upstream availability problems
- Monitor request latency and failover rate

---

## 5. Product Principles

### 5.1 Compatibility First

Downstream clients should interact with the gateway as if it were a normal OpenAI-compatible endpoint.

### 5.2 Stable Session Affinity When Possible

Conversation routing should remain stable when a reliable routing key exists.

### 5.3 No Guessing of Conversation Identity

The gateway must not infer a conversation by hashing the full evolving prompt history.

Routing key precedence:

1. `X-Proxy-Session-ID`
2. OpenAI-compatible `user` field, when present and stable
3. No affinity

If no stable key exists, the request is stateless and may be routed independently.

### 5.4 Fail Closed on Credentials, Fail Over on Capacity

Invalid credentials disable an account. Temporary upstream capacity or availability failures trigger cooldown/failover.

### 5.5 Transparent Operations

Every routed request should have enough metadata to explain:

- which client sent it
- which model was requested
- which account was selected
- whether affinity was used
- whether retry/failover occurred
- final status and latency

### 5.6 Minimal Sensitive Logging

Prompt and response bodies are disabled by default.

---

## 6. Terminology

| Term | Definition |
|---|---|
| Upstream Account | An authorized Ollama Cloud API credential managed by the gateway |
| Proxy API Key | A virtual credential issued by Ollama Proxy to downstream clients |
| Account Pool | A logical set of upstream accounts eligible for a proxy API key |
| Routing Key | Stable identifier used to create session/account affinity |
| Lease | Cached mapping between routing key + model/pool context and upstream account |
| Sticky Routing | Reusing the account stored in an active lease |
| Failover | Retrying a request on a different eligible account after an upstream failure |
| Cooldown | Temporary state preventing an account from receiving new work |
| Eligible Account | Account that is enabled, healthy enough, supports the model, belongs to the required pool, and is not in cooldown |
| First Token | First streamed response bytes/tokens delivered to the downstream client |
| Model Registry | Aggregated model availability information across configured accounts |

---

## 7. High-Level Architecture

```text
Dify / OpenCode / n8n / SDK / Custom App
                    |
                    v
         OpenAI-Compatible API
                    |
                    v
        Authentication / API Key
                    |
                    v
          Request Normalizer
                    |
                    v
          Routing Key Resolver
                    |
                    v
            Lease Manager
             |       |
        lease hit   lease miss
             |       |
             v       v
        Account   Routing Engine
             \       /
              \     /
               v   v
             Upstream Client
                    |
          Ollama Cloud Accounts
                    |
                    v
               Ollama Cloud

Supporting state:
- PostgreSQL/SQLite: configuration and durable metadata
- Redis: leases, cooldown, counters, short-lived health state
- Metrics/logging backend: request telemetry
```

---

## 8. Recommended V1 Technology Boundary

The PRD does not force a specific framework, but the following architecture is recommended:

### Backend

- Python FastAPI or equivalent async HTTP framework
- Async upstream HTTP client
- Pydantic-style request/response validation
- SSE-compatible streaming transport

### Durable Storage

Preferred:
- PostgreSQL

Allowed for local/single-node MVP:
- SQLite

### Ephemeral State

- Redis

Redis is recommended for:
- sticky leases
- cooldown keys
- active request counters
- lightweight request coordination

### Admin UI

Any modern frontend stack is acceptable.

Recommended:
- React / Next.js
- TypeScript
- utility CSS + accessible component primitives

---

# 9. Functional Requirements

## FR-01 — OpenAI-Compatible Gateway

The gateway shall expose an OpenAI-compatible base path.

Minimum required endpoints:

```text
GET  /v1/models
POST /v1/chat/completions
```

Recommended V1.1 or V1 if upstream compatibility is validated:

```text
POST /v1/responses
POST /v1/embeddings
```

The proxy shall:

- accept JSON request payloads
- preserve standard OpenAI-compatible request fields
- support non-streaming responses
- support SSE streaming for `stream=true`
- forward supported tool/function-call fields
- preserve upstream model output as faithfully as practical

Unknown optional fields should not be rejected unless they create unsafe or invalid forwarding behavior.

Provider-specific compatibility details must be verified against the currently deployed Ollama Cloud API before implementation. **This needs verification.**

---

## FR-02 — Proxy API Key Authentication

All `/v1/*` inference requests shall require a proxy API key unless anonymous mode is explicitly enabled.

Expected header:

```http
Authorization: Bearer sk-proxy-...
```

Each proxy API key shall support:

- name
- hashed secret
- status
- allowed models
- assigned account pool
- optional concurrency limit
- optional RPM limit
- created timestamp
- last-used timestamp

Raw proxy key secrets shall only be shown once at creation.

Database storage shall contain only a secure hash of the proxy key.

---

## FR-03 — Upstream Account Management

An administrator shall be able to:

- add an Ollama Cloud account credential
- assign a human-readable account name
- set priority
- set routing weight
- enable/disable the account
- test connectivity
- refresh model availability
- view last success
- view last error
- view current health state
- remove the account

Credential storage shall be encrypted at rest.

Account fields:

```text
id
name
encrypted_api_key
state
enabled
priority
weight
created_at
updated_at
last_success_at
last_error_at
last_error_code
```

---

## FR-04 — Account State Machine

Supported account states:

```text
ACTIVE
DEGRADED
COOLDOWN
DISABLED
INVALID
```

Definitions:

### ACTIVE
Eligible for normal traffic.

### DEGRADED
Still usable but has recent failures or elevated latency.

### COOLDOWN
Temporarily excluded from new traffic.

### DISABLED
Administratively disabled.

### INVALID
Credential or persistent authorization failure.

Allowed transitions:

```text
ACTIVE -> DEGRADED
ACTIVE -> COOLDOWN
ACTIVE -> INVALID
ACTIVE -> DISABLED

DEGRADED -> ACTIVE
DEGRADED -> COOLDOWN
DEGRADED -> INVALID
DEGRADED -> DISABLED

COOLDOWN -> ACTIVE
COOLDOWN -> DEGRADED
COOLDOWN -> INVALID
COOLDOWN -> DISABLED

INVALID -> ACTIVE only after credential update/test
DISABLED -> ACTIVE only through admin action
```

---

## FR-05 — Model Registry

The gateway shall maintain a model registry.

For each model:

- public model ID
- upstream model ID
- account availability
- enabled/disabled state
- optional alias
- last refreshed timestamp

The public `/v1/models` response shall return the union of models that are:

- enabled
- available on at least one eligible account

The router must not select an account that does not support the requested model.

Example internal availability:

```text
qwen3.5:cloud
- acc_01: available
- acc_02: available
- acc_03: unavailable
- acc_04: available
```

---

## FR-06 — Routing Key Resolution

Routing key precedence:

### Priority 1

HTTP header:

```http
X-Proxy-Session-ID: <stable-id>
```

### Priority 2

OpenAI-compatible request field:

```json
{
  "user": "stable-user-or-conversation-id"
}
```

### Priority 3

No routing key.

If no routing key is present:

- do not create a sticky lease
- select an account for the current request only

The proxy may expose integration guidance recommending clients pass a stable conversation identifier.

---

## FR-07 — Lease Key Design

Recommended logical lease identity:

```text
hash(
  proxy_api_key_id
  + account_pool_id
  + requested_public_model
  + routing_key
)
```

Redis example:

```text
lease:{lease_hash}
```

Value:

```json
{
  "account_id": "acc_02",
  "created_at": "...",
  "last_used_at": "...",
  "model_id": "qwen3.5:cloud"
}
```

Default lease TTL:

```text
30 minutes
```

Default behavior:

- extend TTL on successful activity
- do not extend TTL on a failed attempt
- remove or replace lease after successful failover
- delete lease if stored account becomes permanently invalid

TTL shall be configurable.

---

## FR-08 — Routing Eligibility Filter

Before selecting an upstream account, the router shall filter by:

1. account enabled
2. account state not `DISABLED`
3. account state not `INVALID`
4. cooldown expired
5. requested model available
6. account belongs to required pool
7. account not explicitly excluded by model routing rules
8. concurrency below configured hard limit, if used

If an existing lease points to an ineligible account, the router shall ignore that lease and select another account.

---

## FR-09 — Routing Selection Algorithm

Selection order:

### Step 1 — Existing Lease

If a valid lease exists and the account remains eligible:

```text
reuse leased account
```

### Step 2 — Least Load Group

For new sessions/stateless requests:

- inspect `active_requests`
- identify accounts with the lowest load band

Recommended V1 selection:

```text
candidate_score = active_requests / effective_weight
```

Lower score is preferred.

### Step 3 — Weighted Tie-Break

Among similar candidates, use weighted selection.

Priority may be applied before weight:

```text
highest routing priority group
-> lowest effective load
-> weighted tie-break
```

The exact scoring implementation must be deterministic enough to test.

---

## FR-10 — Active Request Counting

The proxy shall increment account active-request count immediately before upstream dispatch.

It shall decrement the count when:

- non-streaming request completes
- streaming response closes
- timeout occurs
- upstream connection fails
- client disconnects

Counters should use atomic Redis operations when Redis is deployed.

Counter leakage must be mitigated using expiry/reconciliation.

---

## FR-11 — Automatic Failover

Failover shall be available for transient upstream failures.

Default failover triggers:

- HTTP 429
- upstream timeout
- connection error
- selected 5xx responses

Default non-failover cases:

- malformed downstream request
- unsupported model from the proxy perspective
- downstream authentication failure
- deterministic 4xx validation failure
- content or policy rejection where another account would not reasonably change the result

Maximum upstream attempts default:

```text
3 total attempts
```

This means:
- initial attempt
- up to 2 fallback accounts

The router shall not repeatedly try the same account during one request.

---

## FR-12 — Streaming Failover Rule

Streaming requires stricter semantics.

### Before first downstream token/bytes

Failover is allowed.

### After first downstream token/bytes

Failover is prohibited.

Reason:

Replaying the request on a second model/account can produce a different continuation and corrupt the client response.

Required behavior after first-token failure:

- terminate the stream
- record upstream failure
- update account health
- optionally invalidate the current lease if failure is account-related
- return/close according to the streaming protocol
- use another account only on the next request

---

## FR-13 — Cooldown Behavior

Temporary account failures shall produce cooldown.

Recommended defaults:

| Event | Default Action |
|---|---|
| 429 | Cooldown account |
| Timeout | Add failure score; cooldown after threshold |
| Connection error | Add failure score; cooldown after threshold |
| 5xx | Add failure score; temporary cooldown after threshold |
| 401 | Mark INVALID |
| Persistent 403 authorization | Mark INVALID or DISABLED |
| Admin disable | DISABLED |

Default 429 cooldown:

```text
5 minutes
```

However, if upstream provides a trustworthy retry-after signal, the gateway should prefer that value.

Specific Ollama Cloud rate-limit headers and semantics must be confirmed against current upstream behavior. **This needs verification.**

---

## FR-14 — Health Scoring

V1 may use simple stateful health rather than a complex score.

Recommended rolling signals:

- consecutive failures
- 429 count
- timeout count
- 5xx count
- recent success
- moving average latency

Example policy:

```text
1 transient failure -> remain ACTIVE
2-3 recent failures -> DEGRADED
threshold reached -> COOLDOWN
successful traffic after cooldown -> ACTIVE
```

Exact thresholds shall be configurable.

---

## FR-15 — Account Pools

Administrator shall be able to define logical account pools.

Examples:

```text
production
development
backup
all
```

Each proxy API key is assigned to one account pool.

A request may only route to accounts in that pool.

V1 does not require nested pools.

---

## FR-16 — Model Routing Rules

An administrator shall be able to:

- enable/disable a model globally
- exclude an account from a model
- optionally set model-specific priority

V1 should avoid complex per-model routing DSL.

---

## FR-17 — Request Logging

Every request shall create operational metadata.

Minimum fields:

```text
request_id
timestamp
proxy_api_key_id
client_name
public_model
routing_key_hash nullable
lease_hit boolean
initial_account_id
final_account_id
attempt_count
failover_count
stream boolean
status_code
latency_ms
time_to_first_byte_ms nullable
input_tokens nullable
output_tokens nullable
error_category nullable
error_code nullable
```

Default:

- do not log prompt body
- do not log response body
- do not log raw upstream credentials
- do not log raw proxy API key

Session/routing identifiers should be hashed in logs.

---

## FR-18 — Request Detail Timeline

Admin UI request details shall display routing chronology.

Example:

```text
10:31:22.102 Request received
10:31:22.104 Proxy key authenticated
10:31:22.105 Routing key resolved
10:31:22.106 Lease hit -> acc_03
10:31:22.450 Upstream returned 429
10:31:22.452 acc_03 entered cooldown
10:31:22.453 Fallback selection -> acc_01
10:31:25.912 Upstream success
10:31:25.914 Lease updated -> acc_01
10:31:25.915 Request completed
```

---

## FR-19 — Admin Overview

The dashboard shall expose:

- active accounts / total accounts
- accounts in cooldown
- requests today
- success rate
- average latency
- active sessions/leases
- failover count
- request traffic time series
- account traffic distribution
- recent failovers
- account health table

---

## FR-20 — Admin Account Page

Account listing shall include:

- account name
- health state
- model count
- active request count
- recent request count
- error rate
- last used
- actions

Account detail shall include:

- health
- credential masked
- priority
- weight
- model availability
- recent errors
- request history
- latency trend
- failover count
- 429 count

---

## FR-21 — Admin API Key Page

Administrator shall be able to:

- create key
- revoke key
- disable/enable key
- set allowed models
- select account pool
- set optional request limits
- inspect usage
- copy base URL
- copy secret only at creation time

---

## FR-22 — Routing Configuration Page

Settings shall include:

### Session Affinity
- enabled
- lease TTL
- extend TTL on activity
- routing header name

### Selection
- least-load enabled
- weighted routing enabled
- account priority

### Failover
- enabled
- max attempts
- failover status classes

### Cooldown
- default 429 cooldown
- transient failure threshold
- repeated error cooldown

### Streaming
- informational rule describing no failover after first token

---

# 10. API Contract

## 10.1 Common Request Headers

```http
Authorization: Bearer sk-proxy-...
Content-Type: application/json
X-Proxy-Session-ID: optional-stable-session-id
X-Request-ID: optional-client-request-id
```

The proxy shall generate its own request ID if none is supplied.

---

## 10.2 `GET /v1/models`

Purpose:

Return proxy-visible models, not raw account inventory.

Response should remain OpenAI-compatible enough for client discovery.

---

## 10.3 `POST /v1/chat/completions`

Minimum supported fields:

```json
{
  "model": "qwen3.5:cloud",
  "messages": [],
  "temperature": 0.7,
  "stream": false,
  "user": "optional-stable-id"
}
```

Optional fields should be forwarded where supported.

The proxy shall not silently rewrite user prompts.

---

## 10.4 Proxy Error Envelope

Where OpenAI-compatible error format is expected:

```json
{
  "error": {
    "message": "No eligible upstream account is currently available for model qwen3.5:cloud.",
    "type": "upstream_unavailable",
    "code": "NO_ELIGIBLE_ACCOUNT"
  }
}
```

Internal details such as account secrets must never be returned.

---

# 11. Router Pseudocode

```python
async def route(request, proxy_key):
    model = resolve_model(request.model)
    routing_key = resolve_routing_key(request)

    candidates = eligible_accounts(
        pool=proxy_key.account_pool,
        model=model,
    )

    if not candidates:
        raise NoEligibleAccount()

    leased_account = None

    if routing_key:
        leased_account = lease_manager.get(
            proxy_key_id=proxy_key.id,
            pool_id=proxy_key.account_pool,
            model=model.public_id,
            routing_key=routing_key,
        )

    ordered_accounts = build_attempt_order(
        leased_account=leased_account,
        candidates=candidates,
    )

    attempts = 0
    first_token_sent = False

    for account in ordered_accounts:
        if attempts >= MAX_ATTEMPTS:
            break

        attempts += 1

        try:
            increment_active(account)

            response = await upstream.request(
                account=account,
                request=request,
                on_first_token=lambda: mark_first_token(),
            )

            if routing_key:
                lease_manager.set_or_refresh(
                    routing_key=routing_key,
                    account=account,
                )

            record_success(account, response)
            return response

        except RetryableUpstreamError as exc:
            record_failure(account, exc)
            apply_health_policy(account, exc)

            if first_token_sent:
                raise StreamInterrupted()

            continue

        finally:
            decrement_active(account)

    raise UpstreamUnavailable()
```

---

# 12. Error Handling Matrix

| Condition | Client Result | Account Effect | Failover |
|---|---|---|---|
| Proxy key invalid | 401 | None | No |
| Model disabled | 404/400 compatible error | None | No |
| No eligible account | 503 | None | No |
| Upstream 400 | Forward compatible error | None/minor | No |
| Upstream 401 | 502/503 sanitized | INVALID | Yes, before first token |
| Upstream 403 auth-related | sanitized upstream error | INVALID/DEGRADED | Yes if appropriate |
| Upstream 429 | retry/final 429 or 503 | COOLDOWN | Yes |
| Upstream timeout | retry/final 504 | DEGRADED/COOLDOWN | Yes |
| Connection error | retry/final 502 | DEGRADED/COOLDOWN | Yes |
| Upstream 5xx | retry/final 502/503 | health penalty | Yes |
| Stream breaks after first token | terminate stream | health penalty | No |

Exact mapping should be verified against target client expectations.

---

# 13. Data Model

## 13.1 `upstream_accounts`

```text
id UUID
name VARCHAR
encrypted_api_key TEXT
enabled BOOLEAN
state VARCHAR
priority INT
weight DECIMAL
last_success_at TIMESTAMP
last_error_at TIMESTAMP
last_error_code VARCHAR
created_at TIMESTAMP
updated_at TIMESTAMP
```

## 13.2 `account_pools`

```text
id UUID
name VARCHAR
description TEXT
created_at TIMESTAMP
updated_at TIMESTAMP
```

## 13.3 `account_pool_members`

```text
pool_id UUID
account_id UUID
enabled BOOLEAN
```

## 13.4 `proxy_api_keys`

```text
id UUID
name VARCHAR
key_prefix VARCHAR
secret_hash TEXT
enabled BOOLEAN
pool_id UUID
rpm_limit INT nullable
concurrency_limit INT nullable
created_at TIMESTAMP
last_used_at TIMESTAMP
revoked_at TIMESTAMP nullable
```

## 13.5 `proxy_key_models`

```text
proxy_key_id UUID
public_model_id VARCHAR
allowed BOOLEAN
```

## 13.6 `models`

```text
id UUID
public_model_id VARCHAR
upstream_model_id VARCHAR
enabled BOOLEAN
created_at TIMESTAMP
updated_at TIMESTAMP
```

## 13.7 `account_models`

```text
account_id UUID
model_id UUID
available BOOLEAN
excluded BOOLEAN
last_checked_at TIMESTAMP
```

## 13.8 `request_logs`

For V1 operational history.

```text
request_id UUID
timestamp TIMESTAMP
proxy_api_key_id UUID
public_model_id VARCHAR
routing_key_hash VARCHAR nullable
lease_hit BOOLEAN
initial_account_id UUID nullable
final_account_id UUID nullable
attempt_count INT
failover_count INT
stream BOOLEAN
status_code INT
latency_ms INT
ttfb_ms INT nullable
input_tokens INT nullable
output_tokens INT nullable
error_category VARCHAR nullable
error_code VARCHAR nullable
```

High-volume deployments may move this data to an observability backend later.

---

# 14. Redis Design

## 14.1 Lease

```text
lease:{hash}
```

TTL:
30 minutes default

## 14.2 Cooldown

```text
cooldown:{account_id}
```

Value:
reason metadata

TTL:
cooldown duration

## 14.3 Active Requests

```text
active:{account_id}
```

Atomic integer.

## 14.4 Recent Failure Counter

```text
failures:{account_id}:{window}
```

Short TTL.

## 14.5 Optional Proxy Key Limits

```text
rpm:{proxy_key_id}:{minute_bucket}
concurrency:{proxy_key_id}
```

---

# 15. Security Requirements

## SEC-01 — Upstream Secrets

- Encrypt at rest.
- Never expose to frontend after creation.
- Never place in normal logs.
- Never return in API errors.

## SEC-02 — Proxy Keys

- Store hashed.
- Show full secret only once.
- Allow revoke/disable.
- Display only prefix/suffix later.

## SEC-03 — Admin Authentication

V1 must still require protected admin access.

Implementation may start with:
- local admin credential
- reverse-proxy SSO
- existing internal authentication

Complex organization-level RBAC is out of scope.

## SEC-04 — Logging Privacy

Default:

```text
Prompt logging: OFF
Response body logging: OFF
Request metadata logging: ON
```

## SEC-05 — TLS

Production deployment should terminate TLS before inference/admin endpoints.

## SEC-06 — Authorized Account Usage

The product shall assume configured upstream credentials are legitimately controlled and authorized by the operator.

No feature shall be designed specifically to conceal or circumvent upstream account restrictions.

---

# 16. Observability

## 16.1 Metrics

Recommended counters/gauges:

```text
proxy_requests_total
proxy_requests_inflight
proxy_request_latency_ms
proxy_ttfb_ms
proxy_failovers_total
proxy_upstream_errors_total
proxy_429_total
proxy_account_active_requests
proxy_account_state
proxy_active_leases
proxy_model_requests_total
```

Dimensions:

```text
model
account_id
proxy_key_id or client label
status class
stream
```

Avoid high-cardinality raw session IDs.

## 16.2 Logs

Structured JSON recommended.

Key fields:

```text
request_id
client
model
account
attempt
lease_hit
failover
status
latency
error_category
```

## 16.3 Health Endpoints

Recommended:

```text
GET /health/live
GET /health/ready
GET /health/upstreams
```

`/health/upstreams` should be admin-protected if it reveals account metadata.

---

# 17. Non-Functional Requirements

## NFR-01 — Latency Overhead

Proxy routing overhead excluding upstream latency should remain low.

Target:

```text
p95 internal routing overhead < 50 ms
```

for normal single-node deployments.

This is a design target, not a guaranteed SLA.

## NFR-02 — Concurrency

The proxy must use non-blocking I/O for upstream streaming.

## NFR-03 — Availability

A failure of one upstream account must not make the entire proxy unavailable when other eligible accounts remain healthy.

## NFR-04 — Stateless API Nodes

If Redis and durable configuration are externalized, API nodes should be horizontally scalable.

V1 does not require multi-node deployment but should avoid architectural blockers.

## NFR-05 — Graceful Shutdown

The gateway should:
- stop accepting new requests
- allow active non-streaming/streaming work to drain up to a timeout
- avoid leaving active counters permanently incorrect

## NFR-06 — Configuration

Routing defaults should be configurable without code changes.

---

# 18. Default Configuration

Recommended initial defaults:

```yaml
gateway:
  request_timeout_seconds: 120
  max_attempts: 3

routing:
  sticky_enabled: true
  lease_ttl_minutes: 30
  extend_lease_on_success: true
  least_load_enabled: true
  weighted_tiebreak_enabled: true

cooldown:
  rate_limit_seconds: 300
  repeated_error_seconds: 120
  transient_failure_threshold: 3

logging:
  metadata: true
  prompt_body: false
  response_body: false
  retention_days: 7

streaming:
  failover_before_first_token: true
  failover_after_first_token: false
```

These are product defaults, not claims about Ollama Cloud limits.

---

# 19. Admin UI Information Architecture

```text
Overview
Accounts
  -> Account Detail
Models
  -> Model Detail
API Keys
  -> API Key Detail/Create
Requests
  -> Request Detail Drawer
Routing
Settings
System Status
```

---

# 20. Core User Flows

## Flow A — Add Account

```text
Accounts
-> Add Account
-> Enter name + API key
-> Test Connection
-> Fetch model inventory
-> Success
-> Enable Account
-> Account becomes ACTIVE
```

## Flow B — Create Dify Proxy Key

```text
API Keys
-> Create
-> Name: Dify Production
-> Select production pool
-> Select allowed models
-> Set concurrency
-> Create
-> Show secret once
-> Show Base URL + configuration example
```

## Flow C — Sticky Conversation

```text
Dify request
-> proxy key auth
-> session ID detected
-> no lease
-> select acc_02
-> upstream success
-> lease session -> acc_02

next request
-> lease hit
-> acc_02
```

## Flow D — Failover

```text
session lease -> acc_02
-> upstream 429
-> acc_02 cooldown
-> select acc_04
-> success
-> lease updated to acc_04
```

## Flow E — Stateless Request

```text
no header
no user field
-> no lease
-> least-load selection
-> request completed
-> no affinity stored
```

---

# 21. Acceptance Criteria

## AC-01 — Basic Compatibility

Given a valid proxy API key and enabled model, an OpenAI-compatible client can successfully call `/v1/chat/completions`.

## AC-02 — Model Listing

`GET /v1/models` only returns enabled models available on at least one eligible account.

## AC-03 — Sticky Routing

Given a stable `X-Proxy-Session-ID`, consecutive successful requests use the same account while the lease is valid and account remains eligible.

## AC-04 — Stateless Routing

Without a stable routing key, no sticky lease is created.

## AC-05 — Rate-Limit Failover

When selected account returns retryable 429 before first token:
- account enters cooldown
- another eligible account is selected
- request is retried up to max attempts

## AC-06 — Lease Migration

After successful failover, the session lease points to the successful fallback account.

## AC-07 — Invalid Credential

Upstream authorization failure marks the account invalid and excludes it from future routing.

## AC-08 — Streaming Safety

After streaming output begins, the same request is never replayed to another account.

## AC-09 — Pool Isolation

A proxy API key cannot route to accounts outside its assigned pool.

## AC-10 — Model Isolation

An account without the requested model is never selected.

## AC-11 — Secret Safety

Raw upstream API keys and proxy key secrets never appear in normal request logs.

## AC-12 — Observability

Every completed request records:
- request ID
- model
- initial/final account
- attempt count
- status
- latency
- failover count

---

# 22. Test Matrix

## Routing

- lease hit
- lease miss
- expired lease
- leased account disabled
- leased account cooldown
- new session least-load selection
- weighted tie-break
- no eligible accounts

## Upstream Errors

- 400
- 401
- 403
- 404 model
- 429
- 500
- 502
- timeout
- DNS/connection failure

## Streaming

- normal stream
- failure before first token
- failure after first token
- client disconnect
- timeout during stream

## Security

- invalid proxy key
- revoked proxy key
- forbidden model
- pool isolation
- masked secrets
- log redaction

## Concurrency

- active counter increment/decrement
- abrupt disconnect
- timeout cleanup
- concurrent requests to multiple accounts

---

# 23. Delivery Phases

## Phase 1 — Core Gateway

- account config
- proxy authentication
- `/v1/models`
- `/v1/chat/completions`
- non-streaming
- basic routing
- request logs

## Phase 2 — Routing Reliability

- Redis leases
- sticky routing
- active-request counters
- failover
- cooldown
- health state

## Phase 3 — Streaming + Admin UI

- SSE streaming
- streaming-safe failover behavior
- overview
- accounts
- requests
- routing configuration

## Phase 4 — Integration Hardening

- Dify validation
- OpenCode validation
- n8n/OpenAI SDK validation
- tool call compatibility
- `/v1/responses` where required
- embeddings where required

## Phase 5 — Operational Hardening

- metrics
- retention
- health endpoints
- deployment packaging
- backup/config export
- integration tests
- load tests

---

# 24. Implementation Decisions Frozen for V1

The following decisions should not be reinterpreted by implementation unless the PRD is changed:

1. The product is Ollama-focused, not multi-provider.
2. Downstream interface is OpenAI-compatible.
3. Sticky routing requires a stable client-provided identifier.
4. Full-prompt fingerprinting is not used as conversation identity.
5. Existing healthy lease wins before load balancing.
6. New sessions use least-load with weighted tie-break.
7. 429/timeout/connectivity/selected 5xx are retryable.
8. Invalid credentials disable the account from routing.
9. Failover is prohibited after first streamed output is delivered.
10. Prompt/response body logging is off by default.
11. Response caching is not part of V1.
12. Account pools isolate routing for proxy API keys.
13. Account/model availability is checked before routing.
14. The product contains no feature whose purpose is upstream restriction evasion.

---

# 25. External Items Requiring Verification

Before implementation is declared production-ready, verify:

1. Current Ollama Cloud OpenAI-compatibility behavior for required endpoints.
2. Exact supported request fields and tool-call behavior.
3. Streaming format and error behavior.
4. Rate-limit response codes/headers.
5. Availability and reliability of retry-after metadata.
6. Model listing semantics.
7. Usage/token metadata returned by upstream.
8. Dify custom OpenAI endpoint behavior for session/user metadata.
9. OpenCode custom endpoint behavior and supported headers.

These are integration facts that may change over time and should not be hardcoded from assumptions.

---

# 26. Definition of Done — V1

V1 is considered complete when:

- at least two authorized Ollama Cloud accounts can be configured
- at least one OpenAI-compatible client can use the gateway
- model listing works
- chat completion works in streaming and non-streaming modes
- sticky routing works with a stable session ID
- transient failure can fail over to another account
- successful failover updates the lease
- cooldown prevents immediate reselection
- request metadata is visible in the admin UI
- accounts can be added, tested, disabled, and inspected
- proxy API keys can be created/revoked
- model/account pool restrictions are enforced
- secrets do not leak into logs
- automated tests cover routing, failover, streaming boundary, and credential failures
