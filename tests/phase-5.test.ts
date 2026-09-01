import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import {
  resolveRoutingKey,
  makeLeaseKey,
  LeaseStore,
  ActiveRequestCounter,
  getEligibleAccounts,
  selectAccount,
  type EligibleAccount,
  type EligibilityContext,
} from "@ollama-proxy/routing-core";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ── Task 029: Routing-key resolver ──

describe("Phase 5 — Task 029: Routing-key resolver", () => {
  it("X-Proxy-Session-ID wins over request.user", () => {
    const result = resolveRoutingKey(
      { "x-proxy-session-id": "session-123" },
      "user-456"
    );
    expect(result).toBe(sha256("session-123"));
  });

  it("falls back to request.user", () => {
    const result = resolveRoutingKey({}, "user-456");
    expect(result).toBe(sha256("user-456"));
  });

  it("returns null for stateless request", () => {
    const result = resolveRoutingKey({});
    expect(result).toBeNull();
  });

  it("handles array header value", () => {
    const result = resolveRoutingKey({ "x-proxy-session-id": ["a", "b"] });
    expect(result).toBe(sha256("a"));
  });
});

// ── Task 031: Lease key generation ──

describe("Phase 5 — Task 031: Lease key generation", () => {
  it("generates deterministic hash", () => {
    const ctx = { proxyKeyId: "key1", poolId: "pool1", publicModelId: "model1" };
    const a = makeLeaseKey(ctx, "session-1");
    const b = makeLeaseKey(ctx, "session-1");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different inputs produce different keys", () => {
    const ctx = { proxyKeyId: "key1", poolId: "pool1", publicModelId: "model1" };
    const a = makeLeaseKey(ctx, "session-1");
    const b = makeLeaseKey(ctx, "session-2");
    expect(a).not.toBe(b);
  });
});

// ── Task 030: Lease store ──

describe("Phase 5 — Task 030: In-memory lease store", () => {
  let store: LeaseStore;

  beforeEach(() => {
    store = new LeaseStore(60_000);
  });

  it("set and get", () => {
    store.set("k1", "account-1", 30_000);
    const lease = store.get("k1");
    expect(lease).not.toBeNull();
    expect(lease!.accountId).toBe("account-1");
  });

  it("returns null for missing key", () => {
    expect(store.get("missing")).toBeNull();
  });

  it("returns null for expired lease", () => {
    store.set("k1", "account-1", -1); // already expired
    expect(store.get("k1")).toBeNull();
  });

  it("delete removes lease", () => {
    store.set("k1", "account-1", 30_000);
    store.delete("k1");
    expect(store.get("k1")).toBeNull();
  });

  it("tracks size", () => {
    store.set("a", "a1", 30_000);
    store.set("b", "a2", 30_000);
    expect(store.size).toBe(2);
    store.delete("a");
    expect(store.size).toBe(1);
  });

  it("destroy clears all", () => {
    store.set("a", "a1", 30_000);
    store.destroy();
    expect(store.size).toBe(0);
  });
});

// ── Task 034: Active request counter ──

describe("Phase 5 — Task 034: Active request counter", () => {
  let counter: ActiveRequestCounter;

  beforeEach(() => {
    counter = new ActiveRequestCounter();
  });

  it("starts at 0", () => {
    expect(counter.get("a")).toBe(0);
  });

  it("increment and decrement", () => {
    counter.increment("a");
    counter.increment("a");
    expect(counter.get("a")).toBe(2);
    counter.decrement("a");
    expect(counter.get("a")).toBe(1);
  });

  it("never goes negative", () => {
    counter.decrement("a");
    counter.decrement("a");
    expect(counter.get("a")).toBe(0);
  });
});

// ── Task 032: Eligible account resolver ──

