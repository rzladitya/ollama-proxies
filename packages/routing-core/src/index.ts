import { createHash } from "node:crypto";
import type { AccountState, ErrorCategory, RoutingConfig } from "@ollama-proxy/shared";

// ── Types ──

export interface Lease {
  accountId: string;
  createdAt: number;
  expiresAt: number;
}

export type AccountTier = "free" | "pro" | "max" | "team";

export interface EligibleAccount {
  id: string;
  name?: string;
  tier?: string;
  maxConcurrency?: number | null;
  enabled: boolean;
  state: string;
  priority: number;
  weight: number;
  poolIds: string[];
  modelIds: string[];
}

export const DEFAULT_CONCURRENCY_BY_TIER: Record<string, number> = {
  free: 1,
  pro: 3,
  max: 10,
  team: 10,
};

export function getAccountMaxConcurrency(account: { tier?: string; maxConcurrency?: number | null }): number {
  if (account.maxConcurrency != null && account.maxConcurrency > 0) {
    return account.maxConcurrency;
  }
  return DEFAULT_CONCURRENCY_BY_TIER[account.tier || "free"] ?? 1;
}

export interface RoutingContext {
  proxyKeyId: string;
  poolId: string;
  publicModelId: string;
}

export interface CooldownEntry {
  accountId: string;
  until: number;
  reason: string;
}

// ── Task 029: Routing-key resolver ──

/**
 * Resolve routing identity from request headers/body.
 * Priority: X-Proxy-Session-ID > request.user > null (stateless)
 * Values are SHA-256 hashed to avoid storing raw user identifiers.
 */
export function resolveRoutingKey(
  headers: Record<string, string | string[] | undefined>,
  requestUser?: string,
): string | null {
  const sessionId = headers["x-proxy-session-id"];
  const value = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  if (value) return createHash("sha256").update(value).digest("hex");
  if (requestUser) return createHash("sha256").update(requestUser).digest("hex");
  return null;
}

// ── Task 031: Lease key generation ──

/**
 * Generate lease key: SHA-256 of canonical string.
 * Input: proxyKeyId:poolId:publicModelId:routingKey
 */
export function makeLeaseKey(ctx: RoutingContext, routingKey: string): string {
  const canonical = `${ctx.proxyKeyId}:${ctx.poolId}:${ctx.publicModelId}:${routingKey}`;
  return createHash("sha256").update(canonical).digest("hex");
}

// ── Task 030: In-memory lease store ──

export class LeaseStore {
  private store = new Map<string, Lease>();
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private cleanupIntervalMs = 60_000) {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    // Don't block process exit
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  get(key: string): Lease | null {
    const lease = this.store.get(key);
    if (!lease) return null;
    if (lease.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return lease;
  }

  set(key: string, accountId: string, ttlMs: number): void {
    const now = Date.now();
    this.store.set(key, {
      accountId,
      createdAt: now,
      expiresAt: now + ttlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, lease] of this.store) {
      if (lease.expiresAt <= now) this.store.delete(key);
    }
  }

  /** For testing / shutdown */
  destroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// ── Task 034: Active request counter & Bounded Queue ──

export class BoundedRequestQueue {
  private waiters: Array<() => void> = [];

  async waitForSlot(timeoutMs = 20_000, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        const idx = this.waiters.indexOf(onSlotAvailable);
        if (idx !== -1) this.waiters.splice(idx, 1);
        signal?.removeEventListener("abort", onAbort);
      };

      const onSlotAvailable = () => {
        cleanup();
        resolve(true);
      };

      const onAbort = () => {
        cleanup();
        resolve(false);
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          resolve(false);
        }, timeoutMs);
      }

      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(onSlotAvailable);
    });
  }

  notifySlotAvailable(): void {
    const next = this.waiters.shift();
    if (next) next();
  }

  get queueLength(): number {
    return this.waiters.length;
  }

  clear(): void {
    this.waiters = [];
  }
}

export class ActiveRequestCounter {
  private counts = new Map<string, number>();

  constructor(private queue?: BoundedRequestQueue) {}

  get(accountId: string): number {
    return this.counts.get(accountId) ?? 0;
  }

  increment(accountId: string): void {
    this.counts.set(accountId, this.get(accountId) + 1);
  }

  decrement(accountId: string): void {
    const current = this.get(accountId);
    // Never negative
    this.counts.set(accountId, Math.max(0, current - 1));
    this.queue?.notifySlotAvailable();
  }

  clear(): void {
    this.counts.clear();
  }
}

// ── Task 032: Eligible account resolver ──

