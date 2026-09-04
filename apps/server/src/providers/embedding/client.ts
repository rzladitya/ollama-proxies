import { getEmbeddingProvider } from "./registry.js";

/** OpenAI-shaped embeddings request. */
export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  dimensions?: number;
  encoding_format?: string;
  user?: string;
}

export interface EmbeddingResponse {
  object: "list";
  data: Array<{ object: "embedding"; index: number; embedding: number[] }>;
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number; cost?: number };
  [key: string]: unknown;
}

export class EmbeddingUpstreamError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryable: boolean,
    readonly body?: string,
  ) {
    super(message);
    this.name = "EmbeddingUpstreamError";
  }
}

/**
 * 401/403 mean the credential is bad — retrying the same one is pointless, but
 * another connection may still work, so the router treats them as "try the next
 * connection" rather than "give up".
 */
function classify(status: number): { retryable: boolean; invalidatesKey: boolean } {
  if (status === 401 || status === 403) return { retryable: true, invalidatesKey: true };
  if (status === 402 || status === 429) return { retryable: true, invalidatesKey: false };
  if (status >= 500) return { retryable: true, invalidatesKey: false };
  return { retryable: false, invalidatesKey: false };
}

export function classifyEmbeddingStatus(status: number) {
  return classify(status);
}

/**
 * Send one embeddings request upstream. `providerId` selects the endpoint from
 * the registry; only unlocked providers can be called.
 */
export async function callEmbedding(
  providerId: string,
  apiKey: string,
  request: EmbeddingRequest,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<EmbeddingResponse> {
  const provider = getEmbeddingProvider(providerId);
  if (!provider || provider.locked || !provider.endpoint) {
    throw new EmbeddingUpstreamError(
      `Embedding provider '${providerId}' is not available`,
      501,
      false,
    );
  }

  const controller = new AbortController();
  const timer = options?.timeoutMs
    ? setTimeout(() => controller.abort(new Error("Request timeout")), options.timeoutMs)
    : undefined;
  const onAbort = () => controller.abort(options?.signal?.reason);
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new EmbeddingUpstreamError(
        `Upstream ${res.status}: ${body.slice(0, 200)}`,
        res.status,
        classify(res.status).retryable,
        body,
      );
    }

    return (await res.json()) as EmbeddingResponse;
  } finally {
    if (timer) clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}