describe("Phase 5 — Task 032: Eligible account resolver", () => {
  const makeAccount = (overrides: Partial<EligibleAccount> = {}): EligibleAccount => ({
    id: "acc-1",
    enabled: true,
    state: "ACTIVE",
    priority: 1,
    weight: 1.0,
    poolIds: ["pool-1"],
    modelIds: ["model-1"],
    ...overrides,
  });

  const baseCtx: EligibilityContext = {
    poolId: "pool-1",
    modelId: "model-1",
    attemptedAccountIds: new Set(),
    getCooldown: () => null,
  };

  it("returns eligible accounts", () => {
    const accounts = [makeAccount()];
    expect(getEligibleAccounts(accounts, baseCtx).length).toBe(1);
  });

  it("filters disabled accounts", () => {
    const accounts = [makeAccount({ enabled: false })];
    expect(getEligibleAccounts(accounts, baseCtx).length).toBe(0);
  });

  it("filters INVALID state", () => {
    const accounts = [makeAccount({ state: "INVALID" })];
    expect(getEligibleAccounts(accounts, baseCtx).length).toBe(0);
  });

  it("filters DISABLED state", () => {
    const accounts = [makeAccount({ state: "DISABLED" })];
    expect(getEligibleAccounts(accounts, baseCtx).length).toBe(0);
  });

  it("DEGRADED remains eligible", () => {
    const accounts = [makeAccount({ state: "DEGRADED" })];
    expect(getEligibleAccounts(accounts, baseCtx).length).toBe(1);
  });

  it("filters wrong pool", () => {
    const accounts = [makeAccount({ poolIds: ["other-pool"] })];
    expect(getEligibleAccounts(accounts, baseCtx).length).toBe(0);
  });

  it("filters wrong model", () => {
    const accounts = [makeAccount({ modelIds: ["other-model"] })];
    expect(getEligibleAccounts(accounts, baseCtx).length).toBe(0);
  });

  it("filters already attempted", () => {
    const accounts = [makeAccount({ id: "attempted" })];
    const ctx = { ...baseCtx, attemptedAccountIds: new Set(["attempted"]) };
    expect(getEligibleAccounts(accounts, ctx).length).toBe(0);
  });

  it("filters accounts in cooldown", () => {
    const accounts = [makeAccount()];
    const ctx = {
      ...baseCtx,
      getCooldown: () => ({ accountId: "acc-1", until: Date.now() + 60_000, reason: "429" }),
    };
    expect(getEligibleAccounts(accounts, ctx).length).toBe(0);
  });

  it("allows expired cooldown", () => {
    const accounts = [makeAccount()];
    const ctx = {
      ...baseCtx,
      getCooldown: () => ({ accountId: "acc-1", until: Date.now() - 1, reason: "429" }),
    };
    expect(getEligibleAccounts(accounts, ctx).length).toBe(1);
  });

  it("pool isolation: only pool members", () => {
    const accounts = [
      makeAccount({ id: "a1", poolIds: ["pool-1"] }),
      makeAccount({ id: "a2", poolIds: ["pool-2"] }),
    ];
    const result = getEligibleAccounts(accounts, baseCtx);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("a1");
  });
});

// ── Task 033: Account selector ──

describe("Phase 5 — Task 033: Account selector", () => {
  const counter = new ActiveRequestCounter();

  beforeEach(() => counter.clear());

  it("throws on empty candidates", () => {
    expect(() => selectAccount([], counter)).toThrow("No eligible accounts");
  });

  it("returns single candidate", () => {
    const acc: EligibleAccount = {
      id: "a1", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: [], modelIds: [],
    };
    expect(selectAccount([acc], counter)).toBe(acc);
  });

  it("priority wins: higher priority selected", () => {
    const low: EligibleAccount = {
      id: "low", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: [], modelIds: [],
    };
    const high: EligibleAccount = {
      id: "high", enabled: true, state: "ACTIVE", priority: 10, weight: 1, poolIds: [], modelIds: [],
    };
    expect(selectAccount([low, high], counter).id).toBe("high");
  });

  it("lower load wins within same priority", () => {
    const a: EligibleAccount = {
      id: "a", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: [], modelIds: [],
    };
    const b: EligibleAccount = {
      id: "b", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: [], modelIds: [],
    };
    counter.increment("a");
    counter.increment("a");
    // b has 0 load, should win
    expect(selectAccount([a, b], counter).id).toBe("b");
  });

  it("weight affects tie-break (deterministic RNG)", () => {
    const a: EligibleAccount = {
      id: "a", enabled: true, state: "ACTIVE", priority: 1, weight: 3, poolIds: [], modelIds: [],
    };
    const b: EligibleAccount = {
      id: "b", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: [], modelIds: [],
    };
    // rng returns 0 → should hit first candidate (a, weight 3)
    expect(selectAccount([a, b], counter, () => 0).id).toBe("a");
    // rng returns 0.99 → should hit b (after weight 3 consumed)
    expect(selectAccount([a, b], counter, () => 0.99).id).toBe("b");
  });

  it("equal weight equal load uses RNG", () => {
    const a: EligibleAccount = {
      id: "a", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: [], modelIds: [],
    };
    const b: EligibleAccount = {
      id: "b", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: [], modelIds: [],
    };
    // rng = 0 → first
    expect(selectAccount([a, b], counter, () => 0).id).toBe("a");
    // rng = 0.99 → second
    expect(selectAccount([a, b], counter, () => 0.99).id).toBe("b");
  });
});
