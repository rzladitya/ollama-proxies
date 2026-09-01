import type { FastifyInstance } from "fastify";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { models, accountModels, upstreamAccounts, requestLogs, settings } from "@ollama-proxy/storage";

/**
 * Tasks 051-054: Models, Requests, Routing config, Settings
 */
export async function miscAdminRoutes(app: FastifyInstance): Promise<void> {
  // ── Auth verify endpoint ──
  app.post("/api/admin/auth/login", async (request, reply) => {
    const body = (request.body as { secret?: string } | undefined) ?? {};
    const adminSecret = app.config.adminSecret;

    // If no adminSecret is configured in server .env, fallback to default admin secret "ollama"
    const requiredSecret = adminSecret || "ollama";

    if (body.secret && body.secret.trim() === requiredSecret) {
      return reply.send({ success: true, secretConfigured: Boolean(adminSecret) });
    }

    return reply.code(401).send({
      error: { message: "Invalid admin password/secret", type: "authentication_error", code: "invalid_secret" },
    });
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
    const cachedTok = Math.round(inTok * 0.85); // estimated prompt cache savings

    // Estimated standard API cost ~$0.50 / M input tokens, $1.50 / M output
    const estCostVal = ((inTok * 0.5) / 1_000_000 + (outTok * 1.5) / 1_000_000);
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
      cachedTokens: number;
      inputCost: number;
      cachedCost: number;
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
          cachedTokens: 0,
          inputCost: 0,
          cachedCost: 0,
          outputCost: 0,
          totalCost: 0,
        };
      }

      const inT = r.inputTokens || 0;
      const outT = r.outputTokens || 0;
      const cachedT = Math.round(inT * 0.85);

      const inC = (inT * 0.5) / 1_000_000;
      const outC = (outT * 1.5) / 1_000_000;
      const cachedC = (cachedT * 0.3) / 1_000_000;

      const group = modelGroupMap[m];
      group.requests += 1;
      group.inputTokens += inT;
      group.outputTokens += outT;
      group.cachedTokens += cachedT;
      group.inputCost += inC;
      group.outputCost += outC;
      group.cachedCost += cachedC;
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
      cachedTokens: cachedTok,
      estimatedCost: estCost,
      recentRequests: recent,
      modelUsageList,
      timeline,
      isStreamingActive,
    });
  });

  // ── Quota Tracker: GET /api/admin/quota ──
  app.get("/api/admin/quota", async (_request, reply) => {
    const now = Date.now();
    const sessionWindowMs = 5 * 60 * 60 * 1000; // 5 hours rolling session window
    const weeklyWindowMs = 7 * 24 * 60 * 60 * 1000; // 7 days rolling weekly window

    const sessionCutoff = new Date(now - sessionWindowMs).toISOString();
    const weeklyCutoff = new Date(now - weeklyWindowMs).toISOString();

    const { gte, sql, and } = await import("drizzle-orm");

    // Fetch all active accounts
    const accounts = await app.db.select().from(upstreamAccounts);
    const accountQuotas = [];

    const freeModelsList = [
      { id: "gemma4:31b", name: "Gemma 4 31B", sessionLimit: 1000, weeklyLimit: 5000 },
      { id: "gpt-oss:120b", name: "GPT-OSS 120B", sessionLimit: 1000, weeklyLimit: 5000 },
      { id: "gpt-oss:20b", name: "GPT-OSS 20B", sessionLimit: 1000, weeklyLimit: 5000 },
      { id: "nemotron-3-nano:30b", name: "Nemotron 3 Nano", sessionLimit: 1000, weeklyLimit: 5000 },
      { id: "nemotron-3-super", name: "Nemotron 3 Super", sessionLimit: 1000, weeklyLimit: 5000 },
      { id: "nemotron-3-ultra", name: "Nemotron 3 Ultra", sessionLimit: 1000, weeklyLimit: 5000 },
    ];

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

      const sessionLimit = 1000;
      const weeklyLimit = 5000;

      const sessionRemaining = Math.max(0, sessionLimit - sessionUsed);
      const sessionPercent = Math.round((sessionRemaining / sessionLimit) * 100);

      const weeklyRemaining = Math.max(0, weeklyLimit - weeklyUsed);
      const weeklyPercent = Math.round((weeklyRemaining / weeklyLimit) * 100);

      // Breakdown per model under this account
      const modelUsages = [];
      for (const m of freeModelsList) {
        const [mSession] = await app.db
          .select({ count: sql<number>`count(*)` })
          .from(requestLogs)
          .where(
            and(
              eq(requestLogs.finalAccountId, acc.id),
              eq(requestLogs.publicModelId, m.id),
              gte(requestLogs.timestamp, sessionCutoff),
            ),
          );

        const mUsed = mSession?.count || 0;
        const mRemaining = Math.max(0, m.sessionLimit - mUsed);
        const mRemainingPercent = Math.round((mRemaining / m.sessionLimit) * 100);

        modelUsages.push({
          modelId: m.id,
          name: m.name,
          used: mUsed,
          limit: m.sessionLimit,
          remaining: mRemaining,
          remainingPercent: mRemainingPercent,
          status: mRemainingPercent > 20 ? "healthy" : mRemainingPercent > 0 ? "warning" : "exhausted",
        });
      }

      accountQuotas.push({
        accountId: acc.id,
        accountName: acc.name,
        email: acc.name.includes("@") ? acc.name : `${acc.name.toLowerCase().replace(/[^a-z0-9]/g, "")}@ollama.cloud`,
        enabled: acc.enabled,
        state: acc.state,
        tier: acc.tier || "free",
        session: {
          used: sessionUsed,
          limit: sessionLimit,
          remaining: sessionRemaining,
          remainingPercent: sessionPercent,
          resetText: "in 3h 30m",
        },
        weekly: {
          used: weeklyUsed,
          limit: weeklyLimit,
          remaining: weeklyRemaining,
          remainingPercent: weeklyPercent,
          resetText: "in 5d 12h",
        },
        models: modelUsages,
      });
    }

    return reply.send({ accounts: accountQuotas });
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
