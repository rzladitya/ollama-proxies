import type { ErrorCategory } from "@ollama-proxy/shared";

// ── Types ──

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: unknown[];
  user?: string;
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface StreamDelta {
  role?: string;
  content?: string;
  tool_calls?: unknown[];
}

export interface StreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: StreamDelta;
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface UpstreamModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  object: "list";
  data: UpstreamModel[];
}

export interface SendOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onFirstOutput?: () => void;
}

// ── Task 020: Error Classification ──

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly category: ErrorCategory,
    public readonly retryable: boolean,
    public readonly responseBody?: string,
    /** Retry-After header value in seconds, if present */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export function classifyHttpError(statusCode: number, body?: string): {
  category: ErrorCategory;
  retryable: boolean;
} {
  switch (statusCode) {
    case 400:
      return { category: "CLIENT_VALIDATION_ERROR", retryable: false };
    case 401:
      return { category: "UPSTREAM_AUTH_ERROR", retryable: true };
    case 402:
      // Model requires paid subscription/tier upgrade
      return { category: "MODEL_NOT_AVAILABLE", retryable: false };
    case 403:
      return { category: "UPSTREAM_AUTH_ERROR", retryable: true };
    case 404:
      return { category: "MODEL_NOT_AVAILABLE", retryable: true };
    case 429:
      return { category: "UPSTREAM_RATE_LIMIT", retryable: true };
    default:
      if (statusCode >= 500) {
        return { category: "UPSTREAM_5XX", retryable: true };
      }
      return { category: "INTERNAL_ERROR", retryable: false };
  }
}

export function classifyError(error: unknown): {
  category: ErrorCategory;
  retryable: boolean;
  retryAfterSeconds?: number;
} {
  if (error instanceof UpstreamError) {
    return { category: error.category, retryable: error.retryable, retryAfterSeconds: error.retryAfterSeconds };
  }
  // Timeout: AbortError from AbortController or our own timeout Error
  if (error instanceof DOMException && error.name === "AbortError") {
    return { category: "UPSTREAM_TIMEOUT", retryable: true };
  }
  if (error instanceof Error && error.message === "Request timeout") {
    return { category: "UPSTREAM_TIMEOUT", retryable: true };
  }
  if (error instanceof TypeError) {
    // fetch throws TypeError on network/DNS errors
    return { category: "UPSTREAM_CONNECTION_ERROR", retryable: true };
  }
  return { category: "INTERNAL_ERROR", retryable: false };
}

/** Parse Retry-After header value to seconds. Returns undefined if not parseable. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds) && seconds > 0) return Math.ceil(seconds);
  // RFC 7231 date format
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    const delta = Math.ceil((date - Date.now()) / 1000);
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}

// ── Task 021: AbortController with timeout ──

function createTimeoutSignal(
  timeoutMs: number | undefined,
  externalSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs) {
    timer = setTimeout(() => controller.abort(new Error("Request timeout")), timeoutMs);
  }

  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

// ── Ollama Client ──

const OLLAMA_CLOUD_BASE = "https://ollama.com";

export interface OllamaClientConfig {
  baseUrl?: string;
}

export class OllamaClient {
  private readonly baseUrl: string;

  constructor(config?: OllamaClientConfig) {
    this.baseUrl = (config?.baseUrl ?? OLLAMA_CLOUD_BASE).replace(/\/+$/, "");
  }

  // ── Task 017: Non-streaming chat completion ──

  async chatCompletion(
    apiKey: string,
    request: ChatCompletionRequest,
    options?: SendOptions,
  ): Promise<ChatCompletionResponse> {
    const { signal, cleanup } = createTimeoutSignal(options?.timeoutMs, options?.signal);
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...request, stream: false }),
        signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const { category, retryable } = classifyHttpError(res.status, body);
        throw new UpstreamError(
          `Upstream ${res.status}: ${body.slice(0, 200)}`,
          res.status,
          category,
          retryable,
          body,
          parseRetryAfter(res.headers.get("retry-after")),
        );
      }

      const data = (await res.json()) as ChatCompletionResponse;
      options?.onFirstOutput?.();
      return data;
    } finally {
      cleanup();
    }
  }

  // ── Task 018: SSE streaming chat completion ──

  async *chatCompletionStream(
    apiKey: string,
    request: ChatCompletionRequest,
    options?: SendOptions,
  ): AsyncGenerator<StreamChunk, void, undefined> {
    const { signal, cleanup } = createTimeoutSignal(options?.timeoutMs, options?.signal);
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...request, stream: true }),
        signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const { category, retryable } = classifyHttpError(res.status, body);
        throw new UpstreamError(
          `Upstream ${res.status}: ${body.slice(0, 200)}`,
          res.status,
          category,
          retryable,
          body,
          parseRetryAfter(res.headers.get("retry-after")),
        );
      }

      if (!res.body) {
        throw new UpstreamError("No response body for stream", 0, "INTERNAL_ERROR", false);
      }

      let firstOutput = true;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (!trimmed.startsWith("data: ")) continue;

            const payload = trimmed.slice(6);
            if (payload === "[DONE]") return;

            try {
              const chunk = JSON.parse(payload) as StreamChunk;
              if (firstOutput) {
                firstOutput = false;
                options?.onFirstOutput?.();
              }
              yield chunk;
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      cleanup();
    }
  }

  // ── Task 019: Model list fetch ──

  async listModels(
    apiKey: string,
    options?: SendOptions,
  ): Promise<UpstreamModel[]> {
    const { signal, cleanup } = createTimeoutSignal(options?.timeoutMs, options?.signal);
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const { category, retryable } = classifyHttpError(res.status, body);
        throw new UpstreamError(
          `Upstream ${res.status}: ${body.slice(0, 200)}`,
          res.status,
          category,
          retryable,
          body,
          parseRetryAfter(res.headers.get("retry-after")),
        );
      }

      const data = (await res.json()) as ModelsResponse;
      return data.data ?? [];
    } finally {
      cleanup();
    }
  }
}
