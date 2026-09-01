import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CooldownManager,
  FailureWindowCounter,
  HealthManager,
  runWithAttempts,
  LeaseStore,
  ActiveRequestCounter,
  type EligibleAccount,
} from "@ollama-proxy/routing-core";
import { DEFAULT_ROUTING_CONFIG } from "@ollama-proxy/shared";
import { UpstreamError } from "@ollama-proxy/ollama-client";
import { generateRequestId } from "../apps/server/src/routes/request-id.js";
import { RequestTrace } from "../apps/server/src/telemetry.js";

describe("Phase 6: Cooldown & Failover", () => {
  let cooldown: CooldownManager;
  let failures: FailureWindowCounter;
  let health: HealthManager;

  beforeEach(() => {
    cooldown = new CooldownManager();
    failures = new FailureWindowCounter(120_000);
    health = new HealthManager(cooldown, failures);
  });

  afterEach(() => {
    cooldown.clear();
    failures.clear();
    health.clear();
  });

  it("Task 036: Cooldown manager sets and expires cooldowns", () => {
    cooldown.setCooldown("acc-1", 100, "rate_limit");
    expect(cooldown.getCooldown("acc-1")).not.toBeNull();
    expect(cooldown.getCooldown("acc-1")?.reason).toBe("rate_limit");

    // Clear explicitly
    cooldown.clearCooldown("acc-1");
    expect(cooldown.getCooldown("acc-1")).toBeNull();
  });

  it("Task 039: Failure window counter tracks rolling failures", () => {
    expect(failures.record("acc-1")).toBe(1);
    expect(failures.record("acc-1")).toBe(2);
    expect(failures.getCount("acc-1")).toBe(2);
    failures.reset("acc-1");
    expect(failures.getCount("acc-1")).toBe(0);
  });

  it("Task 037: HealthManager state machine — rate limit triggers immediate COOLDOWN", () => {
    const transition = health.recordFailure("acc-1", "UPSTREAM_RATE_LIMIT", DEFAULT_ROUTING_CONFIG);
    expect(transition?.newState).toBe("COOLDOWN");
    expect(health.getState("acc-1")).toBe("COOLDOWN");
    expect(cooldown.getCooldown("acc-1")).not.toBeNull();
  });

  it("Task 037: HealthManager state machine — auth error triggers immediate INVALID", () => {
    const transition = health.recordFailure("acc-1", "UPSTREAM_AUTH_ERROR", DEFAULT_ROUTING_CONFIG);
    expect(transition?.newState).toBe("INVALID");
    expect(health.getState("acc-1")).toBe("INVALID");
  });

  it("Task 037: HealthManager state machine — transient failure goes DEGRADED then COOLDOWN at threshold", () => {
    const t1 = health.recordFailure("acc-1", "UPSTREAM_5XX", DEFAULT_ROUTING_CONFIG);
    expect(t1?.newState).toBe("DEGRADED");
    expect(health.getState("acc-1")).toBe("DEGRADED");

    health.recordFailure("acc-1", "UPSTREAM_5XX", DEFAULT_ROUTING_CONFIG);
    const t3 = health.recordFailure("acc-1", "UPSTREAM_5XX", DEFAULT_ROUTING_CONFIG);
    expect(t3?.newState).toBe("COOLDOWN");
    expect(health.getState("acc-1")).toBe("COOLDOWN");
  });

  it("Task 037: HealthManager — success restores ACTIVE", () => {
    health.recordFailure("acc-1", "UPSTREAM_RATE_LIMIT", DEFAULT_ROUTING_CONFIG);
    expect(health.getState("acc-1")).toBe("COOLDOWN");

    const t = health.recordSuccess("acc-1");
    expect(t?.newState).toBe("ACTIVE");
    expect(health.getState("acc-1")).toBe("ACTIVE");
    expect(cooldown.getCooldown("acc-1")).toBeNull();
  });

  it("Task 035 & 038: Attempt runner orchestrates failover and migrates lease", async () => {
    const activeCounter = new ActiveRequestCounter();
    const leaseStore = new LeaseStore();

    const accounts: EligibleAccount[] = [
      { id: "acc-1", enabled: true, state: "ACTIVE", priority: 2, weight: 1, poolIds: ["pool-1"], modelIds: ["model-1"] },
      { id: "acc-2", enabled: true, state: "ACTIVE", priority: 1, weight: 1, poolIds: ["pool-1"], modelIds: ["model-1"] },
    ];

    let attemptsMade = 0;

    const result = await runWithAttempts(
      {
        allAccounts: accounts,
        activeCounter,
        cooldownManager: cooldown,
        healthManager: health,
        leaseStore,
        routingConfig: DEFAULT_ROUTING_CONFIG,
        poolId: "pool-1",
        modelId: "model-1",
        proxyKeyId: "key-1",
        leaseKey: "lease-1",
        leasedAccountId: null,
      },
      async (acc) => {
        attemptsMade++;
        if (acc.id === "acc-1") {
          throw new UpstreamError("Rate limited", 429, "UPSTREAM_RATE_LIMIT", true);
        }
        return { success: true, from: acc.id };
      },
    );

    expect(attemptsMade).toBe(2);
    expect(result.accountId).toBe("acc-2");
    expect(result.attempts).toBe(2);
    expect(result.failovers).toBe(1);
    expect(result.response.from).toBe("acc-2");

    // Task 038: lease migrated to acc-2
    const migratedLease = leaseStore.get("lease-1");
    expect(migratedLease?.accountId).toBe("acc-2");

    leaseStore.destroy();
  });
});

describe("Phase 4 & 9: Utilities & Tracing", () => {
  it("Task 028: generateRequestId produces sortable unique IDs", () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).toMatch(/^req_[a-f0-9]+_[a-f0-9]+$/);
    expect(id2).toMatch(/^req_[a-f0-9]+_[a-f0-9]+$/);
    expect(id1).not.toBe(id2);
  });

  it("Task 055: RequestTrace tracks events and latency", () => {
    const trace = new RequestTrace("req-test-123");
    trace.publicModelId = "llama3.3:70b";
    trace.addEvent("select", "acc-1");
    trace.addEvent("attempt", "acc-1");
    trace.addEvent("success", "acc-1");
    trace.complete();

    expect(trace.events.length).toBe(3);
    expect(typeof trace.latencyMs).toBe("number");
    expect(trace.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
