import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import {
  models,
  accountModels,
  upstreamAccounts,
  accountPoolMembers,
  settings,
} from "@ollama-proxy/storage";
import {
  OllamaClient,
  classifyError,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
} from "@ollama-proxy/ollama-client";
import {
  resolveRoutingKey,
  makeLeaseKey,
  LeaseStore,
  ActiveRequestCounter,
  BoundedRequestQueue,
  getAccountMaxConcurrency,
  CooldownManager,
  FailureWindowCounter,
  HealthManager,
  runWithAttempts,
  getEligibleAccounts,
  selectAccount,
  type EligibleAccount,
} from "@ollama-proxy/routing-core";
import { decrypt, type RoutingConfig, DEFAULT_ROUTING_CONFIG } from "@ollama-proxy/shared";
import { chatCompletionRequestSchema } from "./validation.js";
import { sendOpenAIError, sendCategoryError } from "./errors.js";
import { generateRequestId } from "./request-id.js";
import { RequestTrace } from "../telemetry.js";
import { incrementConcurrency, decrementConcurrency } from "../middleware/proxy-key-auth.js";

// ── Singletons ──
const ollamaClient = new OllamaClient();
const leaseStore = new LeaseStore();
export const requestQueue = new BoundedRequestQueue();
export const activeCounter = new ActiveRequestCounter(requestQueue);
const cooldownManager = new CooldownManager();
const failureCounter = new FailureWindowCounter();
const healthManager = new HealthManager(cooldownManager, failureCounter);

// ── Task 043: Graceful shutdown tracking ──
let shuttingDown = false;

export function markShutdown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function destroyRoutingState(): void {
  leaseStore.destroy();
  requestQueue.clear();
  activeCounter.clear();
  cooldownManager.clear();
  failureCounter.clear();
  healthManager.clear();
}

/**
 * Phase 4 (022-028) + Phase 6 (035-039) + Phase 7 (040-043)
 * OpenAI-compatible API with failover + streaming safety.
 */
