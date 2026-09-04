import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

// ── Task 013: AES-256-GCM Encryption ──

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SCRYPT_SALT = "ollama-proxy-v1"; // fixed salt — key is unique per deployment
const SCRYPT_KEYLEN = 32;

/**
 * Derive a 32-byte key from the user-supplied encryption key using scrypt.
 * If input is already 64 hex chars (32 bytes), use directly — user supplied raw key.
 */
function deriveKey(secret: string): Buffer {
  // Accept raw 32-byte hex key directly
  if (/^[0-9a-f]{64}$/i.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  return scryptSync(secret, SCRYPT_SALT, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 });
}

/**
 * Legacy key derivation (v1) — plain SHA-256.
 * Used only by the re-encryption migration to read old data.
 */
function deriveKeyLegacy(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns base64 string: iv(12) + ciphertext + authTag(16).
 */
export function encrypt(plaintext: string, encryptionKey: string): string {
  if (!encryptionKey) throw new Error("OLLAMA_PROXY_ENCRYPTION_KEY is required");
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

/**
 * Decrypt a base64 AES-256-GCM payload.
 * Throws on tampered data or wrong key.
 */
export function decrypt(encoded: string, encryptionKey: string): string {
  if (!encryptionKey) throw new Error("OLLAMA_PROXY_ENCRYPTION_KEY is required");
  const key = deriveKey(encryptionKey);
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

/**
 * Decrypt using legacy v1 SHA-256 key derivation.
 * Used only by the re-encryption migration.
 */
export function decryptLegacy(encoded: string, encryptionKey: string): string {
  if (!encryptionKey) throw new Error("OLLAMA_PROXY_ENCRYPTION_KEY is required");
  const key = deriveKeyLegacy(encryptionKey);
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

// ── Task 014: Proxy Key Generation & Hashing ──

const PROXY_KEY_PREFIX = "sk-proxy-";
const KEY_RANDOM_BYTES = 32;

export interface GeneratedProxyKey {
  /** Full secret shown once: sk-proxy-<64 hex chars> */
  secret: string;
  /** First 12 chars for lookup: sk-proxy-XXXX */
  keyPrefix: string;
  /** SHA-256 hex hash of full secret for DB storage */
  secretHash: string;
}

/**
 * Generate a new proxy API key.
 * Secret shown once. Store only keyPrefix + secretHash.
 */
export function generateProxyKey(): GeneratedProxyKey {
  const random = randomBytes(KEY_RANDOM_BYTES).toString("hex");
  const secret = `${PROXY_KEY_PREFIX}${random}`;
  const keyPrefix = secret.slice(0, 12);
  const secretHash = hashSecret(secret);
  return { secret, keyPrefix, secretHash };
}

/** SHA-256 hex hash of a proxy key secret. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// ── Admin password hashing ──

// Proxy keys are 32 random bytes, so a plain SHA-256 is fine for them. An admin
// password is human-chosen and low-entropy, so it gets scrypt with a per-password
// salt instead — a stolen database should not yield the password to a dictionary run.
const PASSWORD_SCHEME = "scrypt";
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEYLEN = 32;
const PASSWORD_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/** Hash an admin password for storage. Format: `scrypt$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = scryptSync(password, salt, PASSWORD_KEYLEN, PASSWORD_PARAMS);
  return `${PASSWORD_SCHEME}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Verify a password against a stored `hashPassword` value. Never throws. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== PASSWORD_SCHEME) return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    if (expected.length === 0) return false;
    const actual = scryptSync(password, salt, expected.length, PASSWORD_PARAMS);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── Task 015: Redaction ──

// Patterns that look like secrets
const SECRET_PATTERNS = [
  /sk-proxy-[a-f0-9]+/gi,
  /sk-[a-zA-Z0-9_-]{20,}/g, // generic API keys
  /Bearer\s+[a-zA-Z0-9._\-]+/gi,
];

/**
 * Strip secrets from a string (log output, error messages).
 * Replaces known secret patterns with [REDACTED].
 */
export function redact(input: string): string {
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Deep-redact an object for safe logging.
 * Removes fields named like secrets, redacts string values.
 */
export function redactObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return redact(obj) as T;
  if (Array.isArray(obj)) return obj.map(redactObject) as T;
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (
        lower.includes("secret") ||
        lower.includes("apikey") ||
        lower.includes("api_key") ||
        lower.includes("password") ||
        lower.includes("encrypted") ||
        lower.includes("token") ||
        lower.includes("authorization")
      ) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactObject(value);
      }
    }
    return result as T;
  }
  return obj;
}
