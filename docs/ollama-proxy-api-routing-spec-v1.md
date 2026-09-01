# Ollama Proxy — API & Routing Specification V1

**Document:** API Contract and Routing Engine Specification  
**Product:** Ollama Proxy  
**Version:** 1.0  
**Status:** Implementation Baseline

---

# 1. Purpose

This document defines the deterministic HTTP, routing, retry, failover, affinity, and account-health behavior for Ollama Proxy.

Where this document conflicts with implementation guesswork, this document wins.

Provider-specific details that depend on current Ollama Cloud behavior must be verified during integration testing.

---

# 2. Public API Surface

Required V1:

```text
GET  /v1/models
POST /v1/chat/completions
```

Optional only after compatibility validation:

```text
POST /v1/responses
POST /v1/embeddings
```

Health:

```text
GET /health/live
GET /health/ready
```

Admin:

```text
/api/admin/accounts
/api/admin/models
/api/admin/pools
/api/admin/api-keys
/api/admin/requests
/api/admin/routing
/api/admin/settings
/api/admin/status
```

---

# 3. Authentication

Inference request:

```http
Authorization: Bearer sk-proxy-xxxxxxxx
```

Optional:

```http
X-Proxy-Session-ID: conversation-123
X-Request-ID: client-generated-id
```

Rules:

- invalid proxy key -> 401
- disabled/revoked proxy key -> 401
- model not allowed for key -> 403 or OpenAI-compatible equivalent
- key's assigned account pool limits routing scope

---

# 4. Request Identity

If client supplies `X-Request-ID`:

- accept only within length/character safety limit
- still create internal trace ID if necessary

Otherwise generate:

```text
req_<sortable-random-id>
```

Request ID must be returned in response header:

```http
X-Request-ID: req_...
```

---

# 5. Routing Identity

Exact precedence:

```text
1. X-Proxy-Session-ID
2. request.user
3. none
```

No fallback prompt hash.

Example:

```http
X-Proxy-Session-ID: dify-conversation-a81f
```

creates sticky affinity.

No routing identity:

```text
stateless request
```

No sticky lease is created.

---

# 6. Lease Key

Logical input:

```text
proxyKeyId
poolId
publicModelId
routingIdentity
```

Canonical string:

```text
{proxyKeyId}:{poolId}:{publicModelId}:{routingIdentity}
```

Store only hash where appropriate.

Default TTL:

```text
1800 seconds
```

Lease refresh rule:

```text
refresh only after successful upstream completion/accepted stream start policy
```

For streaming, recommended behavior:

- create/refresh lease when upstream has successfully started and account is accepted
- if stream later fails, account health is penalized
- optionally invalidate lease on account-specific stream failure
- never migrate lease unless another account actually succeeds

---

# 7. Account Eligibility

Function:

```ts
isEligible(account, context): boolean
```

Account must satisfy all:

```text
enabled
pool member
supports requested model
model not excluded
state != INVALID
state != DISABLED
cooldownUntil <= now
activeRequests < hard account concurrency limit if configured
not in attemptedAccounts
```

DEGRADED accounts remain eligible unless policy says otherwise.

---

# 8. Selection Algorithm

## 8.1 Existing Lease

If affinity exists:

```text
lease = lookup()
```

If lease target is eligible:

```text
return leased account as first attempt
```

If target is not eligible:

```text
ignore lease for this attempt
```

Do not immediately delete a lease merely because an account is briefly saturated unless policy requires it.

---

## 8.2 New Selection

Algorithm:

```text
eligible accounts
   |
   v
highest priority value/group
   |
   v
calculate effective load
   |
   v
lowest load band
   |
   v
weighted tie-break
```

Baseline effective load:

```text
effectiveLoad = activeRequests / normalizedWeight
```

Where:

```text
normalizedWeight = max(weight, 0.1)
```

Recommended tie band:

Accounts are equivalent if effective load difference is insignificant.

V1 may use exact minimum to reduce complexity.

---

# 9. Priority Semantics

Higher numeric priority means preferred.

Example:

```text
acc_01 priority 100
acc_02 priority 100
acc_03 priority 50
```

Normal selection uses acc_01/acc_02 first.

acc_03 acts as lower-priority capacity/fallback.

Do not confuse priority with weight.

---

# 10. Weight Semantics

Weight affects selection among comparable accounts.

Example:

