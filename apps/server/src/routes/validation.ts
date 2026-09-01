import { z } from "zod";

/**
 * Task 026: Request validation — Zod schemas for chat completion.
 */

const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.null()]),
  tool_calls: z.array(z.unknown()).optional(),
  tool_call_id: z.string().optional(),
});

export const chatCompletionRequestSchema = z.object({
  model: z.string().min(1, "model is required"),
  messages: z
    .array(chatMessageSchema)
    .min(1, "messages must contain at least one message"),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional().default(false),
  tools: z.array(z.unknown()).optional(),
  user: z.string().optional(),
}).passthrough(); // allow vendor extensions

export type ValidatedChatRequest = z.infer<typeof chatCompletionRequestSchema>;