export async function openaiRoutes(app: FastifyInstance): Promise<void> {
  // ── Task 022: GET /v1/models ──
  app.get("/v1/models", async (request, reply) => {
    const requestId = applyRequestId(request, reply);
    const proxyKey = request.proxyKey!;

    try {
      const allModels = await app.db
        .select({
          publicModelId: models.publicModelId,
          upstreamModelId: models.upstreamModelId,
        })
        .from(models)
        .where(eq(models.enabled, true));

      const visibleModels: Array<{
        id: string;
        object: string;
        created: number;
        owned_by: string;
      }> = [];

      for (const m of allModels) {
        if (proxyKey.allowedModels && !proxyKey.allowedModels.has(m.publicModelId)) {
          continue;
        }

        const [hasAccount] = await app.db
          .select({ id: upstreamAccounts.id })
          .from(accountModels)
          .innerJoin(upstreamAccounts, eq(accountModels.accountId, upstreamAccounts.id))
          .innerJoin(accountPoolMembers, eq(accountModels.accountId, accountPoolMembers.accountId))
          .where(
            and(
              eq(accountModels.modelId, m.publicModelId),
              eq(accountModels.available, true),
              eq(accountModels.excluded, false),
              eq(upstreamAccounts.enabled, true),
              eq(accountPoolMembers.poolId, proxyKey.poolId),
              eq(accountPoolMembers.enabled, true),
            ),
          )
          .limit(1);

        if (hasAccount) {
          visibleModels.push({
            id: m.publicModelId,
            object: "model",
            created: 0,
            owned_by: "ollama",
          });
        }
      }

      return reply.send({ object: "list" as const, data: visibleModels });
    } catch (err) {
      request.log.error({ err, requestId }, "Failed to list models");
      return sendOpenAIError(reply, 500, "Internal server error", "server_error", "internal_error");
    }
  });

  // ── Tasks 023+024+040-042: POST /v1/chat/completions ──
  app.post("/v1/chat/completions", async (request, reply) => {
    const requestId = applyRequestId(request, reply);
    const proxyKey = request.proxyKey!;

    // Task 043: reject new requests during shutdown
    if (shuttingDown) {
      return sendOpenAIError(reply, 503, "Server is shutting down", "server_error", "server_shutting_down");
    }

    // Validate
    const parsed = chatCompletionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return sendOpenAIError(reply, 400, msg, "invalid_request_error", "invalid_request");
    }

    const body = parsed.data;
    const publicModelId = body.model;
    const isStream = body.stream;

    if (proxyKey.allowedModels && !proxyKey.allowedModels.has(publicModelId)) {
      return sendCategoryError(reply, "MODEL_NOT_AVAILABLE",
        `Model '${publicModelId}' is not available for this API key`);
    }

    const [modelRow] = await app.db
      .select()
      .from(models)
      .where(and(eq(models.publicModelId, publicModelId), eq(models.enabled, true)))
      .limit(1);

    if (!modelRow) {
      return sendCategoryError(reply, "MODEL_NOT_AVAILABLE",
        `Model '${publicModelId}' not found or disabled`);
    }

    const routingConfig = await loadRoutingConfig(app);

    const routingKey = resolveRoutingKey(
      request.headers as Record<string, string | string[] | undefined>,
      body.user,
    );

    let leasedAccountId: string | null = null;
    let leaseKey: string | null = null;
    if (routingConfig.stickyEnabled && routingKey) {
      leaseKey = makeLeaseKey(
        { proxyKeyId: proxyKey.id, poolId: proxyKey.poolId, publicModelId },
        routingKey,
      );
      const lease = leaseStore.get(leaseKey);
      if (lease) leasedAccountId = lease.accountId;
    }

    const allAccounts = await loadEligibleAccounts(app, proxyKey.poolId, modelRow.id);

    if (allAccounts.length === 0) {
      return sendCategoryError(reply, "NO_ELIGIBLE_ACCOUNT",
        `No eligible account available for model '${publicModelId}'`);
    }

    // ── Admission Control: Bounded Wait Queue if all accounts are full ──
    const queueStart = Date.now();
    let queueMs = 0;
    const clientDisconnectSignal = request.raw ? AbortSignal.timeout(30_000) : undefined;

    // Check if any candidate has available concurrency slots
    const hasAvailableSlot = () => {
      return allAccounts.some((a) => {
        if (!a.enabled || a.state === "INVALID" || a.state === "DISABLED") return false;
        const maxSlots = getAccountMaxConcurrency(a);
        const inflight = activeCounter.get(a.id);
        return inflight < maxSlots;
      });
    };

    if (!hasAvailableSlot() && requestQueue.queueLength < 50) {
      console.log(`[server] [QUEUE] All accounts at capacity. Queuing request '${requestId}'...`);
      await requestQueue.waitForSlot(25_000, clientDisconnectSignal);
      queueMs = Date.now() - queueStart;
    }

    const timeStr = new Date().toTimeString().split(" ")[0];
    const modeTag = isStream ? "STREAM" : "JSON";
    const queueTag = queueMs > 0 ? ` · \x1b[35mQUEUE ${queueMs}ms\x1b[0m` : "";
    console.log(
      `[server] [\x1b[90m${timeStr}\x1b[0m] \x1b[35m▶\x1b[0m \x1b[1mPOST\x1b[0m \x1b[33m${publicModelId}\x1b[0m → \x1b[33m${modelRow.upstreamModelId}\x1b[0m · FMT: openai→ollama · \x1b[36m${modeTag}\x1b[0m · KEY:\x1b[32m${proxyKey.name}\x1b[0m${queueTag}`
    );

    const trace = new RequestTrace(requestId);
    trace.proxyApiKeyId = proxyKey.id;
    trace.publicModelId = publicModelId;
    trace.stream = Boolean(isStream);
    trace.queueMs = queueMs;
    trace.routingKeyHash = routingKey ? makeLeaseKey({ proxyKeyId: proxyKey.id, poolId: proxyKey.poolId, publicModelId }, routingKey) : undefined;
    trace.leaseHit = Boolean(leasedAccountId);

    if (!isStream) {
      // ── Non-streaming: attempt runner handles failover ──
      incrementConcurrency(proxyKey.id);
      try {
        const result = await runWithAttempts<ChatCompletionResponse>(
          {
            allAccounts, activeCounter, cooldownManager, healthManager,
            leaseStore, routingConfig,
            poolId: proxyKey.poolId, modelId: modelRow.id,
            proxyKeyId: proxyKey.id, leaseKey, leasedAccountId,
            deadlineMs: app.config.requestTimeoutSeconds * 1000 * routingConfig.maxAttempts,
          },
          async (account) => {
            trace.initialAccountId = trace.initialAccountId ?? account.id;
            trace.finalAccountId = account.id;
            trace.attemptCount++;
            const apiKey = await decryptAccountKey(app, account.id);
            const upstreamReq: ChatCompletionRequest = {
              ...body, model: modelRow.upstreamModelId, stream: false,
            };
            return ollamaClient.chatCompletion(apiKey, upstreamReq, {
              timeoutMs: getModelTimeoutMs(publicModelId, app.config.requestTimeoutSeconds),
            });
          },
        );

        result.response.model = publicModelId;
        trace.statusCode = 200;
        trace.finalAccountId = result.accountId;
        trace.attemptCount = result.attempts;
        trace.failoverCount = result.failovers;
        if (result.response.usage) {
          trace.inputTokens = result.response.usage.prompt_tokens;
          trace.outputTokens = result.response.usage.completion_tokens;
        }
        await trace.persist(app.db);

        return reply.send(result.response);
      } catch (err: unknown) {
        const classified = classifyError(err);
        trace.statusCode = classified.category === "CLIENT_VALIDATION_ERROR" ? 400 : 502;
        trace.errorCategory = classified.category;
        trace.errorCode = err instanceof Error ? err.message : String(err);
        await trace.persist(app.db);

        request.log.error({ err, requestId, category: classified.category }, "All attempts failed");
        return sendCategoryError(reply, classified.category,
          `Upstream request failed: ${classified.category}`);
      } finally {
        decrementConcurrency(proxyKey.id);
      }
    } else {
      // ── Streaming with Phase 7 safety ──
      // Task 040: firstOutputCommitted flag
      let firstOutputCommitted = false;
      let headersSent = false;

      // Task 042: client disconnect detection
      const clientAbort = new AbortController();
      request.raw.on("close", () => clientAbort.abort());

      const clientWantsUsage = body.stream_options?.include_usage === true;

      // For streaming, we do manual attempt loop because
      // pre-output retry is allowed but post-output retry is NOT (Task 041)
      const attemptedIds = new Set<string>();
      let lastError: unknown;
      let success = false;

      incrementConcurrency(proxyKey.id);
      try {

      for (let attempt = 1; attempt <= routingConfig.maxAttempts; attempt++) {
        // Task 041: post-output retry blocked
        if (firstOutputCommitted) break;

        // Client already gone?
        if (clientAbort.signal.aborted) break;

        // Select account
        let selected: EligibleAccount | null = null;

        if (attempt === 1 && leasedAccountId) {
          const leasedCandidate = allAccounts.find(
            (a) => a.id === leasedAccountId && a.enabled &&
              a.state !== "INVALID" && a.state !== "DISABLED",
          );
          if (leasedCandidate) {
            const maxSlots = getAccountMaxConcurrency(leasedCandidate);
            const inflight = activeCounter.get(leasedCandidate.id);
            if (inflight < maxSlots) {
              selected = leasedCandidate;
            }
          }
        }

        if (!selected) {
          let eligible = getEligibleAccounts(allAccounts, {
            poolId: proxyKey.poolId,
            modelId: modelRow.id,
            attemptedAccountIds: attemptedIds,
            getCooldown: (id) => cooldownManager.getCooldown(id),
            activeCounter,
            requireAvailableSlot: true,
          });

          if (eligible.length === 0) {
            eligible = getEligibleAccounts(allAccounts, {
              poolId: proxyKey.poolId,
              modelId: modelRow.id,
              attemptedAccountIds: attemptedIds,
              getCooldown: (id) => cooldownManager.getCooldown(id),
              requireAvailableSlot: false,
            });
          }

          if (eligible.length === 0) break;
          selected = selectAccount(eligible, activeCounter);
        }

        attemptedIds.add(selected.id);
        activeCounter.increment(selected.id);
        trace.initialAccountId = trace.initialAccountId ?? selected.id;
        trace.finalAccountId = selected.id;
        trace.attemptCount = attempt;
        if (attempt > 1) trace.failoverCount++;

        const streamStart = Date.now();

        try {
          const apiKey = await decryptAccountKey(app, selected.id);
          const upstreamReq: ChatCompletionRequest = {
            ...body,
            model: modelRow.upstreamModelId,
            stream: true,
            // Ollama Cloud omits usage from SSE chunks unless asked, which left
            // every streamed request recorded as zero tokens. Always ask, then
            // forward the usage chunk only if the client wanted it (below).
            stream_options: { ...(body.stream_options ?? {}), include_usage: true },
          };

          const generator = ollamaClient.chatCompletionStream(apiKey, upstreamReq, {
            timeoutMs: getModelTimeoutMs(publicModelId, app.config.requestTimeoutSeconds),
            signal: clientAbort.signal,
          });

          for await (const chunk of generator) {
            // Task 042: client disconnect
            if (clientAbort.signal.aborted) {
              throw new Error("STREAM_CLIENT_DISCONNECT");
            }

            // Task 040: mark first output
            if (!headersSent) {
              trace.ttfbMs = Date.now() - streamStart;
              reply.raw.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                "X-Request-ID": requestId,
              });
              headersSent = true;
            }

            if (chunk.usage) {
              trace.inputTokens = chunk.usage.prompt_tokens;
              trace.outputTokens = chunk.usage.completion_tokens;
            }

            // Upstream sends a trailing usage-only chunk (empty choices) because
            // we requested it. Pass it on only when the client asked for usage —
            // otherwise it is telemetry we added, not part of their stream.
            const isUsageOnly =
              chunk.usage != null && (chunk.choices?.length ?? 0) === 0;
            if (isUsageOnly && !clientWantsUsage) continue;

            chunk.model = publicModelId;
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);

            if (!firstOutputCommitted) {
              firstOutputCommitted = true; // Task 040: now committed
            }
          }

          // Stream completed successfully
          reply.raw.write("data: [DONE]\n\n");
          reply.raw.end();
          success = true;
          trace.statusCode = 200;
          await trace.persist(app.db);

          // Health + lease
          healthManager.recordSuccess(selected.id);
          if (leaseKey && routingConfig.stickyEnabled) {
            leaseStore.set(leaseKey, selected.id, routingConfig.leaseTtlSeconds * 1000);
          }

          return reply;
        } catch (err: unknown) {
          lastError = err;

          const classified = classifyError(err);
          healthManager.recordFailure(selected.id, classified.category, routingConfig);

          request.log.error({
            requestId, accountId: selected.id,
            category: classified.category,
            attempt, firstOutputCommitted,
          }, "Stream attempt failed");

          // Task 041: if output already committed, cannot retry
          if (firstOutputCommitted) {
            // STREAM_INTERRUPTED — send error event then terminate
            trace.statusCode = 502;
            trace.errorCategory = classified.category;
            trace.errorCode = "STREAM_INTERRUPTED";
            await trace.persist(app.db);
            if (headersSent) {
              reply.raw.write(`data: ${JSON.stringify({ error: { message: "Stream interrupted", type: "server_error", code: "stream_interrupted" } })}\n\n`);
              reply.raw.end();
            }
            return reply;
          }

          // Non-retryable → stop
          if (!classified.retryable) break;
        } finally {
          activeCounter.decrement(selected.id);
        }
      }

      // All attempts exhausted or post-output failure
      if (!success) {
        const classified = lastError ? classifyError(lastError) : { category: "NO_ELIGIBLE_ACCOUNT" as const };
        trace.statusCode = classified.category === "NO_ELIGIBLE_ACCOUNT" ? 503 : 502;
        trace.errorCategory = classified.category;
        trace.errorCode = lastError instanceof Error ? lastError.message : undefined;
        await trace.persist(app.db);

        if (!headersSent) {
          return sendCategoryError(reply, classified.category,
            `Upstream request failed: ${classified.category}`);
        }
        // Headers sent but error — send SSE error event then end
        reply.raw.write(`data: ${JSON.stringify({ error: { message: `Stream failed: ${classified.category}`, type: "server_error", code: classified.category } })}\n\n`);
        reply.raw.end();
        return reply;
      }
      } finally {
        decrementConcurrency(proxyKey.id);
      }
    }
  });
}