export interface EligibilityContext {
  poolId: string;
  modelId: string;
  attemptedAccountIds: Set<string>;
  getCooldown: (accountId: string) => CooldownEntry | null;
  activeCounter?: ActiveRequestCounter;
  requireAvailableSlot?: boolean;
}

/**
 * Filter accounts to eligible candidates.
 * Must satisfy ALL: enabled, pool member, model support, state valid, cooldown expired, not attempted,
 * and if requireAvailableSlot=true, must have inflight < maxConcurrency.
 */
export function getEligibleAccounts(
  accounts: EligibleAccount[],
  ctx: EligibilityContext,
): EligibleAccount[] {
  const now = Date.now();
  return accounts.filter((a) => {
    if (!a.enabled) return false;
    if (a.state === "INVALID" || a.state === "DISABLED") return false;
    if (!a.poolIds.includes(ctx.poolId)) return false;
    if (!a.modelIds.includes(ctx.modelId)) return false;
    if (ctx.attemptedAccountIds.has(a.id)) return false;
    const cooldown = ctx.getCooldown(a.id);
    if (cooldown && cooldown.until > now) return false;

    // Per-account concurrency semaphore check
    if (ctx.requireAvailableSlot && ctx.activeCounter) {
      const maxSlots = getAccountMaxConcurrency(a);
      const inflight = ctx.activeCounter.get(a.id);
      if (inflight >= maxSlots) return false;
    }

    return true;
  });
}

// ── Task 033: Account selector ──

export type RngFn = () => number;

/**
 * Select account: highest priority group → lowest utilization ratio (inflight / maxConcurrency) → weighted tie-break.
 * Injectable RNG for deterministic testing.
 */
export function selectAccount(
  candidates: EligibleAccount[],
  activeCounter: ActiveRequestCounter,
  rng: RngFn = Math.random,
): EligibleAccount {
  if (candidates.length === 0) {
    throw new Error("No eligible accounts");
  }
  if (candidates.length === 1) return candidates[0];

  // 1. Highest priority group (higher number = higher priority)
  const maxPriority = Math.max(...candidates.map((a) => a.priority));
  const priorityGroup = candidates.filter((a) => a.priority === maxPriority);
  if (priorityGroup.length === 1) return priorityGroup[0];

  // 2. Lowest utilization ratio = (inflight / maxConcurrency) / normalizedWeight
  const totalWeight = priorityGroup.reduce((s, a) => s + a.weight, 0);
  const withLoad = priorityGroup.map((a) => {
    const normalizedWeight = a.weight / totalWeight;
    const maxConcurrency = getAccountMaxConcurrency(a);
    const inflight = activeCounter.get(a.id);
    const utilization = inflight / maxConcurrency;
    const effectiveLoad = utilization / normalizedWeight;
    return { account: a, effectiveLoad, availableSlots: maxConcurrency - inflight };
  });

  const minLoad = Math.min(...withLoad.map((w) => w.effectiveLoad));
  // Band: within 0.001 of minimum considered equal
  const loadBand = withLoad.filter((w) => w.effectiveLoad - minLoad < 0.001);

  if (loadBand.length === 1) return loadBand[0].account;

  // 3. Prefer accounts with more absolute available slots
  const maxSlots = Math.max(...loadBand.map((w) => w.availableSlots));
  const slotBand = loadBand.filter((w) => w.availableSlots === maxSlots);
  if (slotBand.length === 1) return slotBand[0].account;

  // 4. Weighted random tie-break
  const bandTotalWeight = slotBand.reduce((s, w) => s + w.account.weight, 0);
  let roll = rng() * bandTotalWeight;
  for (const w of slotBand) {
    roll -= w.account.weight;
    if (roll <= 0) return w.account;
  }

  // Fallback
  return slotBand[slotBand.length - 1].account;
}

// ── Task 036: Cooldown manager ──

export class CooldownManager {
  private cooldowns = new Map<string, CooldownEntry>();

  setCooldown(accountId: string, durationMs: number, reason: string): void {
    this.cooldowns.set(accountId, {
      accountId,
      until: Date.now() + durationMs,
      reason,
    });
  }

  getCooldown(accountId: string): CooldownEntry | null {
    const entry = this.cooldowns.get(accountId);
    if (!entry) return null;
    if (entry.until <= Date.now()) {
      this.cooldowns.delete(accountId);
      return null;
    }
    return entry;
  }

  clearCooldown(accountId: string): void {
    this.cooldowns.delete(accountId);
  }

  clear(): void {
    this.cooldowns.clear();
  }
}

