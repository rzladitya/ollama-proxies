import type { FastifyInstance } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { embeddingConnections, embeddingModels } from "@ollama-proxy/storage";
import { encrypt } from "@ollama-proxy/shared";
import {
  EMBEDDING_PROVIDERS,
  getEmbeddingProvider,
} from "../../providers/embedding/registry.js";
import {
  loadEmbeddingConfig,
  saveEmbeddingConfig,
  routeEmbedding,
  NoEmbeddingConnectionError,
} from "../../providers/embedding/router.js";
import { callEmbedding } from "../../providers/embedding/client.js";

function notFound(reply: any, message: string) {
  return reply
    .code(404)
    .send({ error: { message, type: "invalid_request_error", code: "not_found" } });
}

function badRequest(reply: any, message: string) {
  return reply
    .code(400)
    .send({ error: { message, type: "invalid_request_error", code: "invalid_request" } });
}

/** Never let an encrypted credential leave the server. */
function stripKey<T extends { encryptedApiKey?: unknown }>(row: T) {
  const { encryptedApiKey, ...rest } = row;
  return rest;
}

/**
 * Write a dashboard test into request_logs so it shows up in the Console Log
 * alongside real traffic — same behaviour as the chat model test.
 */
async function persistTestTrace(
  app: FastifyInstance,
  opts: {
    start: number;
    publicModelId: string;
    connectionId?: string;
    statusCode: number;
    latencyMs: number;
    inputTokens?: number;
    errorCode?: string;
  },
): Promise<void> {
  const { RequestTrace } = await import("../../telemetry.js");
  const trace = new RequestTrace(`embtest_${Date.now()}`, opts.start);
  trace.publicModelId = opts.publicModelId;
  trace.finalAccountId = opts.connectionId;
  trace.statusCode = opts.statusCode;
  trace.latencyMs = opts.latencyMs;
  trace.ttfbMs = opts.latencyMs;
  trace.inputTokens = opts.inputTokens;
  // Embeddings produce a vector, not completion tokens.
  trace.outputTokens = 0;
  trace.errorCode = opts.errorCode;
  await trace.persist(app.db);
}

/**
 * Media Providers → Embedding admin API.
 */