// ── Helpers ──

function getModelTimeoutMs(modelId: string, configuredTimeoutSeconds: number): number {
  const baseMs = configuredTimeoutSeconds * 1000;
  // Large/ultra reasoning models often have massive cold start times on Ollama Cloud (up to 45s TTFT)
  const isUltraOrLarge = modelId.toLowerCase().includes("ultra") || modelId.toLowerCase().includes("120b") || modelId.toLowerCase().includes("70b");
  if (isUltraOrLarge) {
    return Math.max(baseMs, 300_000); // 5 minutes max timeout for ultra models
  }
  return baseMs;
}

function applyRequestId(request: any, reply: any): string {
  const provided = request.headers["x-request-id"];
  const requestId = (typeof provided === "string" && provided) ? provided : generateRequestId();
  reply.header("X-Request-ID", requestId);
  return requestId;
}

async function loadRoutingConfig(app: FastifyInstance): Promise<RoutingConfig> {
  const [row] = await app.db
    .select()
    .from(settings)
    .where(eq(settings.key, "routing_config"))
    .limit(1);

  if (row) {
    try { return JSON.parse(row.value) as RoutingConfig; } catch { /* fall through */ }
  }
  return DEFAULT_ROUTING_CONFIG;
}

async function decryptAccountKey(app: FastifyInstance, accountId: string): Promise<string> {
  const [row] = await app.db
    .select({ encryptedApiKey: upstreamAccounts.encryptedApiKey })
    .from(upstreamAccounts)
    .where(eq(upstreamAccounts.id, accountId))
    .limit(1);

  if (!row) throw new Error(`Account ${accountId} not found`);
  return decrypt(row.encryptedApiKey, app.config.encryptionKey);
}

