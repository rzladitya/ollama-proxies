import { randomBytes } from "node:crypto";

/**
 * Task 028: X-Request-ID — sortable, unique request identifier.
 * Format: req_<timestamp-hex>_<random-hex>
 */
export function generateRequestId(): string {
  const ts = Date.now().toString(16);
  const rand = randomBytes(6).toString("hex");
  return `req_${ts}_${rand}`;
}
