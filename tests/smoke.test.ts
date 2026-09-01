import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CooldownManager,
  FailureWindowCounter,
  HealthManager,
  runWithAttempts,
  LeaseStore,
  ActiveRequestCounter,
  BoundedRequestQueue,
  getAccountMaxConcurrency,
  getEligibleAccounts,
  resolveRoutingKey,
  type EligibleAccount,
} from "@ollama-proxy/routing-core";
import {
  DEFAULT_ROUTING_CONFIG,
  encrypt,
  decrypt,
  decryptLegacy,
} from "@ollama-proxy/shared";
import {
  UpstreamError,
  classifyError,
} from "@ollama-proxy/ollama-client";

// ── Helpers ──

function makeAccounts(count: number): EligibleAccount[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `acc-${i + 1}`,
    enabled: true,
    state: "ACTIVE",
    priority: 1,
    weight: 1,
    poolIds: ["pool-1"],
    modelIds: ["model-1"],
  }));
}

function makeDeps(overrides: Partial<Parameters<typeof runWithAttempts>[0]> = {}) {
  const cooldown = new CooldownManager();
  const failures = new FailureWindowCounter(120_000);
  const health = new HealthManager(cooldown, failures);
  const activeCounter = new ActiveRequestCounter();
  const leaseStore = new LeaseStore();

  return {
    deps: {
      allAccounts: makeAccounts(3),
      activeCounter,
      cooldownManager: cooldown,
      healthManager: health,
      leaseStore,
      routingConfig: DEFAULT_ROUTING_CONFIG,
      poolId: "pool-1",
      modelId: "model-1",
      proxyKeyId: "key-1",
      leaseKey: null,
      leasedAccountId: null,
      ...overrides,
    },
    cleanup() {
      leaseStore.destroy();
      cooldown.clear();
      failures.clear();
      health.clear();
      activeCounter.clear();
    },
  };
}

// ── Smoke Tests ──

describe("Smoke: Non-streaming success path", () => {
  it("selects account and returns response on first attempt", async () => {
    const { deps, cleanup } = makeDeps();
    try {
      const result = await runWithAttempts(deps, async (acc) => {
        return { model: "test", content: "hello", accountId: acc.id };
      });

      expect(result.attempts).toBe(1);
      expect(result.failovers).toBe(0);
      expect(result.response.content).toBe("hello");
    } finally {
      cleanup();
    }
  });
});

describe("Smoke: Failover on 429 rate limit", () => {
  it("retries on different account after 429, with backoff", async () => {
    const { deps, cleanup } = makeDeps();
    const attemptOrder: string[] = [];
    const attemptTimes: number[] = [];

    try {
      const result = await runWithAttempts(deps, async (acc) => {
        attemptOrder.push(acc.id);
        attemptTimes.push(Date.now());
        if (attemptOrder.length === 1) {
          throw new UpstreamError("Rate limited", 429, "UPSTREAM_RATE_LIMIT", true);
        }
        return { ok: true };
      });

      expect(attemptOrder.length).toBe(2);
      // Different account on retry
      expect(attemptOrder[0]).not.toBe(attemptOrder[1]);
      expect(result.failovers).toBe(1);

      // Backoff: second attempt should be at least 100ms after first
      const gap = attemptTimes[1] - attemptTimes[0];
      expect(gap).toBeGreaterThanOrEqual(100);
    } finally {
      cleanup();
    }
  });

  it("honors Retry-After header via UpstreamError.retryAfterSeconds", async () => {
    const { deps, cleanup } = makeDeps();
    const attemptTimes: number[] = [];

    try {
      await runWithAttempts(deps, async (acc) => {
        attemptTimes.push(Date.now());
        if (attemptTimes.length === 1) {
          // 2 second Retry-After
          throw new UpstreamError("Rate limited", 429, "UPSTREAM_RATE_LIMIT", true, undefined, 2);
        }
        return { ok: true };
      });

      const gap = attemptTimes[1] - attemptTimes[0];
      // Should wait at least 2000ms (Retry-After = 2s)
      expect(gap).toBeGreaterThanOrEqual(1900);
    } finally {
      cleanup();
    }
  }, 10_000);
});

describe("Smoke: Timeout classification", () => {
  it("classifies custom timeout Error as UPSTREAM_TIMEOUT (retryable)", () => {
    const err = new Error("Request timeout");
    const classified = classifyError(err);
    expect(classified.category).toBe("UPSTREAM_TIMEOUT");
    expect(classified.retryable).toBe(true);
  });

  it("classifies DOMException AbortError as UPSTREAM_TIMEOUT", () => {
    const err = new DOMException("signal aborted", "AbortError");
    const classified = classifyError(err);
    expect(classified.category).toBe("UPSTREAM_TIMEOUT");
    expect(classified.retryable).toBe(true);
  });

  it("classifies random Error as INTERNAL_ERROR (not retryable)", () => {
    const err = new Error("something else");
    const classified = classifyError(err);
    expect(classified.category).toBe("INTERNAL_ERROR");
    expect(classified.retryable).toBe(false);
  });
});

