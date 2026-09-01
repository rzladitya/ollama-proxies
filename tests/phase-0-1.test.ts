import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { existsSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TEST_DB_PATH = resolve(ROOT, "data", "test-verify.db");

// ── Phase 0 Tests ──

describe("Phase 0 — Project Bootstrap", () => {
  it("001: all workspace directories exist", () => {
    const dirs = [
      "apps/server",
      "apps/web",
      "packages/shared",
      "packages/routing-core",
      "packages/ollama-client",
      "packages/storage",
      "packages/ui",
    ];
    for (const d of dirs) {
      expect(existsSync(resolve(ROOT, d))).toBe(true);
    }
  });

  it("001: all workspace package.json files exist", () => {
    const pkgs = [
      "apps/server/package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
      "packages/routing-core/package.json",
      "packages/ollama-client/package.json",
      "packages/storage/package.json",
      "packages/ui/package.json",
    ];
    for (const p of pkgs) {
      expect(existsSync(resolve(ROOT, p))).toBe(true);
    }
  });

  it("001: root package.json has correct workspaces", async () => {
    const pkg = await import(resolve(ROOT, "package.json"), {
      with: { type: "json" },
    });
    expect(pkg.default.workspaces).toEqual(["apps/*", "packages/*"]);
  });

  it("002: server main.ts exists", () => {
    expect(existsSync(resolve(ROOT, "apps/server/src/main.ts"))).toBe(true);
  });

  it("002: server package.json has dev script with tsx", async () => {
    const pkg = await import(
      resolve(ROOT, "apps/server/package.json"),
      { with: { type: "json" } }
    );
    expect(pkg.default.scripts.dev).toContain("tsx");
    expect(pkg.default.dependencies.fastify).toBeDefined();
  });

  it("002: server listens on port 11435 (default config)", async () => {
    // Provide required secrets for config validation
    process.env.OLLAMA_PROXY_ENCRYPTION_KEY = "test-encryption-key-min-16-chars";
    process.env.OLLAMA_PROXY_ADMIN_SECRET = "test-admin-secret";
    const { loadConfig } = await import(
      resolve(ROOT, "apps/server/src/config/env.js")
    );
    const config = loadConfig();
    expect(config.port).toBe(11435);
  });

  it("003: web app has Vite config with API proxy", async () => {
    expect(existsSync(resolve(ROOT, "apps/web/vite.config.ts"))).toBe(true);
    expect(existsSync(resolve(ROOT, "apps/web/index.html"))).toBe(true);
    expect(existsSync(resolve(ROOT, "apps/web/src/main.tsx"))).toBe(true);
  });

  it("003: Vite proxies /v1, /api, /health to Fastify", () => {
    const content = readFileSync(
      resolve(ROOT, "apps/web/vite.config.ts"),
      "utf-8"
    );
    expect(content).toContain('"/v1"');
    expect(content).toContain('"/api"');
    expect(content).toContain('"/health"');
    expect(content).toContain("11435");
  });

  it("004: .env.example exists with all required vars", () => {
    const content = readFileSync(
      resolve(ROOT, ".env.example"),
      "utf-8"
    );
    const required = [
      "OLLAMA_PROXY_HOST",
      "OLLAMA_PROXY_PORT",
      "OLLAMA_PROXY_DATA_DIR",
      "OLLAMA_PROXY_ENCRYPTION_KEY",
      "OLLAMA_PROXY_ADMIN_SECRET",
      "OLLAMA_PROXY_LOG_LEVEL",
    ];
    for (const v of required) {
      expect(content).toContain(v);
    }
  });

  it("004: config loader validates with Zod and returns correct shape", async () => {
    // Provide required secrets for config validation
    process.env.OLLAMA_PROXY_ENCRYPTION_KEY = "test-encryption-key-min-16-chars";
    process.env.OLLAMA_PROXY_ADMIN_SECRET = "test-admin-secret";
    const { loadConfig } = await import(
      resolve(ROOT, "apps/server/src/config/env.js")
    );
    const config = loadConfig();
    expect(config).toHaveProperty("host");
    expect(config).toHaveProperty("port");
    expect(config).toHaveProperty("dataDir");
    expect(config).toHaveProperty("encryptionKey");
    expect(config).toHaveProperty("adminSecret");
    expect(config).toHaveProperty("logLevel");
    expect(config).toHaveProperty("requestTimeoutSeconds");
    expect(config).toHaveProperty("maxAttempts");
  });

  it("004: root has dev script using concurrently", async () => {
    const pkg = await import(resolve(ROOT, "package.json"), {
      with: { type: "json" },
    });
    expect(pkg.default.scripts.dev).toContain("concurrently");
  });
});

// ── Phase 1 Tests ──

describe("Phase 1 — Database & Schema", () => {
  let sqlite: InstanceType<typeof Database>;

  beforeAll(async () => {
    // Clean up test db
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);

    const { createDatabase, runMigrations, bootstrapDefaults } = await import(
      resolve(ROOT, "packages/storage/dist/index.js")
    );

    const result = createDatabase(TEST_DB_PATH);
    sqlite = result.sqlite;
    runMigrations(sqlite);
    await bootstrapDefaults(result.db);
  });

  afterAll(() => {
    if (sqlite) sqlite.close();
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
    // Also clean WAL files
    if (existsSync(TEST_DB_PATH + "-wal"))
      rmSync(TEST_DB_PATH + "-wal");
    if (existsSync(TEST_DB_PATH + "-shm"))
      rmSync(TEST_DB_PATH + "-shm");
  });

  it("005: SQLite DB is created at specified path", () => {
    expect(existsSync(TEST_DB_PATH)).toBe(true);
  });

  it("005: WAL mode is enabled", () => {
    const result = sqlite.pragma("journal_mode") as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe("wal");
  });

  it("005: foreign keys are enabled", () => {
    const result = sqlite.pragma("foreign_keys") as {
      foreign_keys: number;
    }[];
    expect(result[0].foreign_keys).toBe(1);
  });

  const EXPECTED_TABLES = [
    "upstream_accounts",
    "account_pools",
    "account_pool_members",
    "models",
    "account_models",
    "proxy_api_keys",
    "proxy_key_models",
    "request_logs",
    "settings",
  ];

  it("005-011: all 9 tables exist", () => {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const t of EXPECTED_TABLES) {
      expect(names).toContain(t);
    }
  });

  it("006: upstream_accounts has all required columns", () => {
    const cols = sqlite.prepare("PRAGMA table_info(upstream_accounts)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    const required = [
      "id",
      "name",
      "encrypted_api_key",
      "enabled",
      "state",
      "priority",
      "weight",
      "last_success_at",
      "last_error_at",
      "last_error_code",
      "created_at",
      "updated_at",
    ];
    for (const r of required) {
      expect(names).toContain(r);
    }
  });

  it("007: account_pools has all required columns", () => {
    const cols = sqlite.prepare("PRAGMA table_info(account_pools)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    for (const r of ["id", "name", "description", "created_at", "updated_at"]) {
      expect(names).toContain(r);
    }
  });

  it("007: account_pool_members has all required columns", () => {
    const cols = sqlite
      .prepare("PRAGMA table_info(account_pool_members)")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);
    for (const r of ["pool_id", "account_id", "enabled"]) {
      expect(names).toContain(r);
    }
  });

  it("008: models has all required columns", () => {
    const cols = sqlite.prepare("PRAGMA table_info(models)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    for (const r of [
      "id",
      "public_model_id",
      "upstream_model_id",
      "enabled",
      "created_at",
      "updated_at",
    ]) {
      expect(names).toContain(r);
    }
  });

  it("008: account_models has all required columns", () => {
    const cols = sqlite.prepare("PRAGMA table_info(account_models)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    for (const r of [
      "account_id",
      "model_id",
      "available",
      "excluded",
      "last_checked_at",
    ]) {
      expect(names).toContain(r);
    }
  });

  it("009: proxy_api_keys has all required columns", () => {
    const cols = sqlite.prepare("PRAGMA table_info(proxy_api_keys)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    for (const r of [
      "id",
      "name",
      "key_prefix",
      "secret_hash",
      "enabled",
      "pool_id",
      "rpm_limit",
      "concurrency_limit",
      "created_at",
      "last_used_at",
      "revoked_at",
    ]) {
      expect(names).toContain(r);
    }
  });

  it("009: proxy_key_models has all required columns", () => {
    const cols = sqlite.prepare("PRAGMA table_info(proxy_key_models)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    for (const r of ["proxy_key_id", "public_model_id", "allowed"]) {
      expect(names).toContain(r);
    }
  });

  it("010: request_logs has all 18 required columns", () => {
    const cols = sqlite.prepare("PRAGMA table_info(request_logs)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    const required = [
      "request_id",
      "timestamp",
      "proxy_api_key_id",
      "public_model_id",
      "routing_key_hash",
      "lease_hit",
      "initial_account_id",
      "final_account_id",
      "attempt_count",
      "failover_count",
      "stream",
      "status_code",
      "latency_ms",
      "ttfb_ms",
      "input_tokens",
      "output_tokens",
      "error_category",
      "error_code",
    ];
    for (const r of required) {
      expect(names).toContain(r);
    }
    expect(names.length).toBeGreaterThanOrEqual(18);
  });

  it("011: settings table has key, value, updated_at", () => {
    const cols = sqlite.prepare("PRAGMA table_info(settings)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    for (const r of ["key", "value", "updated_at"]) {
      expect(names).toContain(r);
    }
  });

  it("012: default 'all' pool is bootstrapped", () => {
    const pool = sqlite
      .prepare("SELECT * FROM account_pools WHERE name = 'all'")
      .get() as { name: string; id: string } | undefined;
    expect(pool).toBeDefined();
    expect(pool!.name).toBe("all");
    expect(pool!.id).toBeTruthy();
  });

  it("012: default routing_config settings are bootstrapped", () => {
    const setting = sqlite
      .prepare("SELECT * FROM settings WHERE key = 'routing_config'")
      .get() as { key: string; value: string } | undefined;
    expect(setting).toBeDefined();
    const config = JSON.parse(setting!.value);
    expect(config.stickyEnabled).toBe(true);
    expect(config.leaseTtlSeconds).toBe(1800);
    expect(config.extendLeaseOnSuccess).toBe(true);
    expect(config.maxAttempts).toBe(3);
    expect(config.rateLimitCooldownSeconds).toBe(300);
    expect(config.transientFailureCooldownSeconds).toBe(120);
    expect(config.transientFailureThreshold).toBe(3);
    expect(config.selection).toBe("PRIORITY_LEAST_LOAD_WEIGHTED");
  });

  it("012: restart preserves data (idempotent migration)", async () => {
    // Insert test data
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
      )
      .run("test_key", "test_value", now);

    // Run migrations again (simulating restart)
    const { runMigrations } = await import(
      resolve(ROOT, "packages/storage/dist/index.js")
    );
    runMigrations(sqlite);

    // Verify data survived
    const row = sqlite
      .prepare("SELECT * FROM settings WHERE key = 'test_key'")
      .get() as { value: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.value).toBe("test_value");
  });

  it("012: bootstrap is idempotent (running twice doesn't duplicate)", async () => {
    const { createDatabase, runMigrations, bootstrapDefaults } = await import(
      resolve(ROOT, "packages/storage/dist/index.js")
    );

    // Run bootstrap again on same db
    const { db: db2, sqlite: sqlite2 } = createDatabase(TEST_DB_PATH);
    runMigrations(sqlite2);
    await bootstrapDefaults(db2);
    sqlite2.close();

    // Should still have exactly 1 "all" pool
    const pools = sqlite
      .prepare("SELECT * FROM account_pools WHERE name = 'all'")
      .all();
    expect(pools.length).toBe(1);

    // Should still have exactly 1 routing_config
    const settings = sqlite
      .prepare("SELECT * FROM settings WHERE key = 'routing_config'")
      .all();
    expect(settings.length).toBe(1);
  });
});
