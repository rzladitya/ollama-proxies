import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { hashSecret } from "@ollama-proxy/shared";
import { eq, and, isNull } from "drizzle-orm";
import { proxyApiKeys, proxyKeyModels } from "@ollama-proxy/storage";

/**
 * Task 025: Proxy key auth middleware.
 * Guards /v1/* routes. Parses Authorization: Bearer sk-proxy-...,
 * verifies hash, loads key config (pool, model allowlist, limits).
 * Enforces RPM rate limit and concurrency limit.
 */

export interface ProxyKeyInfo {
  id: string;
  name: string;
  poolId: string;
  rpmLimit: number | null;
  concurrencyLimit: number | null;
  /** null = all models allowed, otherwise set of allowed publicModelIds */
  allowedModels: Set<string> | null;
}

// ── Rate limit + concurrency state (single-process, in-memory) ──
// ponytail: global maps, per-key Redis counters if multi-instance needed

/** Sliding window RPM: stores request timestamps per key ID */
const rpmWindows = new Map<string, number[]>();
/** Active concurrent requests per key ID */
const concurrencyCounters = new Map<string, number>();

const RPM_WINDOW_MS = 60_000;

function checkRpm(keyId: string, limit: number): boolean {
  const now = Date.now();
  const cutoff = now - RPM_WINDOW_MS;
  let timestamps = rpmWindows.get(keyId);
  if (!timestamps) {
    timestamps = [];
    rpmWindows.set(keyId, timestamps);
  }
  // Prune expired
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  return true;
}

function getConcurrency(keyId: string): number {
  return concurrencyCounters.get(keyId) ?? 0;
}

export function incrementConcurrency(keyId: string): void {
  concurrencyCounters.set(keyId, getConcurrency(keyId) + 1);
}

export function decrementConcurrency(keyId: string): void {
  const current = getConcurrency(keyId);
  if (current <= 1) {
    concurrencyCounters.delete(keyId);
  } else {
    concurrencyCounters.set(keyId, current - 1);
  }
}

declare module "fastify" {
  interface FastifyRequest {
    proxyKey?: ProxyKeyInfo;
  }
}

async function proxyKeyAuthHandler(app: FastifyInstance): Promise<void> {
  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.url.startsWith("/v1/")) return;

      const bearer = request.headers.authorization;
      if (!bearer?.startsWith("Bearer ")) {
        return reply.code(401).send({
          error: {
            message: "Missing API key — provide Authorization: Bearer sk-proxy-...",
            type: "authentication_error",
            code: "invalid_api_key",
          },
        });
      }

      const secret = bearer.slice(7);
      if (!secret.startsWith("sk-proxy-")) {
        return reply.code(401).send({
          error: {
            message: "Invalid API key format",
            type: "authentication_error",
            code: "invalid_api_key",
          },
        });
      }

      const hash = hashSecret(secret);
      const db = app.db;

      // Look up key by hash, must be enabled and not revoked
      const [row] = await db
        .select()
        .from(proxyApiKeys)
        .where(
          and(
            eq(proxyApiKeys.secretHash, hash),
            eq(proxyApiKeys.enabled, true),
            isNull(proxyApiKeys.revokedAt),
          ),
        )
        .limit(1);

      if (!row) {
        return reply.code(401).send({
          error: {
            message: "Invalid or revoked API key",
            type: "authentication_error",
            code: "invalid_api_key",
          },
        });
      }

      // ── Enforce concurrency limit ──
      if (row.concurrencyLimit != null && row.concurrencyLimit > 0) {
        if (getConcurrency(row.id) >= row.concurrencyLimit) {
          return reply.code(429).send({
            error: {
              message: `Concurrency limit exceeded (max ${row.concurrencyLimit})`,
              type: "server_error",
              code: "rate_limit_exceeded",
            },
          });
        }
      }

      // ── Enforce RPM limit ──
      if (row.rpmLimit != null && row.rpmLimit > 0) {
        if (!checkRpm(row.id, row.rpmLimit)) {
          return reply.code(429).send({
            error: {
              message: `Rate limit exceeded (max ${row.rpmLimit} requests/minute)`,
              type: "server_error",
              code: "rate_limit_exceeded",
            },
          });
        }
      }

      // Load model allowlist
      const modelRows = await db
        .select()
        .from(proxyKeyModels)
        .where(
          and(
            eq(proxyKeyModels.proxyKeyId, row.id),
            eq(proxyKeyModels.allowed, true),
          ),
        );

      const allowedModels =
        modelRows.length > 0
          ? new Set(modelRows.map((m) => m.publicModelId))
          : null; // null = all models

      // Update last used
      await db
        .update(proxyApiKeys)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(proxyApiKeys.id, row.id));

      request.proxyKey = {
        id: row.id,
        name: row.name,
        poolId: row.poolId,
        rpmLimit: row.rpmLimit,
        concurrencyLimit: row.concurrencyLimit,
        allowedModels,
      };
    },
  );
}

export const proxyKeyAuthPlugin = fp(proxyKeyAuthHandler, {
  name: "proxy-key-auth",
});
