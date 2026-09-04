import { test, expect } from "@playwright/test";

const ADMIN_SECRET = process.env.OLLAMA_PROXY_ADMIN_SECRET;

if (!ADMIN_SECRET) {
  throw new Error(
    "OLLAMA_PROXY_ADMIN_SECRET is not set. Copy .env.example to .env and fill it in " +
      "— the dashboard is behind a login, so the suite cannot run without it.",
  );
}

/** The admin API accepts either header; the SPA sends both. */
const adminHeaders = {
  "X-Admin-Secret": ADMIN_SECRET,
  Authorization: `Bearer ${ADMIN_SECRET}`,
};

test.describe("Ollama Proxy Admin UI & Backend Functional E2E", () => {
  // Every page is gated behind the login screen. The SPA reads the secret from
  // localStorage, so seed it before any script runs — without this, every
  // assertion below sees the login form instead of the page under test.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((secret) => {
      window.localStorage.setItem("ollama_proxy_admin_secret", secret);
    }, ADMIN_SECRET);
  });

  test("1. Overview dashboard renders KPI metrics and navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("Usage & Analytics");
    await expect(page.getByText("TOTAL REQUESTS")).toBeVisible();
    await expect(page.getByText("TOTAL TOKENS", { exact: true })).toBeVisible();
    await expect(page.getByText("EST. COST")).toBeVisible();
    await expect(page.getByText("System Ready")).toBeVisible();
  });

  test("2. Accounts page — create new account via modal with Test Key button", async ({
    page,
    request,
  }) => {
    const accountName = `E2E Cluster ${Date.now()}`;

    await page.goto("/accounts");
    await expect(page.locator("h1")).toHaveText("Providers");

    // "Add First Connection" replaces "Add Connection" when no accounts exist.
    await page.getByRole("button", { name: /Add (First )?Connection/ }).first().click();

    await expect(
      page.getByRole("heading", { name: "Add Ollama Cloud Account Connection" }),
    ).toBeVisible();

    await page.getByPlaceholder("e.g. Personal Account 1, Org Cluster").fill(accountName);
    await page.getByPlaceholder("ae1dca08... or ollama_...").fill("ollama_e2e_placeholder_key");

    await expect(page.getByRole("button", { name: "Test Key" })).toBeVisible();

    await page.getByRole("button", { name: "Save Connection" }).click();

    await expect(page.getByText(accountName).first()).toBeVisible({ timeout: 10_000 });

    // Don't leave a dead account behind for the next run.
    const list = await (await request.get("/api/admin/accounts", { headers: adminHeaders })).json();
    const created = list.find((a: { name: string }) => a.name === accountName);
    expect(created).toBeTruthy();
    await request.delete(`/api/admin/accounts/${created.id}`, { headers: adminHeaders });
  });

  test("3. API Keys page — generate proxy API key and retrieve secret", async ({ page }) => {
    await page.goto("/api-keys");
    await expect(page.locator("h1")).toHaveText("Client API Keys & Integration");

    await page.getByRole("button", { name: "Generate Key" }).first().click();
    await page.getByPlaceholder("e.g. Dify Production, OpenCode Dev").fill("Dify Agent Token");
    await page.getByRole("button", { name: "Generate", exact: true }).click();

    await expect(page.getByText("Save Your Secret Key Now")).toBeVisible({ timeout: 5000 });
    // Match the full secret exactly — the Dify and Python integration snippets
    // further down the page also contain the literal "sk-proxy-".
    const secretElem = page.getByText(/^sk-proxy-[0-9a-f]{64}$/);
    await expect(secretElem).toBeVisible();

    const secretText = await secretElem.innerText();
    expect(secretText).toContain("sk-proxy-");

    await page.getByRole("button", { name: "Done, I have saved it" }).click();
    await expect(page.getByText("Dify Agent Token").first()).toBeVisible();
  });

  test("4. Proxy API verification — call GET /v1/models using generated key", async ({
    request,
  }) => {
    const keyRes = await request.post("/api/admin/api-keys", {
      headers: adminHeaders,
      data: { name: "Direct Test Key" },
    });
    expect(keyRes.ok()).toBeTruthy();
    const keyData = await keyRes.json();
    const secret = keyData.secret;

    const modelsRes = await request.get("/v1/models", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(modelsRes.ok()).toBeTruthy();
    const modelsData = await modelsRes.json();
    expect(modelsData.object).toBe("list");

    await request.delete(`/api/admin/api-keys/${keyData.id}`, { headers: adminHeaders });
  });

  test("5. Routing Policy page — update configuration and verify save", async ({ page }) => {
    await page.goto("/routing");
    await expect(page.locator("h1")).toHaveText("Routing & Load Balancing Policy");

    const ttlInput = page.locator('input[type="number"]').first();
    await ttlInput.fill("2400");

    await page.getByRole("button", { name: "Save Routing Policy" }).click();
    await expect(page.getByText("Routing policy updated successfully.")).toBeVisible({
      timeout: 5000,
    });
  });

  test("6. System Status page — health tiles operational", async ({ page }) => {
    await page.goto("/status");
    await expect(page.locator("h1")).toHaveText("System Status & Health");
    await expect(page.getByText("Online")).toBeVisible();
    await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  });

  test("7. Quota Tracker reports locally-configured limits, not invented ones", async ({
    page,
    request,
  }) => {
    const quota = await (await request.get("/api/admin/quota", { headers: adminHeaders })).json();
    expect(quota.limitsSource).toBe("local-config");
    expect(quota.window.sessionHours).toBeGreaterThan(0);

    for (const acc of quota.accounts) {
      // The old build synthesised "<name>@ollama.cloud" and printed a fixed
      // "in 3h 30m" — neither was real data.
      expect(acc).not.toHaveProperty("email");
      expect(acc.session.resetText).not.toBe("in 3h 30m");
      expect(acc.weekly.resetText).not.toBe("in 5d 12h");
    }

    await page.goto("/quota");
    await expect(page.locator("h1")).toHaveText("Quota Tracker");
    await expect(page.getByText(/local limits/)).toBeVisible();
  });

  test("8. Analytics reports no invented cache or cost figures", async ({ request }) => {
    const res = await request.get("/api/admin/analytics?range=today", { headers: adminHeaders });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // cachedTokens used to be inputTokens * 0.85 presented as measured data.
    expect(data).not.toHaveProperty("cachedTokens");
    expect(data.totalTokens).toBe(data.inputTokens + data.outputTokens);

    // With no rates configured, cost must read zero rather than a made-up rate.
    if (!data.costRatesConfigured) {
      expect(data.estimatedCost).toBe("$0.00");
    }
  });
});

