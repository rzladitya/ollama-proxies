import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ── upstream_accounts ──
export const upstreamAccounts = sqliteTable("upstream_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  tier: text("tier", { enum: ["free", "pro", "max", "team"] }).notNull().default("free"),
  maxConcurrency: integer("max_concurrency"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  state: text("state", {
    enum: ["ACTIVE", "DEGRADED", "COOLDOWN", "INVALID", "DISABLED"],
  })
    .notNull()
    .default("ACTIVE"),
  priority: integer("priority").notNull().default(1),
  weight: real("weight").notNull().default(1.0),
  lastSuccessAt: text("last_success_at"),
  lastErrorAt: text("last_error_at"),
  lastErrorCode: text("last_error_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── account_pools ──
export const accountPools = sqliteTable("account_pools", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── account_pool_members ──
export const accountPoolMembers = sqliteTable("account_pool_members", {
  poolId: text("pool_id")
    .notNull()
    .references(() => accountPools.id, { onDelete: "cascade" }),
  accountId: text("account_id")
    .notNull()
    .references(() => upstreamAccounts.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

// ── models ──
export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  publicModelId: text("public_model_id").notNull().unique(),
  upstreamModelId: text("upstream_model_id").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── account_models ──
export const accountModels = sqliteTable("account_models", {
  accountId: text("account_id")
    .notNull()
    .references(() => upstreamAccounts.id, { onDelete: "cascade" }),
  modelId: text("model_id")
    .notNull()
    .references(() => models.id, { onDelete: "cascade" }),
  available: integer("available", { mode: "boolean" }).notNull().default(true),
  excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
  lastCheckedAt: text("last_checked_at"),
});

// ── proxy_api_keys ──
export const proxyApiKeys = sqliteTable("proxy_api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  secretHash: text("secret_hash").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  poolId: text("pool_id")
    .notNull()
    .references(() => accountPools.id),
  rpmLimit: integer("rpm_limit"),
  concurrencyLimit: integer("concurrency_limit"),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
});

// ── proxy_key_models ──
export const proxyKeyModels = sqliteTable("proxy_key_models", {
  proxyKeyId: text("proxy_key_id")
    .notNull()
    .references(() => proxyApiKeys.id, { onDelete: "cascade" }),
  publicModelId: text("public_model_id").notNull(),
  allowed: integer("allowed", { mode: "boolean" }).notNull().default(true),
});

// ── request_logs ──
export const requestLogs = sqliteTable("request_logs", {
  requestId: text("request_id").primaryKey(),
  timestamp: text("timestamp").notNull(),
  proxyApiKeyId: text("proxy_api_key_id"),
  publicModelId: text("public_model_id"),
  routingKeyHash: text("routing_key_hash"),
  leaseHit: integer("lease_hit", { mode: "boolean" }),
  initialAccountId: text("initial_account_id"),
  finalAccountId: text("final_account_id"),
  attemptCount: integer("attempt_count").notNull().default(1),
  failoverCount: integer("failover_count").notNull().default(0),
  stream: integer("stream", { mode: "boolean" }).notNull().default(false),
  statusCode: integer("status_code"),
  queueMs: integer("queue_ms"),
  latencyMs: integer("latency_ms"),
  ttfbMs: integer("ttfb_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  errorCategory: text("error_category"),
  errorCode: text("error_code"),
});

// ── settings ──
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
