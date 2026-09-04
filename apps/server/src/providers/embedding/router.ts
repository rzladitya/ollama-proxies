import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { embeddingConnections, embeddingModels, settings } from "@ollama-proxy/storage";
import { decrypt } from "@ollama-proxy/shared";
import {
  callEmbedding,
  classifyEmbeddingStatus,
  EmbeddingUpstreamError,
  type EmbeddingRequest,
  type EmbeddingResponse,
} from "./client.js";

export interface EmbeddingConfig {
  /** Rotate across connections instead of always using the highest-priority one. */
  roundRobin: boolean;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = { roundRobin: false };

const CONFIG_KEY_PREFIX = "embedding_config:";

export async function loadEmbeddingConfig(
  app: FastifyInstance,
  providerId: string,
): Promise<EmbeddingConfig> {
  const [row] = await app.db
    .select()
    .from(settings)
    .where(eq(settings.key, `${CONFIG_KEY_PREFIX}${providerId}`))
    .limit(1);

  if (row) {
    try {
      return { ...DEFAULT_EMBEDDING_CONFIG, ...(JSON.parse(row.value) as Partial<EmbeddingConfig>) };
    } catch {
      /* malformed — fall through */
    }
  }
  return DEFAULT_EMBEDDING_CONFIG;
}

export async function saveEmbeddingConfig(
  app: FastifyInstance,
  providerId: string,
  config: EmbeddingConfig,
): Promise<void> {
  const key = `${CONFIG_KEY_PREFIX}${providerId}`;
  const value = JSON.stringify(config);
  const now = new Date().toISOString();
  const [existing] = await app.db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (existing) {
    await app.db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key));
  } else {
    await app.db.insert(settings).values({ key, value, updatedAt: now });
  }
}

// Round-robin cursor per provider. In-memory and single-process, like the chat
// router's counters — move to Redis alongside those if this ever scales out.
const rrCursor = new Map<string, number>();

export function resetRoundRobin(): void {
  rrCursor.clear();
}

export interface EmbeddingRouteResult {
  response: EmbeddingResponse;
  connectionId: string;
  connectionName: string;
  attempts: number;
  latencyMs: number;
}

export class NoEmbeddingConnectionError extends Error {
  constructor(providerId: string) {
    super(`No enabled connection configured for embedding provider '${providerId}'`);
    this.name = "NoEmbeddingConnectionError";
  }
}

/**
 * Resolve a public model id to its upstream id.
 * Returns null when the model is unknown or disabled.
 */
export async function resolveEmbeddingModel(
  app: FastifyInstance,
  publicModelId: string,
): Promise<{ providerId: string; upstreamModelId: string } | null> {
  const [row] = await app.db
    .select()
    .from(embeddingModels)
    .where(and(eq(embeddingModels.publicModelId, publicModelId), eq(embeddingModels.enabled, true)))
    .limit(1);

  if (!row) return null;
  return { providerId: row.providerId, upstreamModelId: row.upstreamModelId };
}

/**
 * Send an embeddings request through the provider's connection pool.
 *
 * Tries each enabled connection at most once. A credential that comes back
 * 401/403 is marked INVALID so the dashboard shows why it stopped being used,
 * and the next connection is tried immediately.
 */
export async function routeEmbedding(
  app: FastifyInstance,
  providerId: string,
  request: EmbeddingRequest,
  options?: { timeoutMs?: number },
): Promise<EmbeddingRouteResult> {
  const connections = await app.db
    .select()
    .from(embeddingConnections)
    .where(and(eq(embeddingConnections.providerId, providerId), eq(embeddingConnections.enabled, true)))
    .orderBy(asc(embeddingConnections.position));

  const usable = connections.filter((c) => c.state !== "DISABLED");
  if (usable.length === 0) throw new NoEmbeddingConnectionError(providerId);

  const config = await loadEmbeddingConfig(app, providerId);

  // With round-robin on, start at the next cursor position and wrap; otherwise
  // always start at the highest-priority connection.
  let order = usable;
  if (config.roundRobin && usable.length > 1) {
    const start = (rrCursor.get(providerId) ?? 0) % usable.length;
    rrCursor.set(providerId, start + 1);
    order = [...usable.slice(start), ...usable.slice(0, start)];
  }

  const startedAt = Date.now();
  let lastError: unknown;
  let attempts = 0;

  for (const conn of order) {
    attempts++;
    const now = new Date().toISOString();
    try {
      const apiKey = decrypt(conn.encryptedApiKey, app.config.encryptionKey);
      const response = await callEmbedding(providerId, apiKey, request, {
        timeoutMs: options?.timeoutMs ?? 30_000,
      });

      await app.db
        .update(embeddingConnections)
        .set({ state: "ACTIVE", lastSuccessAt: now, lastErrorCode: null, updatedAt: now })
        .where(eq(embeddingConnections.id, conn.id));

      return {
        response,
        connectionId: conn.id,
        connectionName: conn.name,
        attempts,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err: unknown) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof EmbeddingUpstreamError ? err.statusCode : 0;
      const { retryable, invalidatesKey } = classifyEmbeddingStatus(status);

      await app.db
        .update(embeddingConnections)
        .set({
          state: invalidatesKey ? "INVALID" : conn.state,
          lastErrorAt: now,
          lastErrorCode: message.slice(0, 200),
          updatedAt: now,
        })
        .where(eq(embeddingConnections.id, conn.id));

      // A bad request (400 — unknown model, malformed input) will fail the same
      // way on every connection, so stop rather than burn the whole pool.
      if (!retryable) break;
    }
  }

  throw lastError ?? new NoEmbeddingConnectionError(providerId);
}
