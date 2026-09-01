import type Database from "better-sqlite3";
import { copyFileSync, existsSync } from "node:fs";
import { decryptLegacy, encrypt, decrypt } from "@ollama-proxy/shared";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS upstream_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free',
  max_concurrency INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'ACTIVE',
  priority INTEGER NOT NULL DEFAULT 1,
  weight REAL NOT NULL DEFAULT 1.0,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_pools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_pool_members (
  pool_id TEXT NOT NULL REFERENCES account_pools(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES upstream_accounts(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (pool_id, account_id)
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  public_model_id TEXT NOT NULL UNIQUE,
  upstream_model_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_models (
  account_id TEXT NOT NULL REFERENCES upstream_accounts(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  available INTEGER NOT NULL DEFAULT 1,
  excluded INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  PRIMARY KEY (account_id, model_id)
);

CREATE TABLE IF NOT EXISTS proxy_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  pool_id TEXT NOT NULL REFERENCES account_pools(id),
  rpm_limit INTEGER,
  concurrency_limit INTEGER,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS proxy_key_models (
  proxy_key_id TEXT NOT NULL REFERENCES proxy_api_keys(id) ON DELETE CASCADE,
  public_model_id TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (proxy_key_id, public_model_id)
);

CREATE TABLE IF NOT EXISTS request_logs (
  request_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  proxy_api_key_id TEXT,
  public_model_id TEXT,
  routing_key_hash TEXT,
  lease_hit INTEGER,
  initial_account_id TEXT,
  final_account_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  failover_count INTEGER NOT NULL DEFAULT 0,
  stream INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER,
  queue_ms INTEGER,
  latency_ms INTEGER,
  ttfb_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_category TEXT,
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(SCHEMA_SQL);
  // Auto-migrate column tier if existing database
  try {
    sqlite.exec("ALTER TABLE upstream_accounts ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'");
  } catch {
    // already exists
  }
  try {
    sqlite.exec("ALTER TABLE upstream_accounts ADD COLUMN max_concurrency INTEGER");
  } catch {
    // already exists
  }
  try {
    sqlite.exec("ALTER TABLE request_logs ADD COLUMN queue_ms INTEGER");
  } catch {
    // already exists
  }
}

/**
 * Backup SQLite database to `<dbPath>.bak.<timestamp>`.
 * Must be called BEFORE migration on an existing database.
 * Returns the backup path, or null if no DB exists to back up.
 */
export function backupDatabase(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}.bak.${ts}`;
  copyFileSync(dbPath, backupPath);
  // Also copy WAL/SHM if present (SQLite WAL mode)
  if (existsSync(`${dbPath}-wal`)) {
    copyFileSync(`${dbPath}-wal`, `${backupPath}-wal`);
  }
  if (existsSync(`${dbPath}-shm`)) {
    copyFileSync(`${dbPath}-shm`, `${backupPath}-shm`);
  }
  return backupPath;
}

/**
 * Re-encrypt all upstream account API keys from legacy SHA-256 derivation
 * to scrypt derivation. Idempotent — skips rows already using new KDF.
 *
 * Returns { migrated, skipped, failed } counts.
 */
export function reencryptApiKeys(
  sqlite: Database.Database,
  encryptionKey: string,
): { migrated: number; skipped: number; failed: number } {
  const rows = sqlite.prepare("SELECT id, name, encrypted_api_key FROM upstream_accounts").all() as Array<{
    id: string;
    name: string;
    encrypted_api_key: string;
  }>;

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  const update = sqlite.prepare("UPDATE upstream_accounts SET encrypted_api_key = ? WHERE id = ?");

  for (const row of rows) {
    // Try new KDF first — if it works, already migrated
    try {
      decrypt(row.encrypted_api_key, encryptionKey);
      skipped++;
      continue;
    } catch {
      // Cannot decrypt with new KDF — try legacy
    }

    try {
      const plainKey = decryptLegacy(row.encrypted_api_key, encryptionKey);
      const reencrypted = encrypt(plainKey, encryptionKey);
      update.run(reencrypted, row.id);
      migrated++;
    } catch (err) {
      failed++;
      console.error(`[migrate] Failed to re-encrypt account "${row.name}" (${row.id}): ${err instanceof Error ? err.message : err}`);
    }
  }

  return { migrated, skipped, failed };
}
