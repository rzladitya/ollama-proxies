import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig } from "./config/env.js";
import {
  createDatabase,
  runMigrations,
  bootstrapDefaults,
  backupDatabase,
  reencryptApiKeys,
  type AppDatabase,
} from "@ollama-proxy/storage";
import { adminAuthPlugin } from "./middleware/admin-auth.js";
import { proxyKeyAuthPlugin } from "./middleware/proxy-key-auth.js";
import { openaiRoutes, markShutdown, isShuttingDown, destroyRoutingState } from "./routes/v1.js";
import { embeddingRoutes } from "./routes/embeddings.js";
import { adminRoutes } from "./routes/admin/index.js";
import { seedEmbeddingCatalog } from "./providers/embedding/bootstrap.js";
import { startLogRetentionCleanup, startAccountHealthCheckScheduler } from "./telemetry.js";

// ── Fastify type augmentation ──
declare module "fastify" {
  interface FastifyInstance {
    db: AppDatabase;
    config: AppConfig;
  }
}

const config = loadConfig();

// ── Pre-flight: validate encryption key before anything touches the DB ──
try {
  const { encrypt, decrypt } = await import("@ollama-proxy/shared");
  const probe = encrypt("startup-probe", config.encryptionKey);
  decrypt(probe, config.encryptionKey);
} catch (err) {
  console.error("[FATAL] Encryption key validation failed. Cannot start.");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

// ── Database ──
const dbPath = resolve(config.dataDir, "ollama-proxy.db");

// Auto-backup existing DB before migrations
const backupPath = backupDatabase(dbPath);
if (backupPath) {
  console.log(`[startup] Database backed up to ${backupPath}`);
}

const { db, sqlite } = createDatabase(dbPath);
runMigrations(sqlite);

// Re-encrypt API keys from legacy SHA-256 KDF to scrypt (idempotent)
const reencryptResult = reencryptApiKeys(sqlite, config.encryptionKey);
if (reencryptResult.migrated > 0) {
  console.log(`[startup] Re-encrypted ${reencryptResult.migrated} API key(s) from legacy KDF`);
}
if (reencryptResult.failed > 0) {
  console.error(`[startup] WARNING: ${reencryptResult.failed} API key(s) failed re-encryption — check logs`);
}

await bootstrapDefaults(db);

// Media Providers → Embedding: OpenRouter lists no embedding models via its API,
// so the catalog ships as a seed the operator can then curate.
const seededEmbeddingModels = await seedEmbeddingCatalog(db);
if (seededEmbeddingModels > 0) {
  console.log(`[startup] Seeded ${seededEmbeddingModels} embedding model(s) for OpenRouter`);
}

// ── Fastify ──
const app = Fastify({
  logger: {
    level: config.logLevel,
  },
  bodyLimit: 1_048_576, // 1 MiB max request body
  // Without this, request.ip behind a reverse proxy is the proxy's own address,
  // so the admin brute-force lockout would key every client to a single bucket.
  trustProxy: config.trustProxy,
});

await app.register(cors, {
  origin: config.host === "127.0.0.1" || config.host === "localhost"
    ? true // allow all origins in local dev
    : false, // deny cross-origin in production; set OLLAMA_PROXY_CORS_ORIGIN to override
  // ponytail: per-origin allowlist when multi-origin needed
});

// Security headers
app.addHook("onSend", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
});

// Decorate with db + config before plugins access them
app.decorate("db", db);
app.decorate("config", config);

// ── Security: Admin auth on /api/admin/* ──
await app.register(adminAuthPlugin);

// ── Security: Proxy key auth on /v1/* ──
await app.register(proxyKeyAuthPlugin);

// ── OpenAI-compatible API routes ──
await app.register(openaiRoutes);
await app.register(embeddingRoutes);

// ── Admin API routes ──
await app.register(adminRoutes);

// ── Static Web UI (Phase 14, Task 095) ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDistPath = resolve(__dirname, "..", "..", "web", "dist");

if (existsSync(webDistPath)) {
  await app.register(fastifyStatic, {
    root: webDistPath,
    prefix: "/",
    wildcard: false,
  });

  // SPA fallback for /admin and client-side routing
  app.setNotFoundHandler((request, reply) => {
    // If API route, return 404 JSON
    if (request.url.startsWith("/v1/") || request.url.startsWith("/api/")) {
      return reply.code(404).send({
        error: { message: "Route not found", type: "invalid_request_error", code: "not_found" },
      });
    }
    // Otherwise serve SPA index.html
    return reply.sendFile("index.html");
  });
}

// ── Telemetry: Periodic log retention cleanup (Task 057) + Auto Account Health Check (1 min) ──
const cleanupTimer = startLogRetentionCleanup(db);
const healthCheckTimer = startAccountHealthCheckScheduler(db, config.encryptionKey);

app.get("/health/live", async () => ({ status: "ok" }));

app.get("/health/ready", async (_request, reply) => {
  const checks: Record<string, string> = {};

  // 1. DB responsive
  try {
    sqlite.prepare("SELECT 1").get();
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }

  // 2. Encryption key works (can derive key without crash)
  try {
    const { encrypt, decrypt } = await import("@ollama-proxy/shared");
    const test = encrypt("readiness-probe", config.encryptionKey);
    decrypt(test, config.encryptionKey);
    checks.encryption = "ok";
  } catch {
    checks.encryption = "error";
  }

  // 3. Not shutting down
  checks.accepting_requests = isShuttingDown() ? "error" : "ok";

  const healthy = Object.values(checks).every((v) => v === "ok");
  return reply.code(healthy ? 200 : 503).send({ status: healthy ? "ok" : "error", checks });
});

const start = async () => {
  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(
      `Ollama Proxy listening on http://${config.host}:${config.port}`
    );
    app.log.info(`Database: ${dbPath}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown — Task 043
const SHUTDOWN_TIMEOUT_MS = 30_000; // ponytail: 30s max drain, then force exit

const shutdown = async () => {
  app.log.info("Shutting down...");
  clearInterval(cleanupTimer);
  clearInterval(healthCheckTimer);
  markShutdown(); // stop accepting new requests

  // Force exit if drain takes too long
  const forceTimer = setTimeout(() => {
    app.log.warn("Shutdown timeout — forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  try {
    await app.close(); // drain active connections
  } catch (err) {
    app.log.error(err, "Error during shutdown");
  }
  destroyRoutingState(); // clean up in-memory stores
  sqlite.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
