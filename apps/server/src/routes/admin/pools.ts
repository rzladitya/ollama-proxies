import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { accountPools, accountPoolMembers } from "@ollama-proxy/storage";

/**
 * Task 049: Pool CRUD
 */
export async function poolRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/pools", async (_request, reply) => {
    const rows = await app.db.select().from(accountPools);
    return reply.send(rows);
  });

  app.post("/api/admin/pools", async (request, reply) => {
    const body = request.body as { name: string; description?: string };
    if (!body.name) {
      return reply.code(400).send({ error: { message: "name required", type: "invalid_request_error", code: "invalid_request" } });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    await app.db.insert(accountPools).values({
      id, name: body.name, description: body.description ?? null,
      createdAt: now, updatedAt: now,
    });

    const [created] = await app.db.select().from(accountPools).where(eq(accountPools.id, id));
    return reply.code(201).send(created);
  });

  app.patch("/api/admin/pools/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;

    await app.db.update(accountPools).set(updates).where(eq(accountPools.id, id));
    const [updated] = await app.db.select().from(accountPools).where(eq(accountPools.id, id));
    if (!updated) return reply.code(404).send({ error: { message: "Pool not found", type: "invalid_request_error", code: "not_found" } });
    return reply.send(updated);
  });

  app.delete("/api/admin/pools/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === "all") {
      return reply.code(400).send({ error: { message: "Cannot delete default pool", type: "invalid_request_error", code: "invalid_request" } });
    }
    await app.db.delete(accountPools).where(eq(accountPools.id, id));
    return reply.code(204).send();
  });

  // Pool members management
  app.get("/api/admin/pools/:id/members", async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await app.db.select().from(accountPoolMembers)
      .where(eq(accountPoolMembers.poolId, id));
    return reply.send(rows);
  });

  app.post("/api/admin/pools/:id/members", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { accountId: string };
    if (!body.accountId) {
      return reply.code(400).send({ error: { message: "accountId required", type: "invalid_request_error", code: "invalid_request" } });
    }

    await app.db.insert(accountPoolMembers).values({
      poolId: id, accountId: body.accountId, enabled: true,
    }).onConflictDoNothing();

    return reply.code(201).send({ success: true });
  });
}
