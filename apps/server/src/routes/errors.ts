import type { FastifyReply } from "fastify";
import type { ErrorCategory } from "@ollama-proxy/shared";

/**
 * Task 027: OpenAI-compatible error envelope.
 * All proxy errors use { error: { message, type, code } }.
 */

interface OpenAIError {
  message: string;
  type: string;
  code: string;
}

const CATEGORY_MAP: Record<
  ErrorCategory,
  { status: number; type: string; code: string }
> = {
  CLIENT_AUTH_ERROR: {
    status: 401,
    type: "authentication_error",
    code: "invalid_api_key",
  },
  CLIENT_VALIDATION_ERROR: {
    status: 400,
    type: "invalid_request_error",
    code: "invalid_request",
  },
  MODEL_NOT_AVAILABLE: {
    status: 404,
    type: "invalid_request_error",
    code: "model_not_found",
  },
  NO_ELIGIBLE_ACCOUNT: {
    status: 503,
    type: "server_error",
    code: "no_eligible_account",
  },
  UPSTREAM_AUTH_ERROR: {
    status: 502,
    type: "server_error",
    code: "upstream_auth_error",
  },
  UPSTREAM_RATE_LIMIT: {
    status: 429,
    type: "server_error",
    code: "rate_limit_exceeded",
  },
  UPSTREAM_TIMEOUT: {
    status: 504,
    type: "server_error",
    code: "upstream_timeout",
  },
  UPSTREAM_CONNECTION_ERROR: {
    status: 502,
    type: "server_error",
    code: "upstream_connection_error",
  },
  UPSTREAM_5XX: {
    status: 502,
    type: "server_error",
    code: "upstream_error",
  },
  STREAM_INTERRUPTED: {
    status: 502,
    type: "server_error",
    code: "stream_interrupted",
  },
  INTERNAL_ERROR: {
    status: 500,
    type: "server_error",
    code: "internal_error",
  },
};

export function sendOpenAIError(
  reply: FastifyReply,
  status: number,
  message: string,
  type = "invalid_request_error",
  code = "invalid_request",
): void {
  reply.code(status).send({
    error: { message, type, code } satisfies OpenAIError,
  });
}

export function sendCategoryError(
  reply: FastifyReply,
  category: ErrorCategory,
  message: string,
): void {
  const mapped = CATEGORY_MAP[category];
  sendOpenAIError(reply, mapped.status, message, mapped.type, mapped.code);
}
