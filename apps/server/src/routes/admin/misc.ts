import type { FastifyInstance } from "fastify";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { models, accountModels, upstreamAccounts, requestLogs, settings } from "@ollama-proxy/storage";
import { getAccountMaxConcurrency } from "@ollama-proxy/routing-core";
import { hashPassword } from "@ollama-proxy/shared";
import {
  checkBruteForce,
  recordFailedAttempt,
  clearFailedAttempts,
  lockoutError,
  verifyAdminSecret,
  hasStoredAdminSecret,
  invalidateAdminSecretCache,
  ADMIN_SECRET_SETTING_KEY,
} from "../../middleware/admin-auth.js";

/**
 * Operator-configured usage accounting.
 *
 * Ollama Cloud exposes no quota or billing API, so none of these can be read
 * from upstream. They are the operator's own numbers, stored under the
 * `usage_config` settings key and editable from the Settings page. Costs
 * default to 0 so the dashboard reports $0.00 rather than an invented figure.
 */
export interface UsageConfig {
  sessionWindowHours: number;
  sessionLimitRequests: number;
  weeklyWindowDays: number;
  weeklyLimitRequests: number;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
}

export const DEFAULT_USAGE_CONFIG: UsageConfig = {
  sessionWindowHours: 5,
  sessionLimitRequests: 1000,
  weeklyWindowDays: 7,
  weeklyLimitRequests: 5000,
  inputCostPerMTok: 0,
  outputCostPerMTok: 0,
};

async function loadUsageConfig(app: FastifyInstance): Promise<UsageConfig> {
  const [row] = await app.db
    .select()
    .from(settings)
    .where(eq(settings.key, "usage_config"))
    .limit(1);

  if (row) {
    try {
      return { ...DEFAULT_USAGE_CONFIG, ...(JSON.parse(row.value) as Partial<UsageConfig>) };
    } catch {
      /* malformed — fall through to defaults */
    }
  }
  return DEFAULT_USAGE_CONFIG;
}

/**
 * These are rolling windows, so the "reset" is when the oldest request still
 * inside the window ages out — not a fixed clock time.
 */