async function loadEligibleAccounts(
  app: FastifyInstance,
  poolId: string,
  modelId: string,
): Promise<EligibleAccount[]> {
  const rows = await app.db
    .select({
      id: upstreamAccounts.id,
      name: upstreamAccounts.name,
      tier: upstreamAccounts.tier,
      maxConcurrency: upstreamAccounts.maxConcurrency,
      enabled: upstreamAccounts.enabled,
      state: upstreamAccounts.state,
      priority: upstreamAccounts.priority,
      weight: upstreamAccounts.weight,
    })
    .from(upstreamAccounts)
    .innerJoin(
      accountPoolMembers,
      and(
        eq(accountPoolMembers.accountId, upstreamAccounts.id),
        eq(accountPoolMembers.poolId, poolId),
        eq(accountPoolMembers.enabled, true),
      ),
    )
    .innerJoin(
      accountModels,
      and(
        eq(accountModels.accountId, upstreamAccounts.id),
        eq(accountModels.modelId, modelId),
        eq(accountModels.available, true),
        eq(accountModels.excluded, false),
      ),
    )
    .where(eq(upstreamAccounts.enabled, true));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tier: row.tier,
    maxConcurrency: row.maxConcurrency,
    enabled: row.enabled,
    state: row.state,
    priority: row.priority,
    weight: row.weight,
    poolIds: [poolId],
    modelIds: [modelId],
  }));
}
