import type { FastifyInstance } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { proxyApiKeys, proxyKeyModels, accountPools } from "@ollama-proxy/storage";
import { generateProxyKey } from "@ollama-proxy/shared";

/**
 * Task 050: API key CRUD + revoke
 */
export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/api-keys", async (_request, reply) => {
    const rows = await app.db.select({
      id: proxyApiKeys.id,
      name: proxyApiKeys.name,
      keyPrefix: proxyApiKeys.keyPrefix,
      enabled: proxyApiKeys.enabled,
      poolId: proxyApiKeys.poolId,
      rpmLimit: proxyApiKeys.rpmLimit,
      concurrencyLimit: proxyApiKeys.concurrencyLimit,
      createdAt: proxyApiKeys.createdAt,
      lastUsedAt: proxyApiKeys.lastUsedAt,
      revokedAt: proxyApiKeys.revokedAt,
    }).from(proxyApiKeys);
    return reply.send(rows);
  });

  app.post("/api/admin/api-keys", async (request, reply) => {
    const body = request.body as {
      name: string;
      poolId?: string;
      rpmLimit?: number;
      concurrencyLimit?: number;
      allowedModels?: string[];
    };

    if (!body.name) {
      return reply.code(400).send({ error: { message: "name required", type: "invalid_request_error", code: "invalid_request" } });
    }

    const id = randomUUID();
    const key = generateProxyKey();
    const now = new Date().toISOString();

    // Resolve pool ID
    let poolId = body.poolId ?? "all";
    const [poolRow] = await app.db.select().from(accountPools).limit(1);
    if (poolRow && poolId === "all") {
      poolId = poolRow.id;
    }

    await app.db.insert(proxyApiKeys).values({
      id,
      name: body.name,
      keyPrefix: key.keyPrefix,
      secretHash: key.secretHash,
      enabled: true,
      poolId,
      rpmLimit: body.rpmLimit ?? null,
      concurrencyLimit: body.concurrencyLimit ?? null,
      createdAt: now,
    });

    // Insert model allowlist if provided
    if (body.allowedModels?.length) {
      for (const modelId of body.allowedModels) {
        await app.db.insert(proxyKeyModels).values({
          proxyKeyId: id, publicModelId: modelId, allowed: true,
        });
      }
    }

    // Show secret ONCE
    return reply.code(201).send({
      id,
      name: body.name,
      keyPrefix: key.keyPrefix,
      secret: key.secret, // shown once, never again
      poolId: body.poolId ?? "all",
      createdAt: now,
    });
  });

  app.patch("/api/admin/api-keys/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.rpmLimit !== undefined) updates.rpmLimit = body.rpmLimit;
    if (body.concurrencyLimit !== undefined) updates.concurrencyLimit = body.concurrencyLimit;

    if (Object.keys(updates).length > 0) {
      await app.db.update(proxyApiKeys).set(updates).where(eq(proxyApiKeys.id, id));
    }

    const [updated] = await app.db.select({
      id: proxyApiKeys.id,
      name: proxyApiKeys.name,
      keyPrefix: proxyApiKeys.keyPrefix,
      enabled: proxyApiKeys.enabled,
      poolId: proxyApiKeys.poolId,
      rpmLimit: proxyApiKeys.rpmLimit,
      concurrencyLimit: proxyApiKeys.concurrencyLimit,
      createdAt: proxyApiKeys.createdAt,
      lastUsedAt: proxyApiKeys.lastUsedAt,
      revokedAt: proxyApiKeys.revokedAt,
    }).from(proxyApiKeys).where(eq(proxyApiKeys.id, id));

    if (!updated) return reply.code(404).send({ error: { message: "API key not found", type: "invalid_request_error", code: "not_found" } });
    return reply.send(updated);
  });

  app.delete("/api/admin/api-keys/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.db.delete(proxyApiKeys).where(eq(proxyApiKeys.id, id));
    return reply.code(204).send();
  });

  // Task 050: POST /api/admin/api-keys/:id/revoke
  app.post("/api/admin/api-keys/:id/revoke", async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.db.update(proxyApiKeys).set({
      enabled: false,
      revokedAt: new Date().toISOString(),
    }).where(eq(proxyApiKeys.id, id));
    return reply.send({ success: true });
  });
}