```text
acc_01 weight 2
acc_02 weight 1
```

When load is comparable, acc_01 should receive approximately more new sessions over time.

Weight must not override:

- invalid status
- cooldown
- unsupported model
- pool isolation

---

# 11. Attempt Order

Pseudo:

```ts
function buildAttemptOrder(context) {
  const attempted = new Set()

  if (validLeaseAccount) {
    yield validLeaseAccount
    attempted.add(validLeaseAccount.id)
  }

  while (attempted.size < maxAttempts) {
    const candidates = eligibleAccountsExcluding(attempted)
    if (candidates.length === 0) break

    const account = selectBest(candidates)
    yield account
    attempted.add(account.id)
  }
}
```

---

# 12. Maximum Attempts

Default:

```text
3 total upstream attempts
```

Meaning:

```text
attempt 1
attempt 2
attempt 3
```

No hidden extra retry inside the HTTP client for inference requests.

Transport library automatic retries should be disabled unless explicitly coordinated with the attempt runner.

---

# 13. Retryable Conditions

Default retry/failover:

```text
429
timeout
connection reset
DNS/connectivity error
selected upstream 5xx
upstream auth failure if another configured account may be valid
```

Non-retry:

```text
client malformed request
proxy auth failure
model forbidden by proxy key
model disabled globally
known deterministic validation failure
```

---

# 14. HTTP Classification Matrix

| Upstream / Internal Condition | Internal Category | Failover | Account State Effect |
|---|---|---:|---|
| Client proxy key invalid | CLIENT_AUTH_ERROR | No | None |
| Client JSON invalid | CLIENT_VALIDATION_ERROR | No | None |
| Model unknown | MODEL_NOT_AVAILABLE | No | None |
| No account eligible | NO_ELIGIBLE_ACCOUNT | No | None |
| Upstream 400 | CLIENT/UPSTREAM_VALIDATION | Normally No | None |
| Upstream 401 | UPSTREAM_AUTH_ERROR | Yes before stream | INVALID |
| Upstream 403 auth | UPSTREAM_AUTH_ERROR | Yes when applicable | INVALID/DEGRADED |
| Upstream 404 model | MODEL_ACCOUNT_MISMATCH | Yes | mark account-model unavailable |
| Upstream 429 | UPSTREAM_RATE_LIMIT | Yes | COOLDOWN |
| Timeout | UPSTREAM_TIMEOUT | Yes | failure count |
| Connection error | UPSTREAM_CONNECTION_ERROR | Yes | failure count |
| Upstream 5xx | UPSTREAM_5XX | Yes | failure count |
| Stream fails after output | STREAM_INTERRUPTED | No | failure count |

Actual Ollama Cloud response details require live integration verification.

---

# 15. 429 Policy

If upstream response is 429:

```text
1. mark current account cooldown
2. parse retry-after if reliable
3. otherwise use configured default
4. do not attempt same account again
5. fail over if attempts remain
```

Default cooldown:

```text
300 seconds
```

Scope for V1:

```text
account-global cooldown
```

Do not attempt per-model cooldown until upstream behavior demonstrates it is required.

---

# 16. Timeout Policy

Config:

```text
request timeout default: 120 seconds
```

Recommended separate concepts:

```text
connect timeout
overall request timeout
optional first-byte timeout
```

A timeout before streaming output:

```text
retryable
```

Timeout after output begins:

```text
stream terminated
no failover
```

---

# 17. Streaming Contract

Request:

```json
{
  "model": "qwen3.5:cloud",
  "messages": [],
  "stream": true
}
```

Rules:

```text
before first downstream event:
  retry allowed

after first downstream event:
  retry forbidden
```

First downstream event means the gateway has committed response content to the client.

The gateway must not stitch responses from two accounts into one SSE stream.

---

# 18. Client Disconnect

When client disconnects:

```text
1. abort upstream request where possible
2. decrement active counter
3. mark request aborted
4. do not classify as account failure unless upstream actually failed
5. do not trigger failover
```

---

# 19. Active Request Accounting

Before sending upstream:

```text
active[account] += 1
```

Always in cleanup:

```text
active[account] -= 1
```

Counter must never become negative.

Standalone implementation must use process-safe synchronous mutation inside event-loop semantics.

Optional Redis uses atomic increment/decrement.

---

# 20. Health State

States:

```text
ACTIVE
DEGRADED
COOLDOWN
INVALID
DISABLED
```