export async function embeddingAdminRoutes(app: FastifyInstance): Promise<void> {
  // ── Provider grid ──
  app.get("/api/admin/embedding/providers", async (_request, reply) => {
    const counts = await app.db
      .select({
        providerId: embeddingConnections.providerId,
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${embeddingConnections.enabled} = 1 then 1 else 0 end)`,
      })
      .from(embeddingConnections)
      .groupBy(embeddingConnections.providerId);

    const byProvider = new Map(counts.map((c) => [c.providerId, c]));

    return reply.send({
      providers: EMBEDDING_PROVIDERS.map((p) => ({
        id: p.id,
        name: p.name,
        tags: p.tags,
        locked: p.locked,
        connectionCount: byProvider.get(p.id)?.active ?? 0,
      })),
    });
  });

  // ── Provider detail ──
  app.get("/api/admin/embedding/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = getEmbeddingProvider(id);
    if (!provider) return notFound(reply, `Embedding provider '${id}' not found`);

    const connections = await app.db
      .select()
      .from(embeddingConnections)
      .where(eq(embeddingConnections.providerId, id))
      .orderBy(asc(embeddingConnections.position));

    const models = await app.db
      .select()
      .from(embeddingModels)
      .where(eq(embeddingModels.providerId, id))
      .orderBy(asc(embeddingModels.publicModelId));

    const config = await loadEmbeddingConfig(app, id);

    return reply.send({
      provider: {
        id: provider.id,
        name: provider.name,
        tags: provider.tags,
        locked: provider.locked,
        endpoint: provider.endpoint,
        apiKeyUrl: provider.apiKeyUrl,
        notice: provider.notice,
      },
      connections: connections.map(stripKey),
      models,
      config,
    });
  });

  // ── Connections ──
  app.post("/api/admin/embedding/connections", async (request, reply) => {
    const body = request.body as { providerId?: string; name?: string; apiKey?: string };
    const provider = body.providerId ? getEmbeddingProvider(body.providerId) : undefined;

    if (!provider) return badRequest(reply, "providerId is required and must be a known provider");
    if (provider.locked) {
      return badRequest(reply, `Provider '${provider.name}' is not available yet`);
    }
    if (!body.name?.trim()) return badRequest(reply, "name is required");
    if (!body.apiKey?.trim()) return badRequest(reply, "apiKey is required");

    const [{ maxPosition } = { maxPosition: 0 }] = await app.db
      .select({ maxPosition: sql<number>`coalesce(max(${embeddingConnections.position}), 0)` })
      .from(embeddingConnections)
      .where(eq(embeddingConnections.providerId, provider.id));

    const id = randomUUID();
    const now = new Date().toISOString();

    await app.db.insert(embeddingConnections).values({
      id,
      providerId: provider.id,
      name: body.name.trim(),
      encryptedApiKey: encrypt(body.apiKey.trim(), app.config.encryptionKey),
      enabled: true,
      state: "ACTIVE",
      position: Number(maxPosition) + 1,
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await app.db
      .select()
      .from(embeddingConnections)
      .where(eq(embeddingConnections.id, id));
    return reply.code(201).send(stripKey(created));
  });

  app.patch("/api/admin/embedding/connections/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      apiKey?: string;
      enabled?: boolean;
      position?: number;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.enabled !== undefined) {
      updates.enabled = body.enabled;
      // Re-enabling clears a previous INVALID so the connection gets another try.
      if (body.enabled) updates.state = "ACTIVE";
    }
    if (body.position !== undefined) updates.position = body.position;
    if (body.apiKey !== undefined && body.apiKey.trim()) {
      updates.encryptedApiKey = encrypt(body.apiKey.trim(), app.config.encryptionKey);
      updates.state = "ACTIVE";
      updates.lastErrorCode = null;
    }

    await app.db
      .update(embeddingConnections)
      .set(updates)
      .where(eq(embeddingConnections.id, id));

    const [updated] = await app.db
      .select()
      .from(embeddingConnections)
      .where(eq(embeddingConnections.id, id));
    if (!updated) return notFound(reply, "Connection not found");
    return reply.send(stripKey(updated));
  });

  app.delete("/api/admin/embedding/connections/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.db.delete(embeddingConnections).where(eq(embeddingConnections.id, id));
    return reply.code(204).send();
  });

  /** Validate a credential before saving it, or re-check a saved one. */
  app.post("/api/admin/embedding/connections/test", async (request, reply) => {
    const body = request.body as { providerId?: string; apiKey?: string; connectionId?: string };
    const provider = body.providerId ? getEmbeddingProvider(body.providerId) : undefined;
    if (!provider || provider.locked) return badRequest(reply, "Unknown or unavailable provider");

    let apiKey = body.apiKey?.trim();
    if (!apiKey && body.connectionId) {
      const [row] = await app.db
        .select()
        .from(embeddingConnections)
        .where(eq(embeddingConnections.id, body.connectionId))
        .limit(1);
      if (!row) return notFound(reply, "Connection not found");
      const { decrypt } = await import("@ollama-proxy/shared");
      apiKey = decrypt(row.encryptedApiKey, app.config.encryptionKey);
    }
    if (!apiKey) return badRequest(reply, "apiKey or connectionId is required");

    const [probeModel] = await app.db
      .select()
      .from(embeddingModels)
      .where(and(eq(embeddingModels.providerId, provider.id), eq(embeddingModels.enabled, true)))
      .limit(1);

    if (!probeModel) return badRequest(reply, "No enabled model to test against");

    const start = Date.now();
    try {
      const res = await callEmbedding(
        provider.id,
        apiKey,
        { model: probeModel.upstreamModelId, input: "ping" },
        { timeoutMs: 20_000 },
      );
      return reply.send({
        success: true,
        latencyMs: Date.now() - start,
        model: probeModel.publicModelId,
        dimensions: res.data?.[0]?.embedding?.length ?? 0,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.send({
        success: false,
        latencyMs: Date.now() - start,
        error: message.slice(0, 300),
      });
    }
  });

  // ── Models ──
  app.post("/api/admin/embedding/models", async (request, reply) => {
    const body = request.body as {
      providerId?: string;
      publicModelId?: string;
      upstreamModelId?: string;
      label?: string;
    };
    const provider = body.providerId ? getEmbeddingProvider(body.providerId) : undefined;
    if (!provider || provider.locked) return badRequest(reply, "Unknown or unavailable provider");
    if (!body.publicModelId?.trim()) return badRequest(reply, "publicModelId is required");

    const publicModelId = body.publicModelId.trim();
    // Default the upstream id by stripping the provider prefix, which is how the
    // seeded catalog is shaped: openrouter/<vendor>/<model> -> <vendor>/<model>.
    const upstreamModelId =
      body.upstreamModelId?.trim() ||
      (publicModelId.startsWith(`${provider.id}/`)
        ? publicModelId.slice(provider.id.length + 1)
        : publicModelId);

    const [existing] = await app.db
      .select()
      .from(embeddingModels)
      .where(eq(embeddingModels.publicModelId, publicModelId))
      .limit(1);
    if (existing) return badRequest(reply, `Model '${publicModelId}' already exists`);

    const id = randomUUID();
    await app.db.insert(embeddingModels).values({
      id,
      providerId: provider.id,
      publicModelId,
      upstreamModelId,
      label: body.label?.trim() || publicModelId,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const [created] = await app.db.select().from(embeddingModels).where(eq(embeddingModels.id, id));
    return reply.code(201).send(created);
  });

  app.patch("/api/admin/embedding/models/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { enabled?: boolean; label?: string; upstreamModelId?: string };
    const updates: Record<string, unknown> = {};
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.label !== undefined) updates.label = body.label;
    if (body.upstreamModelId !== undefined) updates.upstreamModelId = body.upstreamModelId;

    if (Object.keys(updates).length > 0) {
      await app.db.update(embeddingModels).set(updates).where(eq(embeddingModels.id, id));
    }
    const [updated] = await app.db.select().from(embeddingModels).where(eq(embeddingModels.id, id));
    if (!updated) return notFound(reply, "Model not found");
    return reply.send(updated);
  });

  app.delete("/api/admin/embedding/models/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.db.delete(embeddingModels).where(eq(embeddingModels.id, id));
    return reply.code(204).send();
  });

  /**
   * One-click test for a single model — the embedding counterpart of
   * POST /api/admin/models/:id/test. Goes through the real connection pool so a
   * green result means the routing path works, not just the credential.
   */
  app.post("/api/admin/embedding/models/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { input?: string; dimensions?: number } | undefined) ?? {};

    const [model] = await app.db
      .select()
      .from(embeddingModels)
      .where(eq(embeddingModels.id, id))
      .limit(1);
    if (!model) return notFound(reply, "Model not found");

    const input = body.input?.trim() || "The quick brown fox jumps over the lazy dog";
    const start = Date.now();

    try {
      const result = await routeEmbedding(
        app,
        model.providerId,
        {
          model: model.upstreamModelId,
          input,
          ...(body.dimensions ? { dimensions: body.dimensions } : {}),
        },
        { timeoutMs: 30_000 },
      );

      const vector = result.response.data?.[0]?.embedding ?? [];

      // Record it like the chat model test does. Without this the Console Log
      // shows no trace of the test, and the newest visible row is some earlier
      // request — which reads as "the wrong model ran".
      await persistTestTrace(app, {
        start,
        publicModelId: model.publicModelId,
        connectionId: result.connectionId,
        statusCode: 200,
        latencyMs: result.latencyMs,
        inputTokens: result.response.usage?.prompt_tokens,
      });

      return reply.send({
        success: true,
        modelId: model.publicModelId,
        latencyMs: result.latencyMs,
        connectionName: result.connectionName,
        attempts: result.attempts,
        dimensions: vector.length,
        // Thousands of floats would swamp the response; the UI only shows a taste.
        preview: vector.slice(0, 6),
        usage: result.response.usage ?? null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const latencyMs = Date.now() - start;

      await persistTestTrace(app, {
        start,
        publicModelId: model.publicModelId,
        statusCode: 502,
        latencyMs,
        errorCode: message.slice(0, 200),
      });

      return reply.send({
        success: false,
        modelId: model.publicModelId,
        latencyMs,
        error:
          err instanceof NoEmbeddingConnectionError
            ? "No enabled connection. Add one under Connections first."
            : message.slice(0, 300),
      });
    }
  });

  // ── Config ──
  app.put("/api/admin/embedding/providers/:id/config", async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = getEmbeddingProvider(id);
    if (!provider) return notFound(reply, `Embedding provider '${id}' not found`);

    const body = request.body as { roundRobin?: boolean };
    const config = { roundRobin: Boolean(body.roundRobin) };
    await saveEmbeddingConfig(app, id, config);
    return reply.send(config);
  });

  // ── Example / Run panel ──
  app.post("/api/admin/embedding/run", async (request, reply) => {
    const body = request.body as {
      publicModelId?: string;
      input?: string;
      dimensions?: number;
    };
    if (!body.publicModelId) return badRequest(reply, "publicModelId is required");
    if (!body.input?.trim()) return badRequest(reply, "input is required");

    const [model] = await app.db
      .select()
      .from(embeddingModels)
      .where(eq(embeddingModels.publicModelId, body.publicModelId))
      .limit(1);
    if (!model) return notFound(reply, `Model '${body.publicModelId}' not found`);

    try {
      const result = await routeEmbedding(
        app,
        model.providerId,
        {
          model: model.upstreamModelId,
          input: body.input,
          ...(body.dimensions ? { dimensions: body.dimensions } : {}),
        },
        { timeoutMs: 30_000 },
      );

      const vector = result.response.data?.[0]?.embedding ?? [];
      return reply.send({
        success: true,
        latencyMs: result.latencyMs,
        connectionName: result.connectionName,
        attempts: result.attempts,
        model: body.publicModelId,
        dimensions: vector.length,
        // The full vector is thousands of floats — the panel only previews it.
        preview: vector.slice(0, 8),
        usage: result.response.usage ?? null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.send({
        success: false,
        error:
          err instanceof NoEmbeddingConnectionError
            ? "No enabled connection. Add one under Connections first."
            : message.slice(0, 300),
      });
    }
  });
}
