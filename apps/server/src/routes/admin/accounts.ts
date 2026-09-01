import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  upstreamAccounts,
  accountPools,
  accountPoolMembers,
  accountModels,
  models,
} from "@ollama-proxy/storage";
import { encrypt, decrypt } from "@ollama-proxy/shared";
import { OllamaClient } from "@ollama-proxy/ollama-client";

export const FREE_TIER_MODELS = new Set([
  "gemma4:31b",
  "gpt-oss:120b",
  "gpt-oss:20b",
  "nemotron-3-nano:30b",
  "nemotron-3-super",
  "nemotron-3-ultra",
]);

/**
 * Tasks 044-048: Account CRUD + test + enable/disable + refresh-models
 */
export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const ollamaClient = new OllamaClient();

  // Task 044: GET /api/admin/accounts
  app.get("/api/admin/accounts", async (_request, reply) => {
    const rows = await app.db.select().from(upstreamAccounts);
    return reply.send(rows.map(stripEncryptedKey));
  });

  // Pre-save key test endpoint
  app.post("/api/admin/accounts/test-key", async (request, reply) => {
    const body = request.body as { apiKey: string };
    if (!body.apiKey) {
      return reply.code(400).send({
        error: { message: "apiKey required", type: "invalid_request_error", code: "invalid_request" },
      });
    }

    const start = Date.now();
    try {
      const modelList = await ollamaClient.listModels(body.apiKey.trim(), { timeoutMs: 15_000 });
      const latencyMs = Date.now() - start;
      return reply.send({
        success: true,
        modelCount: modelList.length,
        models: modelList.map((m) => m.id),
        latencyMs,
      });
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.send({ success: false, error: message.slice(0, 300), latencyMs });
    }
  });

  // Task 044: POST /api/admin/accounts
  app.post("/api/admin/accounts", async (request, reply) => {
    const body = request.body as {
      name: string;
      apiKey: string;
      tier?: "free" | "pro" | "max" | "team";
      maxConcurrency?: number;
      priority?: number;
      weight?: number;
      poolId?: string;
    };

    if (!body.name || !body.apiKey) {
      return reply.code(400).send({ error: { message: "name and apiKey required", type: "invalid_request_error", code: "invalid_request" } });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const encryptedApiKey = encrypt(body.apiKey, app.config.encryptionKey);
    const tier = body.tier || "free";

    await app.db.insert(upstreamAccounts).values({
      id,
      name: body.name,
      encryptedApiKey,
      tier,
      maxConcurrency: body.maxConcurrency ?? null,
      enabled: true,
      state: "ACTIVE",
      priority: body.priority ?? 1,
      weight: body.weight ?? 1.0,
      createdAt: now,
      updatedAt: now,
    });

    // Add to pool (default "all" pool)
    let poolId = body.poolId ?? "all";
    const [poolRow] = await app.db.select().from(accountPools).limit(1);
    if (poolRow && poolId === "all") {
      poolId = poolRow.id;
    }

    await app.db.insert(accountPoolMembers).values({
      poolId,
      accountId: id,
      enabled: true,
    }).onConflictDoNothing();

    // Auto-sync initial models for this account based on tier
    try {
      const upstreamModels = await ollamaClient.listModels(body.apiKey.trim(), { timeoutMs: 15_000 });
      for (const um of upstreamModels) {
        const isAllowed = tier === "pro" || FREE_TIER_MODELS.has(um.id);
        if (!isAllowed) continue; // Skip non-free models on free tier

        const [existing] = await app.db.select().from(models).where(eq(models.publicModelId, um.id)).limit(1);
        if (!existing) {
          await app.db.insert(models).values({
            id: um.id,
            publicModelId: um.id,
            upstreamModelId: um.id,
            enabled: true,
            createdAt: now,
            updatedAt: now,
          });
        }

        await app.db.insert(accountModels).values({
          accountId: id,
          modelId: um.id,
          available: true,
          excluded: false,
          lastCheckedAt: now,
        }).onConflictDoNothing();
      }
    } catch {
      // ignore initial sync errors
    }

    const [created] = await app.db.select().from(upstreamAccounts).where(eq(upstreamAccounts.id, id));
    return reply.code(201).send(stripEncryptedKey(created));
  });

  // Task 045: GET /api/admin/accounts/:id
  app.get("/api/admin/accounts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await app.db.select().from(upstreamAccounts).where(eq(upstreamAccounts.id, id));
    if (!row) return reply.code(404).send({ error: { message: "Account not found", type: "invalid_request_error", code: "not_found" } });
    return reply.send(stripEncryptedKey(row));
  });

  // Task 045: PATCH /api/admin/accounts/:id
  app.patch("/api/admin/accounts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (body.name !== undefined) updates.name = body.name;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.weight !== undefined) updates.weight = body.weight;
    if (body.tier !== undefined) updates.tier = body.tier;
    if (body.maxConcurrency !== undefined) updates.maxConcurrency = body.maxConcurrency;
    if (body.apiKey !== undefined) {
      updates.encryptedApiKey = encrypt(body.apiKey as string, app.config.encryptionKey);
    }

    await app.db.update(upstreamAccounts).set(updates).where(eq(upstreamAccounts.id, id));
    const [updated] = await app.db.select().from(upstreamAccounts).where(eq(upstreamAccounts.id, id));
    if (!updated) return reply.code(404).send({ error: { message: "Account not found", type: "invalid_request_error", code: "not_found" } });
    return reply.send(stripEncryptedKey(updated));
  });

  // Task 045: DELETE /api/admin/accounts/:id
  app.delete("/api/admin/accounts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    // Get model IDs associated with this account before deleting
    const accountModelRows = await app.db
      .select({ modelId: accountModels.modelId })
      .from(accountModels)
      .where(eq(accountModels.accountId, id));

    // Delete account (cascades to account_models & account_pool_members)
    await app.db.delete(upstreamAccounts).where(eq(upstreamAccounts.id, id));

    // Clean up orphan models not backed by any other active account
    for (const am of accountModelRows) {
      const [remaining] = await app.db
        .select({ modelId: accountModels.modelId })
        .from(accountModels)
        .where(eq(accountModels.modelId, am.modelId))
        .limit(1);

      if (!remaining) {
        await app.db.delete(models).where(eq(models.publicModelId, am.modelId));
      }
    }

    return reply.code(204).send();
  });

  // Task 046: POST /api/admin/accounts/:id/test
  app.post("/api/admin/accounts/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await app.db.select().from(upstreamAccounts).where(eq(upstreamAccounts.id, id));
    if (!row) return reply.code(404).send({ error: { message: "Account not found", type: "invalid_request_error", code: "not_found" } });

    const start = Date.now();
    try {
      const apiKey = decrypt(row.encryptedApiKey, app.config.encryptionKey);
      const modelList = await ollamaClient.listModels(apiKey, { timeoutMs: 15_000 });
      const latencyMs = Date.now() - start;

      await app.db.update(upstreamAccounts).set({
        lastSuccessAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(upstreamAccounts.id, id));

      return reply.send({ success: true, modelCount: modelList.length, latencyMs });
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : "Unknown error";

      await app.db.update(upstreamAccounts).set({
        lastErrorAt: new Date().toISOString(),
        lastErrorCode: message.slice(0, 200),
        updatedAt: new Date().toISOString(),
      }).where(eq(upstreamAccounts.id, id));

      return reply.send({ success: false, error: message.slice(0, 200), latencyMs });
    }
  });

  // Task 047: POST /api/admin/accounts/:id/enable
  app.post("/api/admin/accounts/:id/enable", async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.db.update(upstreamAccounts).set({
      enabled: true, state: "ACTIVE", updatedAt: new Date().toISOString(),
    }).where(eq(upstreamAccounts.id, id));
    return reply.send({ success: true });
  });

  // Task 047: POST /api/admin/accounts/:id/disable
  app.post("/api/admin/accounts/:id/disable", async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.db.update(upstreamAccounts).set({
      enabled: false, state: "DISABLED", updatedAt: new Date().toISOString(),
    }).where(eq(upstreamAccounts.id, id));
    return reply.send({ success: true });
  });

  // Task 048: POST /api/admin/accounts/:id/refresh-models
  app.post("/api/admin/accounts/:id/refresh-models", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await app.db.select().from(upstreamAccounts).where(eq(upstreamAccounts.id, id));
    if (!row) return reply.code(404).send({ error: { message: "Account not found", type: "invalid_request_error", code: "not_found" } });

    try {
      const apiKey = decrypt(row.encryptedApiKey, app.config.encryptionKey);
      const upstreamModels = await ollamaClient.listModels(apiKey, { timeoutMs: 15_000 });

      const now = new Date().toISOString();
      let added = 0;

      // Filter out tier-restricted models based on account tier
      const accountTier = row.tier || "free";

      for (const um of upstreamModels) {
        const isAllowed = accountTier === "pro" || FREE_TIER_MODELS.has(um.id);
        if (!isAllowed) continue;

        // Ensure model exists in models table
        const [existing] = await app.db.select().from(models)
          .where(eq(models.publicModelId, um.id)).limit(1);

        if (!existing) {
          await app.db.insert(models).values({
            id: um.id,
            publicModelId: um.id,
            upstreamModelId: um.id,
            enabled: true,
            createdAt: now,
            updatedAt: now,
          });
        }

        // Upsert account_models
        const [existingAm] = await app.db.select().from(accountModels)
          .where(and(eq(accountModels.accountId, id), eq(accountModels.modelId, um.id)))
          .limit(1);

        if (!existingAm) {
          await app.db.insert(accountModels).values({
            accountId: id,
            modelId: um.id,
            available: true,
            excluded: false,
            lastCheckedAt: now,
          });
          added++;
        } else {
          await app.db.update(accountModels).set({
            available: true,
            lastCheckedAt: now,
          }).where(and(eq(accountModels.accountId, id), eq(accountModels.modelId, um.id)));
        }
      }

      await app.db.update(upstreamAccounts).set({
        lastSuccessAt: now, updatedAt: now,
      }).where(eq(upstreamAccounts.id, id));

      return reply.send({ success: true, totalModels: upstreamModels.length, newModels: added });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.code(502).send({ success: false, error: message.slice(0, 200) });
    }
  });
}

function stripEncryptedKey(row: any): any {
  if (!row) return row;
  const { encryptedApiKey, ...rest } = row;
  return rest;
}