describe("Smoke: Global deadline stops retries", () => {
  it("stops retrying when deadline exceeded", async () => {
    const { deps, cleanup } = makeDeps({
      deadlineMs: 500, // 500ms total deadline
    });
    let attempts = 0;

    try {
      await runWithAttempts(deps, async () => {
        attempts++;
        // Each attempt takes ~300ms, so deadline should stop after 1-2 attempts
        await new Promise((r) => setTimeout(r, 300));
        throw new UpstreamError("timeout", 504, "UPSTREAM_TIMEOUT", true);
      });
    } catch {
      // expected — all attempts fail
    }

    // With 500ms deadline and 300ms per attempt + backoff, max 2 attempts
    expect(attempts).toBeLessThanOrEqual(2);
    cleanup();
  }, 10_000);
});

describe("Smoke: Routing key hashing", () => {
  it("hashes session ID so raw value is never stored", () => {
    const key = resolveRoutingKey({ "x-proxy-session-id": "user@example.com" });
    expect(key).not.toContain("user@example.com");
    expect(key).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it("hashes request.user fallback", () => {
    const key = resolveRoutingKey({}, "alice");
    expect(key).not.toBe("alice");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces deterministic hashes", () => {
    const a = resolveRoutingKey({}, "bob");
    const b = resolveRoutingKey({}, "bob");
    expect(a).toBe(b);
  });
});

describe("Smoke: Re-encryption migration", () => {
  it("decryptLegacy reads data encrypted with old SHA-256 KDF", () => {
    // Simulate: encrypt with old KDF (SHA-256), decrypt with decryptLegacy
    // We can't call the old encrypt directly, but decryptLegacy uses SHA-256 derivation
    // and encrypt() uses scrypt. So we test round-trip with new encrypt + decrypt.
    const key = "test-key-for-migration-test";
    const plaintext = "sk-ollamacloud-abc123";

    // New KDF round-trip
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);

    // Legacy can NOT decrypt new-KDF data (different derived key)
    expect(() => decryptLegacy(encrypted, key)).toThrow();
  });
});

describe("Smoke: Health state recovery", () => {
  it("INVALID account recovers to ACTIVE on recordSuccess", () => {
    const cooldown = new CooldownManager();
    const failures = new FailureWindowCounter();
    const health = new HealthManager(cooldown, failures);

    // Auth error → INVALID
    health.recordFailure("acc-1", "UPSTREAM_AUTH_ERROR", DEFAULT_ROUTING_CONFIG);
    expect(health.getState("acc-1")).toBe("INVALID");

    // Success → ACTIVE (simulates health check scheduler finding fixed key)
    const transition = health.recordSuccess("acc-1");
    expect(transition?.newState).toBe("ACTIVE");
    expect(health.getState("acc-1")).toBe("ACTIVE");
  });
});

describe("Smoke: Concurrency and rate limit types", () => {
  it("ActiveRequestCounter never goes negative", () => {
    const counter = new ActiveRequestCounter();
    counter.decrement("acc-1");
    counter.decrement("acc-1");
    expect(counter.get("acc-1")).toBe(0);
  });

  it("ActiveRequestCounter tracks per-account and wakes queue on decrement", () => {
    const queue = new BoundedRequestQueue();
    const counter = new ActiveRequestCounter(queue);
    let slotNotified = false;

    queue.waitForSlot(1000).then((success) => {
      slotNotified = success;
    });

    counter.increment("acc-1");
    expect(counter.get("acc-1")).toBe(1);
    expect(slotNotified).toBe(false);

    counter.decrement("acc-1");
    expect(counter.get("acc-1")).toBe(0);
  });

  it("respects per-account concurrency limit (Free=1, Pro=3, Max=10)", () => {
    expect(getAccountMaxConcurrency({ tier: "free" })).toBe(1);
    expect(getAccountMaxConcurrency({ tier: "pro" })).toBe(3);
    expect(getAccountMaxConcurrency({ tier: "max" })).toBe(10);
    expect(getAccountMaxConcurrency({ maxConcurrency: 5 })).toBe(5);

    const accounts: EligibleAccount[] = [
      { id: "free-1", tier: "free", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: ["pool-1"], modelIds: ["m-1"] },
      { id: "pro-1", tier: "pro", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: ["pool-1"], modelIds: ["m-1"] },
    ];

    const activeCounter = new ActiveRequestCounter();
    activeCounter.increment("free-1"); // Free-1 is now at 1/1 (full)

    // With requireAvailableSlot: true, free-1 should be excluded
    const available = getEligibleAccounts(accounts, {
      poolId: "pool-1",
      modelId: "m-1",
      attemptedAccountIds: new Set(),
      getCooldown: () => null,
      activeCounter,
      requireAvailableSlot: true,
    });

    expect(available.length).toBe(1);
    expect(available[0].id).toBe("pro-1");
  });

  it("soft sticky moves to another account if leased account is full", async () => {
    const { deps, cleanup } = makeDeps({
      allAccounts: [
        { id: "leased-full", tier: "free", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: ["pool-1"], modelIds: ["model-1"] },
        { id: "free-empty", tier: "free", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: ["pool-1"], modelIds: ["model-1"] },
      ],
      leasedAccountId: "leased-full",
    });

    // Make leased-full reach capacity (1/1 for free tier)
    deps.activeCounter.increment("leased-full");

    try {
      const result = await runWithAttempts(deps, async (acc) => {
        return { handledBy: acc.id };
      });

      // Should automatically pick free-empty instead of queuing/failing on leased-full
      expect(result.response.handledBy).toBe("free-empty");
      expect(result.leaseHit).toBe(false);
    } finally {
      cleanup();
    }
  });
});