Suggested transitions:

```text
success:
  DEGRADED -> ACTIVE
  ACTIVE -> ACTIVE

single transient failure:
  ACTIVE -> ACTIVE or DEGRADED

repeated transient failure:
  ACTIVE/DEGRADED -> COOLDOWN

429:
  ACTIVE/DEGRADED -> COOLDOWN

401:
  any routable state -> INVALID

admin disable:
  any -> DISABLED
```

---

# 21. Failure Window

Recommended V1:

```text
3 transient failures within 120 seconds
```

Then:

```text
COOLDOWN for 120 seconds
```

Configurable.

Do not hardcode provider-specific assumptions.

---

# 22. Successful Failover

Example:

```text
lease -> acc_02
acc_02 -> 429
acc_04 -> 200
```

Result:

```text
acc_02 cooldown
lease migrated to acc_04
finalAccount = acc_04
failoverCount = 1
```

---

# 23. Failed Failover

Example:

```text
acc_01 -> timeout
acc_02 -> 429
acc_03 -> 500
```

After max attempts:

```text
return sanitized upstream-unavailable error
record:
attemptCount = 3
failoverCount = 2
```

Do not create a new lease.

---

# 24. `/v1/models`

Response is proxy-level inventory.

Only include models:

```text
enabled globally
AND
available on >= 1 eligible account
```

Do not expose:

```text
which account owns the model
account names
credentials
internal aliases
```

---

# 25. Chat Completion Forwarding

The proxy should preserve supported fields.

Core fields:

```text
model
messages
temperature
top_p
stream
stop
max_tokens / compatible equivalent
tools
tool_choice
response_format when supported
user
```

Unknown fields:

- preserve only if upstream compatibility is confirmed
- otherwise fail clearly rather than silently corrupt semantics

Provider compatibility requires verification.

---

# 26. Admin API

## Accounts

```text
GET    /api/admin/accounts
POST   /api/admin/accounts
GET    /api/admin/accounts/:id
PATCH  /api/admin/accounts/:id
DELETE /api/admin/accounts/:id

POST   /api/admin/accounts/:id/test
POST   /api/admin/accounts/:id/enable
POST   /api/admin/accounts/:id/disable
POST   /api/admin/accounts/:id/refresh-models
```

## Models

```text
GET   /api/admin/models
GET   /api/admin/models/:id
PATCH /api/admin/models/:id
```

## Pools

```text
GET    /api/admin/pools
POST   /api/admin/pools
PATCH  /api/admin/pools/:id
DELETE /api/admin/pools/:id
```

## Proxy API Keys

```text
GET    /api/admin/api-keys
POST   /api/admin/api-keys
PATCH  /api/admin/api-keys/:id
DELETE /api/admin/api-keys/:id
POST   /api/admin/api-keys/:id/revoke
```

## Requests

```text
GET /api/admin/requests
GET /api/admin/requests/:id
```

## Routing

```text
GET /api/admin/routing
PUT /api/admin/routing
```

## Settings

```text
GET /api/admin/settings
PUT /api/admin/settings
```

---

# 27. Add Account Contract

Example request:

```json
{
  "name": "ollama-main-01",
  "apiKey": "secret",
  "priority": 100,
  "weight": 1,
  "enabled": true
}
```

Server:

```text
validate
encrypt key
optionally test
persist
refresh models
initialize ACTIVE or INVALID state
```

API response never returns raw API key.

---

# 28. Create Proxy Key Contract

Example:

```json
{
  "name": "Dify Production",
  "poolId": "pool_prod",
  "allowedModels": ["qwen3.5:cloud"],
  "concurrencyLimit": 20
}
```

Creation response may include once:

```json
{
  "id": "key_...",
  "secret": "sk-proxy-...",
  "keyPrefix": "sk-proxy-..."
}
```

Subsequent GET:

```text
secret absent
masked representation only
```

---

# 29. Request Log Contract

List item:

```ts
type RequestLog = {
  requestId: string
  timestamp: string
  clientName: string
  model: string
  leaseHit: boolean
  initialAccount?: string
  finalAccount?: string
  attemptCount: number
  failoverCount: number
  stream: boolean
  statusCode: number
  latencyMs: number
  ttfbMs?: number
  errorCategory?: string
}
```

---

# 30. Routing Timeline Contract

Detail may include:

```ts
type RoutingEvent = {
  timestamp: string
  type:
    | "REQUEST_RECEIVED"
    | "AUTHENTICATED"
    | "ROUTING_KEY_RESOLVED"
    | "LEASE_HIT"
    | "LEASE_MISS"
    | "ACCOUNT_SELECTED"
    | "UPSTREAM_ERROR"
    | "COOLDOWN_APPLIED"
    | "FAILOVER_SELECTED"
    | "FIRST_TOKEN"
    | "UPSTREAM_SUCCESS"
    | "LEASE_UPDATED"
    | "REQUEST_COMPLETED"
  accountId?: string
  metadata?: Record<string, string | number | boolean>
}
```

No secrets.

---

# 31. Error Envelope

Preferred compatible shape:

```json
{
  "error": {
    "message": "No eligible upstream account is available for this model.",
    "type": "upstream_unavailable",
    "code": "NO_ELIGIBLE_ACCOUNT"
  }
}
```

Response header:

```http
X-Request-ID: req_...
```

---

# 32. Internal Routing Function Contract

```ts
type RoutingContext = {
  requestId: string
  proxyKeyId: string
  poolId: string
  modelId: string
  routingIdentity?: string
  stream: boolean
  maxAttempts: number
}

type RoutingResult = {
  finalAccountId: string
  attemptCount: number
  failoverCount: number
  leaseHit: boolean
}
```

---

# 33. Routing Algorithm Pseudocode

```ts
async function executeInference(ctx, request) {
  const routingIdentity = resolveRoutingIdentity(request)

  const lease = routingIdentity
    ? await leaseStore.get(makeLeaseKey(ctx, routingIdentity))
    : null

  const attempted = new Set<string>()
  let leaseHit = false
  let firstOutputCommitted = false

  for (let attempt = 1; attempt <= ctx.maxAttempts; attempt++) {
    const candidates = await getEligibleAccounts({
      poolId: ctx.poolId,
      modelId: ctx.modelId,
      exclude: attempted,
    })

    if (!candidates.length) {
      throw noEligibleAccount()
    }

    let account

    if (
      attempt === 1 &&
      lease &&
      candidates.some(a => a.id === lease.accountId)
    ) {
      account = candidates.find(a => a.id === lease.accountId)!
      leaseHit = true
    } else {
      account = selectAccount(candidates)
    }

    attempted.add(account.id)

    try {
      runtime.incrementActive(account.id)

      const result = await ollamaClient.send(account, request, {
        onFirstOutput() {
          firstOutputCommitted = true
        }
      })

      health.recordSuccess(account.id)

      if (routingIdentity) {
        leaseStore.set(
          makeLeaseKey(ctx, routingIdentity),
          account.id
        )
      }

      return result

    } catch (error) {
      const classified = classifyError(error)
      health.recordFailure(account.id, classified)

      if (firstOutputCommitted) {
        throw streamInterrupted()
      }

      if (!classified.retryable) {
        throw classified.publicError
      }

      if (attempt === ctx.maxAttempts) {
        throw classified.publicError
      }

    } finally {
      runtime.decrementActive(account.id)
    }
  }
}
```

---

# 34. Test Requirements

Minimum automated tests:

### Affinity
- header affinity
- user affinity
- stateless request
- expired lease
- invalid lease account
- successful lease migration

### Selection
- priority
- least load
- weight tie-break
- model exclusion
- pool isolation
- hard concurrency exclusion

### Failover
- 429
- timeout
- connection error
- 5xx
- all attempts fail

### Streaming
- success
- fail before first output
- fail after first output
- client disconnect

### Credential
- invalid proxy key
- revoked proxy key
- invalid upstream key

### Security
- no upstream key in response
- no proxy key in logs
- no prompt body by default

---

# 35. Frozen Routing Decisions

1. Sticky routing requires stable routing identity.
2. Header has priority over `user`.
3. Prompt fingerprinting is prohibited.
4. Lease is scoped by proxy key, pool, model, and routing ID.
5. Existing valid lease is preferred.
6. New work uses priority + least load + weight.
7. One account is attempted once per request.
8. Maximum attempts default to 3.
9. 429 causes cooldown.
10. Streaming cannot fail over after first output.
11. Successful failover migrates lease.
12. Stateless requests do not create leases.
13. V1 cooldown is account-global.
14. Provider-specific headers and quotas require verification.