// ── Task 039: Failure window counter ──

interface FailureRecord {
  timestamps: number[];
}

export class FailureWindowCounter {
  private failures = new Map<string, FailureRecord>();

  constructor(private windowMs = 120_000) {}

  record(accountId: string): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let rec = this.failures.get(accountId);
    if (!rec) {
      rec = { timestamps: [] };
      this.failures.set(accountId, rec);
    }
    // Prune old entries
    rec.timestamps = rec.timestamps.filter((t) => t > cutoff);
    rec.timestamps.push(now);
    return rec.timestamps.length;
  }

  getCount(accountId: string): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const rec = this.failures.get(accountId);
    if (!rec) return 0;
    rec.timestamps = rec.timestamps.filter((t) => t > cutoff);
    return rec.timestamps.length;
  }

  reset(accountId: string): void {
    this.failures.delete(accountId);
  }

  clear(): void {
    this.failures.clear();
  }
}

// ── Task 037: Health manager (state machine) ──

export interface HealthTransition {
  accountId: string;
  previousState: AccountState;
  newState: AccountState;
  reason: string;
}

export class HealthManager {
  private states = new Map<string, AccountState>();

  constructor(
    private cooldownManager: CooldownManager,
    private failureCounter: FailureWindowCounter,
  ) {}

  getState(accountId: string): AccountState {
    return this.states.get(accountId) ?? "ACTIVE";
  }

  setState(accountId: string, state: AccountState): void {
    this.states.set(accountId, state);
  }

  /**
   * Record a failure and return state transition if any.
   * Flow: ACTIVE → DEGRADED (on first failure) → COOLDOWN (on threshold)
   * Auth errors → INVALID immediately.
   */
  recordFailure(
    accountId: string,
    category: ErrorCategory,
    config: RoutingConfig,
  ): HealthTransition | null {
    const prev = this.getState(accountId);

    // Auth errors → INVALID immediately
    if (category === "UPSTREAM_AUTH_ERROR") {
      this.setState(accountId, "INVALID");
      return { accountId, previousState: prev, newState: "INVALID", reason: "auth_error" };
    }

    // Track failure in rolling window
    const count = this.failureCounter.record(accountId);

    // Rate limit → immediate cooldown
    if (category === "UPSTREAM_RATE_LIMIT") {
      const cooldownMs = config.rateLimitCooldownSeconds * 1000;
      this.cooldownManager.setCooldown(accountId, cooldownMs, "rate_limit");
      this.setState(accountId, "COOLDOWN");
      return { accountId, previousState: prev, newState: "COOLDOWN", reason: "rate_limit" };
    }

    // Threshold reached → COOLDOWN
    if (count >= config.transientFailureThreshold) {
      const cooldownMs = config.transientFailureCooldownSeconds * 1000;
      this.cooldownManager.setCooldown(accountId, cooldownMs, "transient_failures");
      this.setState(accountId, "COOLDOWN");
      return { accountId, previousState: prev, newState: "COOLDOWN", reason: "transient_failures" };
    }

    // First or sub-threshold failure → DEGRADED
    if (prev === "ACTIVE") {
      this.setState(accountId, "DEGRADED");
      return { accountId, previousState: prev, newState: "DEGRADED", reason: "transient_failure" };
    }

    return null;
  }

  /** Success restores ACTIVE and resets failure counter. */
  recordSuccess(accountId: string): HealthTransition | null {
    const prev = this.getState(accountId);
    this.failureCounter.reset(accountId);
    this.cooldownManager.clearCooldown(accountId);

    if (prev !== "ACTIVE" && prev !== "DISABLED") {
      this.setState(accountId, "ACTIVE");
      return { accountId, previousState: prev, newState: "ACTIVE", reason: "success" };
    }
    return null;
  }

  clear(): void {
    this.states.clear();
  }
}

// ── Task 035: Attempt runner ──
// ── Task 038: Lease migration on failover ──

export interface AttemptResult<T> {
  response: T;
  accountId: string;
  attempts: number;
  failovers: number;
  leaseHit: boolean;
}

export interface AttemptRunnerDeps {
  allAccounts: EligibleAccount[];
  activeCounter: ActiveRequestCounter;
  cooldownManager: CooldownManager;
  healthManager: HealthManager;
  leaseStore: LeaseStore;
  routingConfig: RoutingConfig;
  poolId: string;
  modelId: string;
  proxyKeyId: string;
  leaseKey: string | null;
  leasedAccountId: string | null;
  /** Global deadline in ms from first attempt. Default: none. */
  deadlineMs?: number;
}

