import type { AppDatabase } from "@ollama-proxy/storage";
import { requestLogs } from "@ollama-proxy/storage";
import { eq, lt } from "drizzle-orm";
import type { ErrorCategory } from "@ollama-proxy/shared";

// ── Task 055: RequestTrace class ──

export interface TraceEvent {
  type: "select" | "attempt" | "failover" | "success" | "error" | "cooldown";
  accountId?: string;
  timestamp: number;
  detail?: string;
}

export class RequestTrace {
  readonly requestId: string;
  readonly startedAt: number;
  readonly events: TraceEvent[] = [];

  proxyApiKeyId?: string;
  publicModelId?: string;
  routingKeyHash?: string;
  leaseHit = false;
  initialAccountId?: string;
  finalAccountId?: string;
  attemptCount = 0;
  failoverCount = 0;
  stream = false;
  statusCode = 200;
  queueMs = 0;
  latencyMs?: number;
  ttfbMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCategory?: ErrorCategory;
  errorCode?: string;

  constructor(requestId: string, startedAt?: number) {
    this.requestId = requestId;
    this.startedAt = startedAt ?? Date.now();
  }

  addEvent(type: TraceEvent["type"], accountId?: string, detail?: string): void {
    this.events.push({ type, accountId, timestamp: Date.now(), detail });
  }

  complete(): void {
    if (this.latencyMs == null) {
      this.latencyMs = Date.now() - this.startedAt;
    }
  }

  // ── Task 056: Persist to request_logs & formatted CLI log ──
  async persist(db: AppDatabase): Promise<void> {
    this.complete();

    // Print beautiful terminal log matching 9router/antigravity format
    const timeStr = new Date(this.startedAt).toTimeString().split(" ")[0];
    const isOk = this.statusCode >= 200 && this.statusCode < 400;
    const statusIcon = isOk ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m";
    const modeTag = this.stream ? "STREAM" : "JSON";
    const queueInfo = this.queueMs > 0 ? ` · \x1b[35mQUEUE ${this.queueMs}ms\x1b[0m` : "";
    const tokensInfo = this.inputTokens != null || this.outputTokens != null
      ? ` · IN ${this.inputTokens ?? 0} · OUT ${this.outputTokens ?? 0}`
      : "";
    const ttftInfo = this.ttfbMs != null ? ` · TTFT ${this.ttfbMs}ms` : "";

    // Tokens per second calculation (after TTFT)
    let tpsInfo = "";
    if (this.outputTokens && this.latencyMs != null && this.outputTokens > 0) {
      const genTimeMs = Math.max(1, this.latencyMs - (this.ttfbMs ?? 0));
      const tps = ((this.outputTokens / genTimeMs) * 1000).toFixed(1);
      tpsInfo = ` · ${tps} t/s`;
    }

    const accInfo = this.finalAccountId ? ` · ACC:${this.finalAccountId.slice(0, 8)}` : "";
    const attemptInfo = this.attemptCount > 1 ? ` · ATTEMPTS:${this.attemptCount}` : "";

    console.log(
      `[server] [\x1b[90m${timeStr}\x1b[0m] ${statusIcon} \x1b[1m\x1b[36mDONE\x1b[0m ${this.latencyMs}ms${queueInfo}${ttftInfo}${tpsInfo}${tokensInfo}${accInfo} · \x1b[33m${this.publicModelId ?? "unknown"}\x1b[0m [${modeTag}] [${this.statusCode}]${attemptInfo}`
    );

    await db.insert(requestLogs).values({
      requestId: this.requestId,
      timestamp: new Date(this.startedAt).toISOString(),
      proxyApiKeyId: this.proxyApiKeyId ?? null,
      publicModelId: this.publicModelId ?? null,
      routingKeyHash: this.routingKeyHash ?? null,
      leaseHit: this.leaseHit,
      initialAccountId: this.initialAccountId ?? null,
      finalAccountId: this.finalAccountId ?? null,
      attemptCount: this.attemptCount,
      failoverCount: this.failoverCount,
      stream: this.stream,
      statusCode: this.statusCode,
      queueMs: this.queueMs > 0 ? this.queueMs : null,
      latencyMs: this.latencyMs ?? null,
      ttfbMs: this.ttfbMs ?? null,
      inputTokens: this.inputTokens ?? null,
      outputTokens: this.outputTokens ?? null,
      errorCategory: this.errorCategory ?? null,
      errorCode: this.errorCode ?? null,
    });
  }
}

// ── Task 057: Log retention cleanup (Keep max 1000 lines + 7 days cutoff) ──

const MAX_LOG_ROWS = 1000;
const RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 60 * 1000; // run every 1 minute or on insert

export async function trimLogsToLimit(db: AppDatabase): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.delete(requestLogs).where(lt(requestLogs.timestamp, cutoff));

    // Delete older records if total exceeds MAX_LOG_ROWS (1000 lines)
    const { count } = await import("drizzle-orm");
    const [totalRes] = await db.select({ val: count() }).from(requestLogs);
    const total = totalRes?.val ?? 0;

    if (total > MAX_LOG_ROWS) {
      const { desc } = await import("drizzle-orm");
      const rows = await db
        .select({ requestId: requestLogs.requestId })
        .from(requestLogs)
        .orderBy(desc(requestLogs.timestamp))
        .offset(MAX_LOG_ROWS);

      for (const r of rows) {
        await db.delete(requestLogs).where(eq(requestLogs.requestId, r.requestId));
      }
    }
  } catch {
    // ignore background cleanup error
  }
}

// ── Auto Health Check Scheduler (Every 1 minute) ──

const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;

export function startAccountHealthCheckScheduler(db: AppDatabase, encryptionKey: string): ReturnType<typeof setInterval> {
  const runChecks = async () => {
    try {
      const { upstreamAccounts, accountModels, models } = await import("@ollama-proxy/storage");
      const { decrypt } = await import("@ollama-proxy/shared");
      const { OllamaClient } = await import("@ollama-proxy/ollama-client");
      const client = new OllamaClient();

      const accounts = await db.select().from(upstreamAccounts).where(eq(upstreamAccounts.enabled, true));
      const now = new Date().toISOString();

      for (const acc of accounts) {
        try {
          const apiKey = decrypt(acc.encryptedApiKey, encryptionKey);
          const modelList = await client.listModels(apiKey, { timeoutMs: 15_000 });

          await db.update(upstreamAccounts).set({
            state: "ACTIVE",
            lastSuccessAt: now,
            lastErrorCode: null,
            updatedAt: now,
          }).where(eq(upstreamAccounts.id, acc.id));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const state = message.includes("401") || message.includes("Unauthorized") ? "INVALID" : "DEGRADED";
          await db.update(upstreamAccounts).set({
            state,
            lastErrorAt: now,
            lastErrorCode: message.slice(0, 200),
            updatedAt: now,
          }).where(eq(upstreamAccounts.id, acc.id));
        }
      }
    } catch {
      // ignore check error
    }
  };

  const timer = setInterval(() => { runChecks().catch(() => {}); }, HEALTH_CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
  return timer;
}

export function startLogRetentionCleanup(db: AppDatabase): ReturnType<typeof setInterval> {
  trimLogsToLimit(db);
  const timer = setInterval(() => { trimLogsToLimit(db); }, CLEANUP_INTERVAL_MS);
  if (timer.unref) timer.unref();
  return timer;
}
