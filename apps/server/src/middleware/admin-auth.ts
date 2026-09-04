import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { timingSafeEqual, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { settings } from "@ollama-proxy/storage";
import { verifyPassword } from "@ollama-proxy/shared";

/**
 * Task 016: Admin auth middleware.
 * Verifies OLLAMA_PROXY_ADMIN_SECRET on all /api/admin/* routes.
 *
 * Auth via: Authorization: Bearer <admin_secret>
 *       or: X-Admin-Secret: <admin_secret>
 */

/**
 * Timing-safe string comparison to prevent side-channel attacks.
 * Both sides are hashed first so the comparison is over fixed-length buffers —
 * otherwise an early length check leaks the secret's length.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Simple in-memory brute-force protection
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED = 10;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export function checkBruteForce(ip: string): boolean {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    failedAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED;
}

export function recordFailedAttempt(ip: string): void {
  const entry = failedAttempts.get(ip);
  if (!entry || Date.now() > entry.resetAt) {
    failedAttempts.set(ip, { count: 1, resetAt: Date.now() + LOCKOUT_MS });
  } else {
    entry.count++;
  }
}

export function clearFailedAttempts(ip: string): void {
  failedAttempts.delete(ip);
}

/** Standard 429 body for a locked-out client. */
export function lockoutError() {
  return {
    error: {
      message: "Too many failed attempts — try again later",
      type: "authentication_error",
      code: "rate_limited",
    },
  };
}

/** For tests / shutdown. */
export function clearAllFailedAttempts(): void {
  failedAttempts.clear();
}

// ── Admin secret resolution ──

export const ADMIN_SECRET_SETTING_KEY = "admin_secret_hash";

/**
 * scrypt is intentionally slow (~100 ms). The dashboard polls analytics every
 * second, so verifying the stored hash on every admin request would make the UI
 * crawl. Remember the SHA-256 of a secret that already verified against this
 * exact stored hash; changing the password changes the hash and drops the entry.
 */
let verifiedCache: { storedHash: string; secretSha: Buffer } | null = null;

export function invalidateAdminSecretCache(): void {
  verifiedCache = null;
}

async function loadStoredSecretHash(app: FastifyInstance): Promise<string | null> {
  const [row] = await app.db
    .select()
    .from(settings)
    .where(eq(settings.key, ADMIN_SECRET_SETTING_KEY))
    .limit(1);
  return row?.value ?? null;
}

/** True when the admin password has been changed from the dashboard. */
export async function hasStoredAdminSecret(app: FastifyInstance): Promise<boolean> {
  return (await loadStoredSecretHash(app)) !== null;
}

/**
 * Verify a presented admin secret.
 *
 * Accepts either the password set from the dashboard or `OLLAMA_PROXY_ADMIN_SECRET`
 * from the environment. The env value is deliberately kept working as a
 * break-glass credential: it lives in a file the operator already controls, and
 * without it a forgotten dashboard password would mean hand-editing SQLite.
 * The UI says this plainly so the trade-off is not a surprise.
 */
export async function verifyAdminSecret(
  app: FastifyInstance,
  provided: string,
): Promise<boolean> {
  if (safeEqual(provided, app.config.adminSecret)) return true;

  const storedHash = await loadStoredSecretHash(app);
  if (!storedHash) return false;

  const sha = createHash("sha256").update(provided).digest();
  if (
    verifiedCache &&
    verifiedCache.storedHash === storedHash &&
    timingSafeEqual(verifiedCache.secretSha, sha)
  ) {
    return true;
  }

  if (verifyPassword(provided, storedHash)) {
    verifiedCache = { storedHash, secretSha: sha };
    return true;
  }
  return false;
}

async function adminAuthHandler(app: FastifyInstance): Promise<void> {
  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Only guard /api/admin/* routes
      if (!request.url.startsWith("/api/admin")) return;

      // The login endpoint carries its secret in the body, which is not parsed
      // yet at onRequest. It authenticates and rate-limits itself — see
      // routes/admin/misc.ts. It is NOT exempt from brute-force protection.
      if (request.url.startsWith("/api/admin/auth/login")) return;

      const ip = request.ip;
      const provided = extractSecret(request);

      // A correct secret always gets through, even while the IP is locked out.
      // Otherwise anyone can deny service to the real admin — especially behind
      // a reverse proxy, where every client shares one IP.
      if (provided && (await verifyAdminSecret(app, provided))) {
        clearFailedAttempts(ip);
        return;
      }

      if (checkBruteForce(ip)) {
        return reply.code(429).send(lockoutError());
      }

      recordFailedAttempt(ip);
      return reply.code(401).send({
        error: {
          message: "Unauthorized — invalid or missing admin secret",
          type: "authentication_error",
          code: "admin_auth_required",
        },
      });
    }
  );
}

export const adminAuthPlugin = fp(adminAuthHandler, {
  name: "admin-auth",
});

function extractSecret(request: FastifyRequest): string | undefined {
  // Check Authorization: Bearer <secret>
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  // Check X-Admin-Secret header
  const xHeader = request.headers["x-admin-secret"];
  if (typeof xHeader === "string") {
    return xHeader;
  }
  return undefined;
}
