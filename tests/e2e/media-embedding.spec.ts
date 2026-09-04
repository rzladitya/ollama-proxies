import { test, expect } from "@playwright/test";

const ADMIN_SECRET = process.env.OLLAMA_PROXY_ADMIN_SECRET;

if (!ADMIN_SECRET) {
  throw new Error("OLLAMA_PROXY_ADMIN_SECRET is not set — copy .env.example to .env first.");
}

const adminHeaders = {
  "X-Admin-Secret": ADMIN_SECRET,
  Authorization: `Bearer ${ADMIN_SECRET}`,
};

test.describe("Media Providers — Embedding", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((secret) => {
      window.localStorage.setItem("ollama_proxy_admin_secret", secret);
    }, ADMIN_SECRET);
  });

  test("1. sidebar exposes Media Providers with only Embedding enabled", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Media Providers/ }).click();

    await expect(page.getByRole("link", { name: "Embedding" })).toBeVisible();

    // The other submenu entries are placeholders — rendered, but not links.
    for (const label of ["Text to Image", "Text To Speech", "Speech To Text", "Video"]) {
      await expect(page.getByRole("link", { name: label })).toHaveCount(0);
      await expect(page.locator("nav").getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("2. provider grid locks every provider except OpenRouter", async ({ request }) => {
    const res = await request.get("/api/admin/embedding/providers", { headers: adminHeaders });
    expect(res.ok()).toBeTruthy();
    const { providers } = await res.json();

    const unlocked = providers.filter((p: { locked: boolean }) => !p.locked);
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0].id).toBe("openrouter");
    expect(providers.length).toBeGreaterThan(10);
  });

  test("3. a locked provider refuses connections", async ({ request }) => {
    const res = await request.post("/api/admin/embedding/connections", {
      headers: adminHeaders,
      data: { providerId: "openai", name: "should-fail", apiKey: "x" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.message).toContain("not available yet");
  });

  test("4. Embedding page opens on the provider detail, matching the Providers page", async ({
    page,
  }) => {
    await page.goto("/media/embedding");
    await expect(page.locator("h1")).toHaveText("Embedding");

    // Detail is the default view, exactly as Providers opens on Ollama Cloud.
    await expect(page.getByRole("heading", { name: "OpenRouter" })).toBeVisible();
    for (const heading of [/^Connections$/, /^Embedding Models/, /^Test Console$/]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expect(page.getByRole("switch", { name: "Round Robin" })).toBeVisible();

    // …and "Back to Providers" returns to the catalog grid.
    await page.getByRole("button", { name: "Back to Providers" }).click();
    await expect(page.getByRole("heading", { name: "Embedding Providers" })).toBeVisible();
    await expect(page.getByText("Coming soon").first()).toBeVisible();
  });

  test("5. connection CRUD round-trips", async ({ request }) => {
    const created = await request.post("/api/admin/embedding/connections", {
      headers: adminHeaders,
      data: { providerId: "openrouter", name: "e2e-conn", apiKey: "sk-or-v1-placeholder" },
    });
    expect(created.status()).toBe(201);
    const conn = await created.json();
    // A stored credential must never travel back to the browser.
    expect(conn).not.toHaveProperty("encryptedApiKey");

    const patched = await request.patch(`/api/admin/embedding/connections/${conn.id}`, {
      headers: adminHeaders,
      data: { enabled: false },
    });
    expect((await patched.json()).enabled).toBe(false);

    const deleted = await request.delete(`/api/admin/embedding/connections/${conn.id}`, {
      headers: adminHeaders,
    });
    expect(deleted.status()).toBe(204);
  });

  test("6. model catalog is seeded and editable", async ({ request }) => {
    const detail = await (
      await request.get("/api/admin/embedding/providers/openrouter", { headers: adminHeaders })
    ).json();
    expect(detail.models.length).toBeGreaterThan(0);
    expect(detail.models.map((m: { publicModelId: string }) => m.publicModelId)).toContain(
      "openrouter/openai/text-embedding-3-small",
    );

    const added = await request.post("/api/admin/embedding/models", {
      headers: adminHeaders,
      data: { providerId: "openrouter", publicModelId: "openrouter/e2e/probe-model" },
    });
    expect(added.status()).toBe(201);
    const model = await added.json();
    // The upstream id drops the provider prefix.
    expect(model.upstreamModelId).toBe("e2e/probe-model");

    const dup = await request.post("/api/admin/embedding/models", {
      headers: adminHeaders,
      data: { providerId: "openrouter", publicModelId: "openrouter/e2e/probe-model" },
    });
    expect(dup.status()).toBe(400);

    const removed = await request.delete(`/api/admin/embedding/models/${model.id}`, {
      headers: adminHeaders,
    });
    expect(removed.status()).toBe(204);
  });

  test("6b. per-model test runs through the real connection pool", async ({ request }) => {
    const detail = await (
      await request.get("/api/admin/embedding/providers/openrouter", { headers: adminHeaders })
    ).json();
    const model = detail.models.find(
      (m: { publicModelId: string }) =>
        m.publicModelId === "openrouter/openai/text-embedding-3-small",
    );
    expect(model).toBeTruthy();

    const res = await request.post(`/api/admin/embedding/models/${model.id}/test`, {
      headers: adminHeaders,
      data: { input: "e2e embedding probe" },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();

    // The endpoint reports rather than throws, so assert on the payload.
    expect(result.modelId).toBe("openrouter/openai/text-embedding-3-small");
    if (result.success) {
      expect(result.dimensions).toBeGreaterThan(0);
      expect(result.preview.length).toBeGreaterThan(0);
      expect(result.connectionName).toBeTruthy();
    } else {
      // No usable connection is a legitimate outcome on a fresh install.
      expect(result.error).toBeTruthy();
    }

    // A model that does not exist is a 404, not a soft failure.
    const missing = await request.post("/api/admin/embedding/models/does-not-exist/test", {
      headers: adminHeaders,
      data: {},
    });
    expect(missing.status()).toBe(404);
  });

  test("7. /v1/embeddings is gated by a proxy key", async ({ request }) => {
    const anon = await request.post("/v1/embeddings", {
      data: { model: "openrouter/openai/text-embedding-3-small", input: "hi" },
    });
    expect(anon.status()).toBe(401);

    const keyRes = await request.post("/api/admin/api-keys", {
      headers: adminHeaders,
      data: { name: "e2e-embedding-key" },
    });
    const key = await keyRes.json();
    const keyHeaders = { Authorization: `Bearer ${key.secret}` };

    const catalog = await request.get("/v1/embeddings/models", { headers: keyHeaders });
    expect(catalog.ok()).toBeTruthy();
    expect((await catalog.json()).object).toBe("list");

    const unknown = await request.post("/v1/embeddings", {
      headers: keyHeaders,
      data: { model: "not/a-model", input: "hi" },
    });
    expect(unknown.status()).toBe(404);

    const invalid = await request.post("/v1/embeddings", {
      headers: keyHeaders,
      data: { model: "openrouter/openai/text-embedding-3-small", input: "" },
    });
    expect(invalid.status()).toBe(400);

    await request.delete(`/api/admin/api-keys/${key.id}`, { headers: adminHeaders });
  });
});

test.describe("Admin password reset", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((secret) => {
      window.localStorage.setItem("ollama_proxy_admin_secret", secret);
    }, ADMIN_SECRET);
  });

  test("8. Settings exposes the password form", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Admin Password" })).toBeVisible();
    await expect(page.getByText("Recovery credential")).toBeVisible();
  });

  test("9. change-password validates its inputs", async ({ request }) => {
    const cases: Array<[Record<string, string>, number]> = [
      [{ currentPassword: "definitely-wrong", newPassword: "a-valid-password" }, 401],
      [{ currentPassword: ADMIN_SECRET, newPassword: "short" }, 400],
      [{ currentPassword: ADMIN_SECRET, newPassword: ADMIN_SECRET }, 400],
      [{ newPassword: "missing-current" }, 400],
    ];

    for (const [data, expected] of cases) {
      const res = await request.post("/api/admin/auth/change-password", {
        headers: adminHeaders,
        data,
      });
      expect(res.status(), JSON.stringify(data)).toBe(expected);
    }
  });

  test("10. password can be changed, and .env stays a recovery credential", async ({ request }) => {
    const NEW = "e2e-rotated-password";

    const changed = await request.post("/api/admin/auth/change-password", {
      headers: adminHeaders,
      data: { currentPassword: ADMIN_SECRET, newPassword: NEW },
    });
    expect(changed.ok()).toBeTruthy();

    const status = await (
      await request.get("/api/admin/auth/password-status", { headers: adminHeaders })
    ).json();
    expect(status.customPasswordSet).toBe(true);

    // The new password works…
    expect((await request.post("/api/admin/auth/login", { data: { secret: NEW } })).ok()).toBeTruthy();
    // …and so does the env value, by design.
    expect(
      (await request.post("/api/admin/auth/login", { data: { secret: ADMIN_SECRET } })).ok(),
    ).toBeTruthy();
    // Anything else still does not.
    expect(
      (await request.post("/api/admin/auth/login", { data: { secret: "nope-nope" } })).status(),
    ).toBe(401);

    // Restore, so a re-run starts from the same state.
    const restored = await request.post("/api/admin/auth/change-password", {
      headers: { "X-Admin-Secret": NEW },
      data: { currentPassword: NEW, newPassword: ADMIN_SECRET },
    });
    expect(restored.ok()).toBeTruthy();
  });
});