function formatResetIn(resetAt: number | null): string {
  if (resetAt == null) return "no usage in window";
  const ms = resetAt - Date.now();
  if (ms <= 0) return "now";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

/**
 * Tasks 051-054: Models, Requests, Routing config, Settings
 */
export async function miscAdminRoutes(app: FastifyInstance): Promise<void> {
  // ── Auth verify endpoint ──
  app.post("/api/admin/auth/login", async (request, reply) => {
    const body = (request.body as { secret?: string } | undefined) ?? {};
    const ip = request.ip;

    // A correct secret always gets through, even while the IP is locked out —
    // otherwise one attacker can deny service to the real admin.
    if (body.secret && (await verifyAdminSecret(app, body.secret.trim()))) {
      clearFailedAttempts(ip);
      return reply.send({ success: true, secretConfigured: true });
    }

    // This endpoint is exempt from the auth hook (the secret is in the body, which
    // the hook cannot read), so it enforces its own lockout here.
    if (checkBruteForce(ip)) {
      return reply.code(429).send(lockoutError());
    }

    recordFailedAttempt(ip);
    return reply.code(401).send({
      error: { message: "Invalid admin password/secret", type: "authentication_error", code: "invalid_secret" },
    });
  });

  // ── Change the admin password ──
  // Guarded by the auth hook, so the caller already holds a valid secret. The
  // current password is still required in the body: the header comes from
  // localStorage, and a password change should take a deliberate re-entry.
  app.get("/api/admin/auth/password-status", async (_request, reply) => {
    return reply.send({ customPasswordSet: await hasStoredAdminSecret(app) });
  });

  app.post("/api/admin/auth/change-password", async (request, reply) => {
    const body = (request.body as { currentPassword?: string; newPassword?: string }) ?? {};
    const current = body.currentPassword?.trim();
    const next = body.newPassword?.trim();

    if (!current || !next) {
      return reply.code(400).send({
        error: {
          message: "currentPassword and newPassword are required",
          type: "invalid_request_error",
          code: "invalid_request",
        },
      });
    }

    if (!(await verifyAdminSecret(app, current))) {
      recordFailedAttempt(request.ip);
      return reply.code(401).send({
        error: {
          message: "Current password is incorrect",
          type: "authentication_error",
          code: "invalid_secret",
        },
      });
    }

    // Same floor the env var enforces, so a dashboard change cannot weaken it.
    if (next.length < 8) {
      return reply.code(400).send({
        error: {
          message: "New password must be at least 8 characters",
          type: "invalid_request_error",
          code: "invalid_request",
        },
      });
    }

    if (next === current) {
      return reply.code(400).send({
        error: {
          message: "New password must be different from the current one",
          type: "invalid_request_error",
          code: "invalid_request",
        },
      });
    }

    const hash = hashPassword(next);
    const now = new Date().toISOString();
    const [existing] = await app.db
      .select()
      .from(settings)
      .where(eq(settings.key, ADMIN_SECRET_SETTING_KEY))
      .limit(1);

    if (existing) {
      await app.db
        .update(settings)
        .set({ value: hash, updatedAt: now })
        .where(eq(settings.key, ADMIN_SECRET_SETTING_KEY));
    } else {
      await app.db
        .insert(settings)
        .values({ key: ADMIN_SECRET_SETTING_KEY, value: hash, updatedAt: now });
    }

    invalidateAdminSecretCache();
    clearFailedAttempts(request.ip);

    return reply.send({ success: true });
  });

  // ── Task 051: Models ──
  app.get("/api/admin/models", async (_request, reply) => {
    const rows = await app.db.select().from(models);
    return reply.send(rows);
  });

  app.patch("/api/admin/models/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.upstreamModelId !== undefined) updates.upstreamModelId = body.upstreamModelId;

    await app.db.update(models).set(updates).where(eq(models.id, id));
    const [updated] = await app.db.select().from(models).where(eq(models.id, id));
    if (!updated) return reply.code(404).send({ error: { message: "Model not found", type: "invalid_request_error", code: "not_found" } });
    return reply.send(updated);
  });

  app.delete("/api/admin/models/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.db.delete(models).where(eq(models.id, id));
    return reply.code(204).send();
  });

  // Test model chat inference directly from Admin UI
  app.post("/api/admin/models/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [modelRow] = await app.db.select().from(models).where(eq(models.id, id)).limit(1);
    if (!modelRow) {
      return reply.code(404).send({ error: { message: "Model not found", type: "invalid_request_error", code: "not_found" } });
    }

    const body = (request.body as { prompt?: string } | undefined) ?? {};
    const prompt = body.prompt || "Say hello and confirm you are operational in one short sentence.";

    // Try with retry / failover across active accounts if 429 occurs
    const allProviders = await app.db
      .select({
        accountId: upstreamAccounts.id,
        encryptedApiKey: upstreamAccounts.encryptedApiKey,
        accountName: upstreamAccounts.name,
      })
      .from(accountModels)
      .innerJoin(upstreamAccounts, eq(accountModels.accountId, upstreamAccounts.id))
      .where(
        and(
          eq(accountModels.modelId, modelRow.publicModelId),
          eq(accountModels.available, true),
          eq(accountModels.excluded, false),
          eq(upstreamAccounts.enabled, true),
        ),
      );

    if (!allProviders.length) {
      return reply.code(400).send({
        success: false,
        error: `No active upstream account has model '${modelRow.publicModelId}' in its catalog.`,
      });
    }

    const { decrypt } = await import("@ollama-proxy/shared");
    const { OllamaClient } = await import("@ollama-proxy/ollama-client");
    const client = new OllamaClient();

    const start = Date.now();
    const timeStr = new Date().toTimeString().split(" ")[0];
    let lastError: unknown;

    // Retry loop with jittered backoff on 429
    for (let i = 0; i < allProviders.length * 2; i++) {
      const provider = allProviders[i % allProviders.length];
      console.log(
        `[\x1b[90m${timeStr}\x1b[0m] \x1b[35m▶\x1b[0m \x1b[1mTEST\x1b[0m model \x1b[33m${modelRow.publicModelId}\x1b[0m via ACC:\x1b[32m${provider.accountName}\x1b[0m`
      );

      try {
        const apiKey = decrypt(provider.encryptedApiKey, app.config.encryptionKey);
        const res = await client.chatCompletion(
          apiKey,
          {
            model: modelRow.upstreamModelId,
            messages: [{ role: "user", content: prompt }],
            stream: false,
          },
          { timeoutMs: Math.max(90_000, (app.config.requestTimeoutSeconds || 120) * 1000) },
        );

        const latencyMs = Date.now() - start;
        const content = res.choices?.[0]?.message?.content ?? "";
        const inTokens = res.usage?.prompt_tokens ?? 0;
        const outTokens = res.usage?.completion_tokens ?? 0;

        // Record to request_logs for UI visibility
        const { RequestTrace } = await import("../../telemetry.js");
        const trace = new RequestTrace(`test_${Date.now()}`, start);
        trace.publicModelId = modelRow.publicModelId;
        trace.finalAccountId = provider.accountId;
        trace.statusCode = 200;
        trace.inputTokens = inTokens;
        trace.outputTokens = outTokens;
        trace.latencyMs = latencyMs;
        trace.ttfbMs = latencyMs;
        await trace.persist(app.db);

        return reply.send({
          success: true,
          latencyMs,
          response: content,
          accountName: provider.accountName,
          usage: res.usage,
        });
      } catch (err: unknown) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);

        // 402 tier required -> disable model immediately
        if (message.includes("402") || message.includes("requires a subscription")) {
          await app.db.update(accountModels)
            .set({ available: false, excluded: true })
            .where(and(eq(accountModels.accountId, provider.accountId), eq(accountModels.modelId, modelRow.publicModelId)));
          await app.db.update(models)
            .set({ enabled: false })
            .where(eq(models.id, modelRow.id));
          break;
        }

        // 429 rate limit / concurrency -> brief pause and try next
        if (message.includes("429") || message.includes("too many concurrent requests")) {
          await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
          continue;
        }

        break;
      }
    }

    const latencyMs = Date.now() - start;
    const message = lastError instanceof Error ? lastError.message : String(lastError);

    // Record failure to request_logs
    const { RequestTrace } = await import("../../telemetry.js");
    const trace = new RequestTrace(`test_${Date.now()}`, start);
    trace.publicModelId = modelRow.publicModelId;
    trace.statusCode = 502;
    trace.latencyMs = latencyMs;
    trace.errorCode = message;
    await trace.persist(app.db);

    return reply.send({
      success: false,
      latencyMs,
      error: message,
    });
  });

  // ── Task 052: Requests ──
  app.get("/api/admin/requests", async (request, reply) => {
    const query = request.query as {
      limit?: string;
      offset?: string;
      status?: string;
      model?: string;
      from?: string;
      to?: string;
    };

    const limit = Math.min(parseInt(query.limit ?? "100", 10), 1000);
    const offset = parseInt(query.offset ?? "0", 10);

    let q = app.db.select().from(requestLogs).orderBy(desc(requestLogs.timestamp)).limit(limit).offset(offset);

    // ponytail: filters via chained where not great with drizzle dynamic, 
    // but good enough for admin usage. Full filter engine add when needed.
    const rows = await q;
    return reply.send(rows);
  });

  app.delete("/api/admin/requests", async (_request, reply) => {
    await app.db.delete(requestLogs);
    return reply.code(204).send();
  });

  app.get("/api/admin/requests/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await app.db.select().from(requestLogs)
      .where(eq(requestLogs.requestId, id));
    if (!row) return reply.code(404).send({ error: { message: "Request not found", type: "invalid_request_error", code: "not_found" } });
    return reply.send(row);
  });

  // ── Usage & Analytics: GET /api/admin/analytics ──
  app.get("/api/admin/analytics", async (request, reply) => {
    const query = request.query as { range?: string };
    const range = query.range || "today"; // today, 24h, 7d, 30d, 60d

    const { sql, gte, desc, and } = await import("drizzle-orm");

    const now = new Date();
    let cutoffDate: Date;

    if (range === "24h") {
      cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (range === "7d") {
      cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === "30d") {
      cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (range === "60d") {
      cutoffDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    } else {
      // today (start of day)
      cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    }

    const cutoffIso = cutoffDate.toISOString();

    const [totals] = await app.db
      .select({
        totalRequests: sql<number>`count(*)`,
        inputTokens: sql<number>`sum(coalesce(${requestLogs.inputTokens}, 0))`,
        outputTokens: sql<number>`sum(coalesce(${requestLogs.outputTokens}, 0))`,
      })
      .from(requestLogs)
      .where(gte(requestLogs.timestamp, cutoffIso));

    const totalReq = totals?.totalRequests || 0;
    const inTok = totals?.inputTokens || 0;
    const outTok = totals?.outputTokens || 0;

    // Cost is derived from rates the operator sets in Settings. Ollama Cloud
    // bills by subscription and reports no per-request price, so there is
    // nothing upstream to read — unset rates yield $0.00, not a guess.
    const usage = await loadUsageConfig(app);
    const costRatesConfigured =
      usage.inputCostPerMTok > 0 || usage.outputCostPerMTok > 0;
    const estCostVal =
      (inTok * usage.inputCostPerMTok) / 1_000_000 +
      (outTok * usage.outputCostPerMTok) / 1_000_000;
    const estCost = `$${estCostVal.toFixed(2)}`;

    // Recent requests filtered within range
    const recent = await app.db
      .select({
        requestId: requestLogs.requestId,
        timestamp: requestLogs.timestamp,
        publicModelId: requestLogs.publicModelId,
        inputTokens: requestLogs.inputTokens,
        outputTokens: requestLogs.outputTokens,
        statusCode: requestLogs.statusCode,
      })
      .from(requestLogs)
      .where(gte(requestLogs.timestamp, cutoffIso))
      .orderBy(desc(requestLogs.timestamp))
      .limit(15);

    // Timeline & Model Breakdown calculation based on selected range
    const rangeLogs = await app.db
      .select({
        timestamp: requestLogs.timestamp,
        publicModelId: requestLogs.publicModelId,
        inputTokens: requestLogs.inputTokens,
        outputTokens: requestLogs.outputTokens,
      })
      .from(requestLogs)
      .where(gte(requestLogs.timestamp, cutoffIso));

    const timeline = [];

    if (range === "7d" || range === "30d" || range === "60d") {
      const daysCount = range === "7d" ? 7 : range === "30d" ? 30 : 60;
      const dailyMap: Record<string, number> = {};

      for (const r of rangeLogs) {
        const d = r.timestamp.split("T")[0];
        const tok = (r.inputTokens || 0) + (r.outputTokens || 0) || 100;
        dailyMap[d] = (dailyMap[d] || 0) + tok;
      }

      for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dayStr = d.toISOString().split("T")[0];
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        timeline.push({
          time: label,
          tokens: dailyMap[dayStr] || 0,
        });
      }
    } else {
      // 24 hours distribution (today / 24h)
      const hourlyMap: Record<number, number> = {};
      for (const r of rangeLogs) {
        const h = new Date(r.timestamp).getHours();
        const tok = (r.inputTokens || 0) + (r.outputTokens || 0) || 100;
        hourlyMap[h] = (hourlyMap[h] || 0) + tok;
      }

      for (let h = 0; h < 24; h++) {
        const hourStr = `${String(h).padStart(2, "0")}:00`;
        timeline.push({
          hour: h,
          time: hourStr,
          tokens: hourlyMap[h] || 0,
        });
      }
    }

    // Check if there is active activity in the last 3 seconds or active requests ongoing
    const { activeCounter } = await import("../v1.js");
    const allAccounts = await app.db.select({ id: upstreamAccounts.id }).from(upstreamAccounts);
    let hasOngoingActive = false;
    for (const row of allAccounts) {
      if (activeCounter.get(row.id) > 0) {
        hasOngoingActive = true;
        break;
      }
    }

    const activeCutoff = new Date(Date.now() - 3 * 1000).toISOString();
    const [activeRow] = await app.db
      .select({ count: sql<number>`count(*)` })
      .from(requestLogs)
      .where(gte(requestLogs.timestamp, activeCutoff));

    const isStreamingActive = hasOngoingActive || (activeRow?.count || 0) > 0;

    // Calculate Breakdown by Model
    const modelGroupMap: Record<string, {
      model: string;
      provider: string;
      requests: number;
      lastUsed: string;
      inputTokens: number;
      outputTokens: number;
      inputCost: number;
      outputCost: number;
      totalCost: number;
    }> = {};

    for (const r of rangeLogs) {
      const m = r.publicModelId || "unknown";
      if (!modelGroupMap[m]) {
        modelGroupMap[m] = {
          model: m,
          provider: "Ollama Cloud",
          requests: 0,
          lastUsed: r.timestamp,
          inputTokens: 0,
          outputTokens: 0,
          inputCost: 0,
          outputCost: 0,
          totalCost: 0,
        };
      }

      const inT = r.inputTokens || 0;
      const outT = r.outputTokens || 0;

      const inC = (inT * usage.inputCostPerMTok) / 1_000_000;
      const outC = (outT * usage.outputCostPerMTok) / 1_000_000;

      const group = modelGroupMap[m];
      group.requests += 1;
      group.inputTokens += inT;
      group.outputTokens += outT;
      group.inputCost += inC;
      group.outputCost += outC;
      group.totalCost += inC + outC;
      if (new Date(r.timestamp) > new Date(group.lastUsed)) {
        group.lastUsed = r.timestamp;
      }
    }

    const modelUsageList = Object.values(modelGroupMap).sort((a, b) => b.totalCost - a.totalCost);

    return reply.send({
      range,
      totalRequests: totalReq,
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: inTok + outTok,
      estimatedCost: estCost,
      costRatesConfigured,
      recentRequests: recent,
      modelUsageList,
      timeline,
      isStreamingActive,
    });
  });

  // ── Quota Tracker: GET /api/admin/quota ──
  app.get("/api/admin/quota", async (_request, reply) => {
    const usage = await loadUsageConfig(app);

    const now = Date.now();
    const sessionWindowMs = usage.sessionWindowHours * 60 * 60 * 1000;
    const weeklyWindowMs = usage.weeklyWindowDays * 24 * 60 * 60 * 1000;

    const sessionCutoff = new Date(now - sessionWindowMs).toISOString();
    const weeklyCutoff = new Date(now - weeklyWindowMs).toISOString();

    const { gte, sql, and, min } = await import("drizzle-orm");

    // Fetch all active accounts
    const accounts = await app.db.select().from(upstreamAccounts);
    const accountQuotas = [];

    for (const acc of accounts) {
      // 1. Session Quota (5 hours)
      const [sessionUsage] = await app.db
        .select({
          requests: sql<number>`count(*)`,
          tokens: sql<number>`sum(coalesce(${requestLogs.inputTokens}, 0) + coalesce(${requestLogs.outputTokens}, 0))`,
        })
        .from(requestLogs)
        .where(
          and(
            eq(requestLogs.finalAccountId, acc.id),
            gte(requestLogs.timestamp, sessionCutoff),
          ),
        );

      // 2. Weekly Quota (7 days)
      const [weeklyUsage] = await app.db
        .select({
          requests: sql<number>`count(*)`,
          tokens: sql<number>`sum(coalesce(${requestLogs.inputTokens}, 0) + coalesce(${requestLogs.outputTokens}, 0))`,
        })
        .from(requestLogs)
        .where(
          and(
            eq(requestLogs.finalAccountId, acc.id),
            gte(requestLogs.timestamp, weeklyCutoff),
          ),
        );

      const sessionUsed = sessionUsage?.requests || 0;
      const weeklyUsed = weeklyUsage?.requests || 0;

      const sessionLimit = usage.sessionLimitRequests;
      const weeklyLimit = usage.weeklyLimitRequests;

      const sessionRemaining = Math.max(0, sessionLimit - sessionUsed);
      const sessionPercent = Math.round((sessionRemaining / sessionLimit) * 100);

      const weeklyRemaining = Math.max(0, weeklyLimit - weeklyUsed);
      const weeklyPercent = Math.round((weeklyRemaining / weeklyLimit) * 100);

      // These windows roll, so capacity comes back when the oldest request in
      // the window ages out — read it instead of printing a fixed string.
      const [sessionOldest] = await app.db
        .select({ ts: min(requestLogs.timestamp) })
        .from(requestLogs)
        .where(
          and(
            eq(requestLogs.finalAccountId, acc.id),
            gte(requestLogs.timestamp, sessionCutoff),
          ),
        );
      const [weeklyOldest] = await app.db
        .select({ ts: min(requestLogs.timestamp) })
        .from(requestLogs)
        .where(
          and(
            eq(requestLogs.finalAccountId, acc.id),
            gte(requestLogs.timestamp, weeklyCutoff),
          ),
        );

      const sessionResetAt = sessionOldest?.ts
        ? Date.parse(sessionOldest.ts) + sessionWindowMs
        : null;
      const weeklyResetAt = weeklyOldest?.ts
        ? Date.parse(weeklyOldest.ts) + weeklyWindowMs
        : null;

      // Breakdown over the models this account actually serves, not a fixed list.
      const accountModelRows = await app.db
        .select({ modelId: accountModels.modelId })
        .from(accountModels)
        .where(
          and(
            eq(accountModels.accountId, acc.id),
            eq(accountModels.available, true),
            eq(accountModels.excluded, false),
          ),
        );

      const modelUsages = [];
      for (const row of accountModelRows) {
        const [mSession] = await app.db
          .select({ count: sql<number>`count(*)` })
          .from(requestLogs)
          .where(
            and(
              eq(requestLogs.finalAccountId, acc.id),
              eq(requestLogs.publicModelId, row.modelId),
              gte(requestLogs.timestamp, sessionCutoff),
            ),
          );

        modelUsages.push({
          modelId: row.modelId,
          name: row.modelId,
          used: mSession?.count || 0,
        });
      }
      modelUsages.sort((a, b) => b.used - a.used || a.modelId.localeCompare(b.modelId));

      accountQuotas.push({
        accountId: acc.id,
        accountName: acc.name,
        enabled: acc.enabled,
        state: acc.state,
        tier: acc.tier || "free",
        maxConcurrency: getAccountMaxConcurrency(acc),
        session: {
          used: sessionUsed,
          limit: sessionLimit,
          remaining: sessionRemaining,
          remainingPercent: sessionPercent,
          resetText: formatResetIn(sessionResetAt),
        },
        weekly: {
          used: weeklyUsed,
          limit: weeklyLimit,
          remaining: weeklyRemaining,
          remainingPercent: weeklyPercent,
          resetText: formatResetIn(weeklyResetAt),
        },
        models: modelUsages,
      });
    }

    return reply.send({
      accounts: accountQuotas,
      // Surfaced so the UI can say these are the operator's own limits rather
      // than anything Ollama Cloud reported.
      limitsSource: "local-config" as const,
      window: {
        sessionHours: usage.sessionWindowHours,
        weeklyDays: usage.weeklyWindowDays,
      },
    });
  });

  // ── Task 053: Routing config ──
  app.get("/api/admin/routing", async (_request, reply) => {
    const [row] = await app.db.select().from(settings)
      .where(eq(settings.key, "routing_config"));
    if (row) {
      try { return reply.send(JSON.parse(row.value)); } catch { /* fall through */ }
    }
    // Return defaults
    const { DEFAULT_ROUTING_CONFIG } = await import("@ollama-proxy/shared");
    return reply.send(DEFAULT_ROUTING_CONFIG);
  });

  app.put("/api/admin/routing", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const value = JSON.stringify(body);
    const now = new Date().toISOString();

    // Upsert
    const [existing] = await app.db.select().from(settings)
      .where(eq(settings.key, "routing_config"));

    if (existing) {
      await app.db.update(settings).set({ value, updatedAt: now })
        .where(eq(settings.key, "routing_config"));
    } else {
      await app.db.insert(settings).values({ key: "routing_config", value, updatedAt: now });
    }

    return reply.send(body);
  });

  // ── Task 054: Settings ──
  app.get("/api/admin/settings", async (_request, reply) => {
    const rows = await app.db.select().from(settings);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
    }
    return reply.send(result);
  });

  app.put("/api/admin/settings", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const now = new Date().toISOString();

    for (const [key, val] of Object.entries(body)) {
      const value = typeof val === "string" ? val : JSON.stringify(val);
      const [existing] = await app.db.select().from(settings)
        .where(eq(settings.key, key));

      if (existing) {
        await app.db.update(settings).set({ value, updatedAt: now })
          .where(eq(settings.key, key));
      } else {
        await app.db.insert(settings).values({ key, value, updatedAt: now });
      }
    }

    return reply.send({ success: true });
  });
}