/** Exponential backoff with jitter: base * 2^(attempt-1) + random jitter */
function backoffMs(attempt: number, baseMs = 200, maxMs = 5000): number {
  const exp = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
  const jitter = Math.random() * exp * 0.5; // 0-50% jitter
  return Math.floor(exp + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Orchestrate up to maxAttempts upstream attempts.
 * No same account twice. On successful failover, migrate lease.
 * Includes exponential backoff + jitter between retries,
 * optional global deadline, and Retry-After header honoring.
 *
 * `execute` receives the selected account and returns the upstream result.
 * It should throw UpstreamError (or any error) on failure.
 */
export async function runWithAttempts<T>(
  deps: AttemptRunnerDeps,
  execute: (account: EligibleAccount) => Promise<T>,
): Promise<AttemptResult<T>> {
  const {
    allAccounts, activeCounter, cooldownManager, healthManager,
    leaseStore, routingConfig, poolId, modelId, leaseKey, leasedAccountId,
    deadlineMs,
  } = deps;

  const maxAttempts = routingConfig.maxAttempts;
  const attemptedIds = new Set<string>();
  let leaseHit = false;
  let lastError: unknown;
  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Global deadline check
    if (deadlineMs && (Date.now() - startTime) >= deadlineMs) break;

    // Backoff between retries (not before first attempt)
    if (attempt > 1) {
      // Honor Retry-After from previous error if available
      let waitMs = backoffMs(attempt);
      if (lastError && typeof lastError === "object" && "retryAfterSeconds" in lastError) {
        const retryAfter = (lastError as { retryAfterSeconds?: number }).retryAfterSeconds;
        if (retryAfter && retryAfter > 0) {
          waitMs = Math.max(waitMs, retryAfter * 1000);
        }
      }
      // Don't wait longer than remaining deadline
      if (deadlineMs) {
        const remaining = deadlineMs - (Date.now() - startTime);
        if (remaining <= 0) break;
        waitMs = Math.min(waitMs, remaining);
      }
      await sleep(waitMs);
    }

    // Select account
    let selected: EligibleAccount | null = null;

    // First attempt: try soft sticky leased account (only if it has available capacity)
    if (attempt === 1 && leasedAccountId) {
      const leasedCandidate = allAccounts.find(
        (a) => a.id === leasedAccountId && a.enabled && a.state !== "INVALID" && a.state !== "DISABLED",
      );
      if (leasedCandidate) {
        const maxSlots = getAccountMaxConcurrency(leasedCandidate);
        const inflight = activeCounter.get(leasedCandidate.id);
        if (inflight < maxSlots) {
          selected = leasedCandidate;
          leaseHit = true;
        }
      }
    }

    // Otherwise select from eligible
    if (!selected) {
      let eligible = getEligibleAccounts(allAccounts, {
        poolId,
        modelId,
        attemptedAccountIds: attemptedIds,
        getCooldown: (id) => cooldownManager.getCooldown(id),
        activeCounter,
        requireAvailableSlot: true,
      });

      // If all candidate accounts are currently at max capacity, fallback to any valid non-cooldown candidate
      if (eligible.length === 0) {
        eligible = getEligibleAccounts(allAccounts, {
          poolId,
          modelId,
          attemptedAccountIds: attemptedIds,
          getCooldown: (id) => cooldownManager.getCooldown(id),
          requireAvailableSlot: false,
        });
      }

      if (eligible.length === 0) break; // No more candidates

      selected = selectAccount(eligible, activeCounter);
    }

    attemptedIds.add(selected.id);
    activeCounter.increment(selected.id);

    try {
      const response = await execute(selected);

      // Success: record health, migrate lease
      healthManager.recordSuccess(selected.id);

      // Task 038: lease migration on failover
      if (leaseKey && routingConfig.stickyEnabled) {
        leaseStore.set(leaseKey, selected.id, routingConfig.leaseTtlSeconds * 1000);
      }

      return {
        response,
        accountId: selected.id,
        attempts: attempt,
        failovers: attempt - 1,
        leaseHit,
      };
    } catch (err: unknown) {
      lastError = err;

      // Classify and record health
      const { classifyError } = await import("@ollama-proxy/ollama-client");
      const classified = classifyError(err);
      healthManager.recordFailure(selected.id, classified.category, routingConfig);

      // Non-retryable → stop
      if (!classified.retryable) break;

      // Continue to next attempt
    } finally {
      activeCounter.decrement(selected.id);
    }
  }

  // All attempts exhausted
  throw lastError ?? new Error("All upstream attempts failed");
}
