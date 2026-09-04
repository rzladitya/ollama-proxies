import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@ollama-proxy/storage";
import { embeddingModels } from "@ollama-proxy/storage";
import { OPENROUTER_SEED_MODELS } from "./registry.js";

/**
 * Seed the OpenRouter embedding catalog on first boot.
 *
 * Idempotent, and deliberately insert-only: a model the operator deleted from
 * the dashboard must stay deleted, so this never re-adds or overwrites rows that
 * already carry a decision.
 */
export async function seedEmbeddingCatalog(db: AppDatabase): Promise<number> {
  const existing = await db
    .select({ publicModelId: embeddingModels.publicModelId })
    .from(embeddingModels)
    .where(eq(embeddingModels.providerId, "openrouter"));

  // Only seed a provider that has never been set up. Once there is any row for
  // it, the catalog belongs to the operator.
  if (existing.length > 0) return 0;

  const now = new Date().toISOString();
  for (const m of OPENROUTER_SEED_MODELS) {
    await db.insert(embeddingModels).values({
      id: randomUUID(),
      providerId: "openrouter",
      publicModelId: m.publicModelId,
      upstreamModelId: m.upstreamModelId,
      label: m.label,
      enabled: true,
      createdAt: now,
    });
  }
  return OPENROUTER_SEED_MODELS.length;
}
