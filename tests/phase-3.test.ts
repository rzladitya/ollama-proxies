import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  OllamaClient,
  UpstreamError,
  classifyHttpError,
  classifyError,
} from "@ollama-proxy/ollama-client";

const TEST_BASE = "http://localhost:19999";
const TEST_KEY = "test-api-key";

const server = setupServer();

beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

// ── Task 020: Error Classification ──

describe("Phase 3 — Task 020: Error Classification", () => {
  it("400 → CLIENT_VALIDATION_ERROR, not retryable", () => {
    const { category, retryable } = classifyHttpError(400);
    expect(category).toBe("CLIENT_VALIDATION_ERROR");
    expect(retryable).toBe(false);
  });

  it("401 → UPSTREAM_AUTH_ERROR, retryable (try other account)", () => {
    const { category, retryable } = classifyHttpError(401);
    expect(category).toBe("UPSTREAM_AUTH_ERROR");
    expect(retryable).toBe(true);
  });

  it("429 → UPSTREAM_RATE_LIMIT, retryable", () => {
    const { category, retryable } = classifyHttpError(429);
    expect(category).toBe("UPSTREAM_RATE_LIMIT");
    expect(retryable).toBe(true);
  });

  it("500 → UPSTREAM_5XX, retryable", () => {
    const { category, retryable } = classifyHttpError(500);
    expect(category).toBe("UPSTREAM_5XX");
    expect(retryable).toBe(true);
  });

  it("503 → UPSTREAM_5XX, retryable", () => {
    expect(classifyHttpError(503).category).toBe("UPSTREAM_5XX");
  });

  it("404 → MODEL_NOT_AVAILABLE, retryable", () => {
    expect(classifyHttpError(404).category).toBe("MODEL_NOT_AVAILABLE");
  });

  it("classifyError handles UpstreamError", () => {
    const err = new UpstreamError("test", 429, "UPSTREAM_RATE_LIMIT", true);
    const { category, retryable } = classifyError(err);
    expect(category).toBe("UPSTREAM_RATE_LIMIT");
    expect(retryable).toBe(true);
  });

  it("classifyError handles AbortError → UPSTREAM_TIMEOUT", () => {
    const err = new DOMException("aborted", "AbortError");
    expect(classifyError(err).category).toBe("UPSTREAM_TIMEOUT");
  });

  it("classifyError handles TypeError → UPSTREAM_CONNECTION_ERROR", () => {
    expect(classifyError(new TypeError("fetch failed")).category).toBe(
      "UPSTREAM_CONNECTION_ERROR"
    );
  });

  it("classifyError handles unknown → INTERNAL_ERROR", () => {
    expect(classifyError(new Error("unknown")).category).toBe("INTERNAL_ERROR");
  });
});

// ── Task 017: Non-streaming chat completion ──

