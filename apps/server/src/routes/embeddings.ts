import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { embeddingModels } from "@ollama-proxy/storage";
import { z } from "zod";
import { sendOpenAIError } from "./errors.js";
import { generateRequestId } from "./request-id.js";
import { RequestTrace } from "../telemetry.js";
import {
  resolveEmbeddingModel,
  routeEmbedding,
  NoEmbeddingConnectionError,
} from "../providers/embedding/router.js";
import { EmbeddingUpstreamError } from "../providers/embedding/client.js";
import { incrementConcurrency, decrementConcurrency } from "../middleware/proxy-key-auth.js";

const embeddingRequestSchema = z
  .object({
    model: z.string().min(1, "model is required"),
    input: z.union([
      z.string().min(1, "input must not be empty"),
      z.array(z.string()).min(1, "input must contain at least one string"),
    ]),
    dimensions: z.number().int().positive().optional(),
    encoding_format: z.string().optional(),
    user: z.string().optional(),
  })
  .passthrough();

/**
 * OpenAI-compatible embeddings surface.
 *
 * Guarded by the same `sk-proxy-…` keys as /v1/chat/completions, so a client
 * configured against this gateway gets chat and embeddings from one base URL
 * and one credential.
 */
export async function embeddingRoutes(app: FastifyInstance): Promise<void> {
  // Catalog of embedding models this gateway can serve.
  app.get("/v1/embeddings/models", async (_request, reply) => {
    const rows = await app.db
      .select()
      .from(embeddingModels)
      .where(eq(embeddingModels.enabled, true))
      .orderBy(asc(embeddingModels.publicModelId));

    return reply.send({
      object: "list" as const,
      data: rows.map((m) => ({
        id: m.publicModelId,
        object: "model",
        created: 0,
        owned_by: m.providerId,
      })),
    });
  });

  app.post("/v1/embeddings", async (request, reply) => {
    const provided = request.headers["x-request-id"];
    const requestId =
      typeof provided === "string" && provided ? provided : generateRequestId();
    reply.header("X-Request-ID", requestId);

    const proxyKey = request.proxyKey!;

    const parsed = embeddingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return sendOpenAIError(reply, 400, msg, "invalid_request_error", "invalid_request");
    }

    const body = parsed.data;
    const publicModelId = body.model;

    if (proxyKey.allowedModels && !proxyKey.allowedModels.has(publicModelId)) {
      return sendOpenAIError(
        reply,
        404,
        `Model '${publicModelId}' is not available for this API key`,
        "invalid_request_error",
        "model_not_found",
      );
    }

    const resolved = await resolveEmbeddingModel(app, publicModelId);
    if (!resolved) {
      return sendOpenAIError(
        reply,
        404,
        `Model '${publicModelId}' not found or disabled`,
        "invalid_request_error",
        "model_not_found",
      );
    }

    const trace = new RequestTrace(requestId);
    trace.proxyApiKeyId = proxyKey.id;
    trace.publicModelId = publicModelId;
    trace.stream = false;

    const timeStr = new Date().toTimeString().split(" ")[0];
    console.log(
      `[server] [\x1b[90m${timeStr}\x1b[0m] \x1b[35m▶\x1b[0m \x1b[1mPOST\x1b[0m \x1b[33m${publicModelId}\x1b[0m → \x1b[33m${resolved.upstreamModelId}\x1b[0m · FMT: openai→${resolved.providerId} · \x1b[36mEMBED\x1b[0m · KEY:\x1b[32m${proxyKey.name}\x1b[0m`,
    );

    incrementConcurrency(proxyKey.id);
    try {
      const result = await routeEmbedding(
        app,
        resolved.providerId,
        {
          model: resolved.upstreamModelId,
          input: body.input,
          ...(body.dimensions ? { dimensions: body.dimensions } : {}),
          ...(body.encoding_format ? { encoding_format: body.encoding_format } : {}),
        },
        { timeoutMs: app.config.requestTimeoutSeconds * 1000 },
      );

      // Echo the public id back so clients never see the upstream naming.
      result.response.model = publicModelId;

      trace.statusCode = 200;
      // Which connection actually served it — otherwise the Console Log has no
      // attribution for embedding traffic at all.
      trace.finalAccountId = result.connectionId;
      trace.initialAccountId = result.connectionId;
      trace.attemptCount = result.attempts;
      trace.failoverCount = result.attempts - 1;
      if (result.response.usage) {
        trace.inputTokens = result.response.usage.prompt_tokens;
        trace.outputTokens = 0; // embeddings produce no completion tokens
      }
      await trace.persist(app.db);

      return reply.send(result.response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof NoEmbeddingConnectionError) {
        trace.statusCode = 503;
        trace.errorCategory = "NO_ELIGIBLE_ACCOUNT";
        trace.errorCode = message;
        await trace.persist(app.db);
        return sendOpenAIError(
          reply,
          503,
          message,
          "server_error",
          "no_eligible_connection",
        );
      }

      const status = err instanceof EmbeddingUpstreamError ? err.statusCode : 502;
      // A 400 from upstream is the client's request being wrong, not our failure.
      const outStatus = status === 400 ? 400 : 502;
      trace.statusCode = outStatus;
      trace.errorCategory = outStatus === 400 ? "CLIENT_VALIDATION_ERROR" : "UPSTREAM_5XX";
      trace.errorCode = message.slice(0, 200);
      await trace.persist(app.db);

      request.log.error({ err, requestId }, "Embedding request failed");
      return sendOpenAIError(
        reply,
        outStatus,
        `Embedding request failed: ${message.slice(0, 200)}`,
        outStatus === 400 ? "invalid_request_error" : "server_error",
        outStatus === 400 ? "invalid_request" : "upstream_error",
      );
    } finally {
      decrementConcurrency(proxyKey.id);
    }
  });
}
