import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { timingSafeEqual } from "node:crypto";

/**
 * Task 016: Admin auth middleware.
 * Verifies OLLAMA_PROXY_ADMIN_SECRET on all /api/admin/* routes.
 *
 * Auth via: Authorization: Bearer <admin_secret>
 *       or: X-Admin-Secret: <admin_secret>
 */

/** Timing-safe string comparison to prevent side-channel attacks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Simple in-memory brute-force protection
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED = 10;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function checkBruteForce(ip: string): boolean {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    failedAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED;
}

function recordFailedAttempt(ip: string): void {
  const entry = failedAttempts.get(ip);
  if (!entry || Date.now() > entry.resetAt) {
    failedAttempts.set(ip, { count: 1, resetAt: Date.now() + LOCKOUT_MS });
  } else {
    entry.count++;
  }
}

function clearFailedAttempts(ip: string): void {
  failedAttempts.delete(ip);
}

async function adminAuthHandler(app: FastifyInstance): Promise<void> {
  const requiredSecret = app.config.adminSecret;

  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Only guard /api/admin/* routes, allow login endpoint
      if (!request.url.startsWith("/api/admin")) return;
      if (request.url.startsWith("/api/admin/auth/login")) return;

      const ip = request.ip;
      if (checkBruteForce(ip)) {
        return reply.code(429).send({
          error: {
            message: "Too many failed attempts — try again later",
            type: "authentication_error",
            code: "rate_limited",
          },
        });
      }

      const provided = extractSecret(request);
      if (!provided || !safeEqual(provided, requiredSecret)) {
        recordFailedAttempt(ip);
        return reply.code(401).send({
          error: {
            message: "Unauthorized — invalid or missing admin secret",
            type: "authentication_error",
            code: "admin_auth_required",
          },
        });
      }

      clearFailedAttempts(ip);
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
