export {
  encrypt,
  decrypt,
  decryptLegacy,
  generateProxyKey,
  hashSecret,
  redact,
  redactObject,
} from "./security.js";
export type { GeneratedProxyKey } from "./security.js";

export type AccountState =
  | "ACTIVE"
  | "DEGRADED"
  | "COOLDOWN"
  | "INVALID"
  | "DISABLED";

export type ErrorCategory =
  | "CLIENT_AUTH_ERROR"
  | "CLIENT_VALIDATION_ERROR"
  | "MODEL_NOT_AVAILABLE"
  | "NO_ELIGIBLE_ACCOUNT"
  | "UPSTREAM_AUTH_ERROR"
  | "UPSTREAM_RATE_LIMIT"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_CONNECTION_ERROR"
  | "UPSTREAM_5XX"
  | "STREAM_INTERRUPTED"
  | "INTERNAL_ERROR";

export type RoutingSelection = "PRIORITY_LEAST_LOAD_WEIGHTED";

export interface RoutingConfig {
  stickyEnabled: boolean;
  leaseTtlSeconds: number;
  extendLeaseOnSuccess: boolean;
  maxAttempts: number;
  rateLimitCooldownSeconds: number;
  transientFailureCooldownSeconds: number;
  transientFailureThreshold: number;
  selection: RoutingSelection;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  stickyEnabled: true,
  leaseTtlSeconds: 1800,
  extendLeaseOnSuccess: true,
  maxAttempts: 3,
  rateLimitCooldownSeconds: 300,
  transientFailureCooldownSeconds: 120,
  transientFailureThreshold: 3,
  selection: "PRIORITY_LEAST_LOAD_WEIGHTED",
};
