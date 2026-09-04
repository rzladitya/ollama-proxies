/**
 * Media provider registry — Embedding.
 *
 * The dashboard renders one card per entry. Only providers with `locked: false`
 * accept connections; the rest are shown greyed out so the roadmap is visible
 * without pretending the integration exists.
 *
 * Adding a provider means: flip `locked`, give it an `endpoint`, and teach
 * `callEmbedding` how to talk to it. Nothing else in the stack needs to change.
 */

export interface EmbeddingProviderDef {
  id: string;
  name: string;
  /** Capability tags shown on the detail page. */
  tags: string[];
  /** false = fully implemented; true = placeholder card, no connections allowed. */
  locked: boolean;
  /** Upstream URL, for the Config panel and the actual request. */
  endpoint: string;
  /** Where the operator gets a key. */
  apiKeyUrl: string;
  /** Free-tier / pricing note shown in the banner. */
  notice: string;
}

export const EMBEDDING_PROVIDERS: EmbeddingProviderDef[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    tags: ["LLM", "EMBEDDING", "TTS", "IMAGETOTEXT"],
    locked: false,
    endpoint: "https://openrouter.ai/api/v1/embeddings",
    apiKeyUrl: "https://openrouter.ai/keys",
    notice:
      "Free tier: 27+ free models, no credit card needed, 200 req/day. After 0 credit: 1,000 req/day.",
  },
  { id: "nvidia-nim", name: "NVIDIA NIM", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "openai", name: "OpenAI", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "github-copilot", name: "GitHub Copilot", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "voyage-ai", name: "Voyage AI", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "gemini", name: "Gemini", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "fireworks-ai", name: "Fireworks AI", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "self-hosted", name: "Self-hosted Embedding", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "together-ai", name: "Together AI", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "nebius-ai", name: "Nebius AI", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "mistral", name: "Mistral", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "venice-ai", name: "Venice AI", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
  { id: "jina-ai", name: "Jina AI", tags: ["EMBEDDING"], locked: true, endpoint: "", apiKeyUrl: "", notice: "" },
];

export function getEmbeddingProvider(id: string): EmbeddingProviderDef | undefined {
  return EMBEDDING_PROVIDERS.find((p) => p.id === id);
}

/**
 * Catalog seeded on first boot. OpenRouter's /api/v1/models returns zero
 * embedding entries, so there is nothing to sync from — the list is curated
 * here and editable from the dashboard afterwards.
 */
export const OPENROUTER_SEED_MODELS: Array<{
  publicModelId: string;
  upstreamModelId: string;
  label: string;
}> = [
  { publicModelId: "openrouter/openai/text-embedding-3-large", upstreamModelId: "openai/text-embedding-3-large", label: "OpenAI Text Embedding 3 Large" },
  { publicModelId: "openrouter/openai/text-embedding-3-small", upstreamModelId: "openai/text-embedding-3-small", label: "OpenAI Text Embedding 3 Small" },
  { publicModelId: "openrouter/openai/text-embedding-ada-002", upstreamModelId: "openai/text-embedding-ada-002", label: "OpenAI Text Embedding Ada 002" },
  { publicModelId: "openrouter/qwen/qwen3-embedding-8b", upstreamModelId: "qwen/qwen3-embedding-8b", label: "Qwen3 Embedding 8B" },
];