test.describe("Admin authentication hardening", () => {
  test("9. admin API rejects missing and wrong secrets", async ({ request }) => {
    expect((await request.get("/api/admin/accounts")).status()).toBe(401);
    expect(
      (
        await request.get("/api/admin/accounts", {
          headers: { "X-Admin-Secret": "definitely-not-the-secret" },
        })
      ).status(),
    ).toBe(401);
    expect((await request.get("/api/admin/accounts", { headers: adminHeaders })).ok()).toBeTruthy();
  });

  test("10. login rejects a wrong password and accepts the real one", async ({ request }) => {
    const bad = await request.post("/api/admin/auth/login", {
      data: { secret: "wrong-password" },
    });
    expect(bad.status()).toBe(401);

    const good = await request.post("/api/admin/auth/login", { data: { secret: ADMIN_SECRET } });
    expect(good.ok()).toBeTruthy();
    expect((await good.json()).success).toBe(true);
  });

  // Runs last: it deliberately trips the lockout, which stays armed for 15
  // minutes and would turn later 401 assertions into 429s.
  test("11. brute force is throttled, and the real secret still gets through", async ({
    request,
  }) => {
    let sawLockout = false;
    for (let i = 0; i < 15; i++) {
      const res = await request.post("/api/admin/auth/login", {
        data: { secret: `guess-${i}` },
      });
      if (res.status() === 429) {
        sawLockout = true;
        break;
      }
      expect(res.status()).toBe(401);
    }
    // Previously this endpoint was exempt from the lockout entirely.
    expect(sawLockout).toBe(true);

    // A locked-out IP must never lock out the legitimate admin, or one attacker
    // can deny service to everyone behind the same reverse proxy.
    const good = await request.post("/api/admin/auth/login", { data: { secret: ADMIN_SECRET } });
    expect(good.ok()).toBeTruthy();

    const guarded = await request.get("/api/admin/accounts", { headers: adminHeaders });
    expect(guarded.ok()).toBeTruthy();
  });
});
