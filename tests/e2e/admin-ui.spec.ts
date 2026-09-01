import { test, expect } from "@playwright/test";

test.describe("Ollama Proxy Admin UI & Backend Functional E2E", () => {
  test("1. Overview dashboard renders KPI metrics and navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("Gateway Overview");
    await expect(page.getByText("Active Accounts")).toBeVisible();
    await expect(page.getByText("Enabled Models")).toBeVisible();
    await expect(page.getByRole("main").getByText("API Keys")).toBeVisible();
    await expect(page.getByText("System Ready")).toBeVisible();
  });

  test("2. Accounts page — create new account via modal with Test Key button", async ({ page }) => {
    await page.goto("/accounts");
    await expect(page.locator("h1")).toHaveText("Upstream Ollama Accounts");

    // Click Add Account button
    await page.getByRole("button", { name: "Add Account" }).first().click();

    // Modal appears
    await expect(page.getByRole("heading", { name: "Add Ollama Cloud Account" })).toBeVisible();

    // Fill form
    await page.getByPlaceholder("e.g. Ollama Pro Account 1").fill("Production Cloud Cluster");
    await page.getByPlaceholder("ae1dca08... or ollama_...").fill("ollama_secret_key_playwright_test");

    // Test Key button in modal is present
    await expect(page.getByRole("button", { name: "Test Key" })).toBeVisible();

    // Save
    await page.getByRole("button", { name: "Save Account" }).click();

    // Account should now be in table
    await expect(page.getByText("Production Cloud Cluster").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Active").first()).toBeVisible();
  });

  test("3. API Keys page — generate proxy API key and retrieve secret", async ({ page }) => {
    await page.goto("/api-keys");
    await expect(page.locator("h1")).toHaveText("Client API Keys");

    // Generate Key
    await page.getByRole("button", { name: "Generate Key" }).first().click();
    await page.getByPlaceholder("e.g. Dify Production, OpenCode Dev").fill("Dify Agent Token");
    await page.getByRole("button", { name: "Generate", exact: true }).click();

    // Alert with secret shown once
    await expect(page.getByText("Save Your Secret Key Now")).toBeVisible({ timeout: 5000 });
    const secretElem = page.locator("div.font-mono").filter({ hasText: "sk-proxy-" });
    await expect(secretElem).toBeVisible();

    // Retrieve generated secret
    const secretText = await secretElem.innerText();
    expect(secretText).toContain("sk-proxy-");

    // Dismiss alert
    await page.getByRole("button", { name: "Done, I have saved it" }).click();
    await expect(page.getByText("Dify Agent Token").first()).toBeVisible();
  });

  test("4. Proxy API verification — call GET /v1/models using generated key", async ({ request }) => {
    // Generate key via Admin API
    const keyRes = await request.post("/api/admin/api-keys", {
      data: { name: "Direct Test Key" },
    });
    if (!keyRes.ok()) {
      console.error("API Key Create Failed:", keyRes.status(), await keyRes.text());
    }
    expect(keyRes.ok()).toBeTruthy();
    const keyData = await keyRes.json();
    const secret = keyData.secret;

    // Call /v1/models with bearer token
    const modelsRes = await request.get("/v1/models", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(modelsRes.ok()).toBeTruthy();
    const modelsData = await modelsRes.json();
    expect(modelsData.object).toBe("list");
  });

  test("5. Routing Policy page — update configuration and verify save", async ({ page }) => {
    await page.goto("/routing");
    await expect(page.locator("h1")).toHaveText("Routing & Load Balancing Policy");

    // Update lease TTL input
    const ttlInput = page.locator('input[type="number"]').first();
    await ttlInput.fill("2400");

    // Save
    await page.getByRole("button", { name: "Save Routing Policy" }).click();
    await expect(page.getByText("Routing policy updated successfully.")).toBeVisible({ timeout: 5000 });
  });

  test("6. System Status page — health tiles operational", async ({ page }) => {
    await page.goto("/status");
    await expect(page.locator("h1")).toHaveText("System Status & Health");
    await expect(page.getByText("Online")).toBeVisible();
    await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  });
});
