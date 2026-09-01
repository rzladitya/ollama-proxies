import { z } from "zod";
import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve monorepo root: apps/server/src/config/env.ts -> 4 levels up
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..", "..", "..", "..");

dotenvConfig({ path: resolve(ROOT_DIR, ".env") });

const envSchema = z.object({
  OLLAMA_PROXY_HOST: z.string().default("127.0.0.1"),
  OLLAMA_PROXY_PORT: z.coerce.number().int().default(11435),
  OLLAMA_PROXY_DATA_DIR: z.string().default("./data"),
  OLLAMA_PROXY_ENCRYPTION_KEY: z.string().min(16, "OLLAMA_PROXY_ENCRYPTION_KEY is required (min 16 chars). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""),
  OLLAMA_PROXY_ADMIN_SECRET: z.string().min(8, "OLLAMA_PROXY_ADMIN_SECRET is required (min 8 chars)"),
  OLLAMA_PROXY_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  OLLAMA_PROXY_REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().default(120),
  OLLAMA_PROXY_MAX_ATTEMPTS: z.coerce.number().int().default(3),
});

export type AppConfig = {
  host: string;
  port: number;
  dataDir: string;
  encryptionKey: string;
  adminSecret: string;
  logLevel: string;
  requestTimeoutSeconds: number;
  maxAttempts: number;
};

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  return {
    host: env.OLLAMA_PROXY_HOST,
    port: env.OLLAMA_PROXY_PORT,
    dataDir: resolve(ROOT_DIR, env.OLLAMA_PROXY_DATA_DIR),
    encryptionKey: env.OLLAMA_PROXY_ENCRYPTION_KEY,
    adminSecret: env.OLLAMA_PROXY_ADMIN_SECRET,
    logLevel: env.OLLAMA_PROXY_LOG_LEVEL,
    requestTimeoutSeconds: env.OLLAMA_PROXY_REQUEST_TIMEOUT_SECONDS,
    maxAttempts: env.OLLAMA_PROXY_MAX_ATTEMPTS,
  };
}