describe("Phase 3 — Task 017: Non-streaming chat completion", () => {
  it("sends POST and returns parsed response", async () => {
    const mockResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "qwen3:latest",
      choices: [
        { index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    server.use(
      http.post(`${TEST_BASE}/v1/chat/completions`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.stream).toBe(false);
        expect(request.headers.get("Authorization")).toBe(`Bearer ${TEST_KEY}`);
        return HttpResponse.json(mockResponse);
      })
    );

    const client = new OllamaClient({ baseUrl: TEST_BASE });
    const result = await client.chatCompletion(TEST_KEY, {
      model: "qwen3:latest",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.id).toBe("chatcmpl-123");
    expect(result.choices[0].message.content).toBe("Hello");
  });

  it("throws UpstreamError on 429", async () => {
    server.use(
      http.post(`${TEST_BASE}/v1/chat/completions`, () => {
        return new HttpResponse("Rate limited", { status: 429 });
      })
    );

    const client = new OllamaClient({ baseUrl: TEST_BASE });
    await expect(
      client.chatCompletion(TEST_KEY, {
        model: "qwen3:latest",
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toThrow(UpstreamError);
  });

  it("calls onFirstOutput on success", async () => {
    server.use(
      http.post(`${TEST_BASE}/v1/chat/completions`, () => {
        return HttpResponse.json({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
        });
      })
    );

    let called = false;
    const client = new OllamaClient({ baseUrl: TEST_BASE });
    await client.chatCompletion(
      TEST_KEY,
      { model: "m", messages: [{ role: "user", content: "x" }] },
      { onFirstOutput: () => { called = true; } }
    );
    expect(called).toBe(true);
  });
});

// ── Task 018: Streaming ──

describe("Phase 3 — Task 018: SSE Streaming", () => {
  it("yields parsed chunks and calls onFirstOutput once", async () => {
    const sseBody = [
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
    ].join("\n\n");

    server.use(
      http.post(`${TEST_BASE}/v1/chat/completions`, () => {
        return new HttpResponse(sseBody, {
          headers: { "Content-Type": "text/event-stream" },
        });
      })
    );

    const client = new OllamaClient({ baseUrl: TEST_BASE });
    let firstOutputCount = 0;
    const chunks: unknown[] = [];

    for await (const chunk of client.chatCompletionStream(
      TEST_KEY,
      { model: "m", messages: [{ role: "user", content: "x" }] },
      { onFirstOutput: () => { firstOutputCount++; } }
    )) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(3);
    expect(firstOutputCount).toBe(1);
  });

  it("throws UpstreamError on non-200 stream", async () => {
    server.use(
      http.post(`${TEST_BASE}/v1/chat/completions`, () => {
        return new HttpResponse("Server error", { status: 500 });
      })
    );

    const client = new OllamaClient({ baseUrl: TEST_BASE });
    await expect(async () => {
      for await (const _ of client.chatCompletionStream(TEST_KEY, {
        model: "m",
        messages: [{ role: "user", content: "x" }],
      })) {
        // consume
      }
    }).rejects.toThrow(UpstreamError);
  });
});

// ── Task 019: Model list ──

describe("Phase 3 — Task 019: Model list fetch", () => {
  it("returns parsed model list", async () => {
    server.use(
      http.get(`${TEST_BASE}/v1/models`, ({ request }) => {
        expect(request.headers.get("Authorization")).toBe(`Bearer ${TEST_KEY}`);
        return HttpResponse.json({
          object: "list",
          data: [
            { id: "qwen3:latest", object: "model", created: 0, owned_by: "ollama" },
            { id: "llama3:latest", object: "model", created: 0, owned_by: "ollama" },
          ],
        });
      })
    );

    const client = new OllamaClient({ baseUrl: TEST_BASE });
    const models = await client.listModels(TEST_KEY);
    expect(models.length).toBe(2);
    expect(models[0].id).toBe("qwen3:latest");
  });

  it("throws on 401", async () => {
    server.use(
      http.get(`${TEST_BASE}/v1/models`, () => {
        return new HttpResponse("Unauthorized", { status: 401 });
      })
    );

    const client = new OllamaClient({ baseUrl: TEST_BASE });
    await expect(client.listModels(TEST_KEY)).rejects.toThrow(UpstreamError);
  });
});

// ── Task 021: AbortController ──

describe("Phase 3 — Task 021: AbortController", () => {
  it("aborts request with external signal", async () => {
    server.use(
      http.post(`${TEST_BASE}/v1/chat/completions`, async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return HttpResponse.json({});
      })
    );

    const controller = new AbortController();
    const client = new OllamaClient({ baseUrl: TEST_BASE });

    setTimeout(() => controller.abort(), 50);

    await expect(
      client.chatCompletion(
        TEST_KEY,
        { model: "m", messages: [{ role: "user", content: "x" }] },
        { signal: controller.signal }
      )
    ).rejects.toThrow();
  });

  it("times out with timeoutMs", async () => {
    server.use(
      http.post(`${TEST_BASE}/v1/chat/completions`, async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return HttpResponse.json({});
      })
    );

    const client = new OllamaClient({ baseUrl: TEST_BASE });
    await expect(
      client.chatCompletion(
        TEST_KEY,
        { model: "m", messages: [{ role: "user", content: "x" }] },
        { timeoutMs: 100 }
      )
    ).rejects.toThrow();
  });
});
