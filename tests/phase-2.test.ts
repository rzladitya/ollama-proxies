import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  generateProxyKey,
  hashSecret,
  redact,
  redactObject,
} from "@ollama-proxy/shared";

const TEST_KEY = "test-encryption-key-for-phase-2";

// ── Task 013: Encryption ──

describe("Phase 2 — Task 013: Encryption Service", () => {
  it("encrypt + decrypt round-trips plaintext", () => {
    const plaintext = "sk-real-upstream-api-key-12345";
    const encrypted = encrypt(plaintext, TEST_KEY);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).not.toContain(plaintext);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it("different encryptions of same plaintext produce different ciphertext (random IV)", () => {
    const plaintext = "same-key";
    const a = encrypt(plaintext, TEST_KEY);
    const b = encrypt(plaintext, TEST_KEY);
    expect(a).not.toBe(b);
    // Both decrypt to same value
    expect(decrypt(a, TEST_KEY)).toBe(plaintext);
    expect(decrypt(b, TEST_KEY)).toBe(plaintext);
  });

  it("wrong key fails to decrypt", () => {
    const encrypted = encrypt("secret", TEST_KEY);
    expect(() => decrypt(encrypted, "wrong-key")).toThrow();
  });

  it("tampered ciphertext fails", () => {
    const encrypted = encrypt("secret", TEST_KEY);
    const buf = Buffer.from(encrypted, "base64");
    buf[buf.length - 1] ^= 0xff; // flip last byte of auth tag
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered, TEST_KEY)).toThrow();
  });

  it("throws if encryption key is empty", () => {
    expect(() => encrypt("secret", "")).toThrow("OLLAMA_PROXY_ENCRYPTION_KEY");
    expect(() => decrypt("data", "")).toThrow("OLLAMA_PROXY_ENCRYPTION_KEY");
  });

  it("handles empty string plaintext", () => {
    const encrypted = encrypt("", TEST_KEY);
    expect(decrypt(encrypted, TEST_KEY)).toBe("");
  });

  it("handles unicode plaintext", () => {
    const plaintext = "こんにちは世界 🔑";
    const encrypted = encrypt(plaintext, TEST_KEY);
    expect(decrypt(encrypted, TEST_KEY)).toBe(plaintext);
  });
});

// ── Task 014: Proxy Key ──

describe("Phase 2 — Task 014: Proxy Key Generation", () => {
  it("generates key with sk-proxy- prefix", () => {
    const { secret } = generateProxyKey();
    expect(secret).toMatch(/^sk-proxy-[a-f0-9]{64}$/);
  });

  it("keyPrefix is first 12 chars", () => {
    const { secret, keyPrefix } = generateProxyKey();
    expect(keyPrefix).toBe(secret.slice(0, 12));
    expect(keyPrefix).toMatch(/^sk-proxy-[a-f0-9]{3}$/);
  });

  it("secretHash is SHA-256 hex of full secret", () => {
    const { secret, secretHash } = generateProxyKey();
    expect(secretHash).toBe(hashSecret(secret));
    expect(secretHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("each key is unique", () => {
    const a = generateProxyKey();
    const b = generateProxyKey();
    expect(a.secret).not.toBe(b.secret);
    expect(a.secretHash).not.toBe(b.secretHash);
  });

  it("hashSecret is deterministic", () => {
    expect(hashSecret("test")).toBe(hashSecret("test"));
  });
});

// ── Task 015: Redaction ──

describe("Phase 2 — Task 015: Redaction", () => {
  it("redacts sk-proxy- keys", () => {
    const input = "Key is sk-proxy-abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    expect(redact(input)).toBe("Key is [REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer sk-some-long-api-key-here";
    expect(redact(input)).toBe("Authorization: Bearer [REDACTED]");
  });

  it("redacts generic sk- API keys", () => {
    const dummy = ["sk", "testdummyfakekeyfortesting12345"].join("-");
    const input = `key=${dummy}`;
    expect(redact(input)).toBe("key=[REDACTED]");
  });

  it("does not redact normal text", () => {
    const input = "Hello world, request completed";
    expect(redact(input)).toBe(input);
  });

  it("redactObject strips secret-named fields", () => {
    const obj = {
      name: "test",
      apiKey: "real-key",
      encrypted_api_key: "enc-data",
      password: "hunter2",
      normal: "visible",
    };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result.name).toBe("test");
    expect(result.apiKey).toBe("[REDACTED]");
    expect(result.encrypted_api_key).toBe("[REDACTED]");
    expect(result.password).toBe("[REDACTED]");
    expect(result.normal).toBe("visible");
  });

  it("redactObject handles nested objects", () => {
    const obj = { outer: { secret: "hidden", data: "visible" } };
    const result = redactObject(obj) as { outer: Record<string, unknown> };
    expect(result.outer.secret).toBe("[REDACTED]");
    expect(result.outer.data).toBe("visible");
  });

  it("redactObject handles arrays", () => {
    const arr = [{ token: "abc" }, { name: "ok" }];
    const result = redactObject(arr) as Record<string, unknown>[];
    expect(result[0].token).toBe("[REDACTED]");
    expect(result[1].name).toBe("ok");
  });

  it("redactObject handles null/undefined", () => {
    expect(redactObject(null)).toBeNull();
    expect(redactObject(undefined)).toBeUndefined();
  });
});
