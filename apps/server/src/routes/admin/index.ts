import type { FastifyInstance } from "fastify";
import { accountRoutes } from "./accounts.js";
import { poolRoutes } from "./pools.js";
import { apiKeyRoutes } from "./api-keys.js";
import { miscAdminRoutes } from "./misc.js";

/**
 * Phase 8: Admin API — registers all /api/admin/* routes.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(accountRoutes);
  await app.register(poolRoutes);
  await app.register(apiKeyRoutes);
  await app.register(miscAdminRoutes);
}
