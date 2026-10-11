import { z } from "zod"
import { toolCallSchema, toolNameSchema } from "../tools/index.js"

/**
 * One event name for the whole stream. The discriminant lives inside the JSON payload, so a named
 * `event:` line never becomes a second taxonomy that has to be kept in sync with `type`.
 */
export const CHAT_STREAM_EVENT = "chat"

/**
 * One turn of the conversation.
 *
 * A discriminated union rather than a role and a content string, because a tool result carries the
 * call it answers and a flat shape would have to encode that pairing in the text, where nothing
 * could check it.
 *
 * The `tool` variant is built from `toolCallSchema`, so a call and the result that answers it cannot
 * disagree about which id or which tool they name. `input` rides along so a resumed round can be
 * replayed without the model being asked to restate it.
 */
export const chatMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({ role: z.literal("assistant"), content: z.string() }),
  z.object({ role: z.literal("system"), content: z.string() }),
  toolCallSchema.extend({
    role: z.literal("tool"),
    output: z.string(),
    ok: z.boolean(),
  }),
])
export type ChatMessage = z.infer<typeof chatMessageSchema>

/**
 * The whole transcript travels with the request, so the server stays stateless about the conversation
 * and needs no read of past messages.
 *
 * `system` is required because the mode it carries is the difference between an agent that edits the
 * repository and one that only reads it. A turn without it would answer in no mode at all, which is the
 * failure this field exists to make impossible rather than merely unlikely.
 *
 * `tools` is required for the same reason and about the same line: a caller that offers no tool is a
 * caller that made a decision, and a missing field is not a decision.
 */
export const chatRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    messages: z.array(chatMessageSchema).min(1),
    system: z.string().min(1),
    tools: z.array(toolNameSchema).readonly(),
  })
  .refine((value) => value.messages.at(-1)?.role === "user" || value.messages.at(-1)?.role === "tool", {
    message: "The last message must come from the user or carry a tool result",
    path: ["messages"],
  })
export type ChatRequest = z.infer<typeof chatRequestSchema>

/**
 * A closed union, so a client decodes it exhaustively in one `switch` and a fifth variant is a compile
 * error rather than a frame the CLI silently drops.
 *
 * A tool call is the one frame no user reads directly, which is exactly why it is here rather than in
 * a side channel: the CLI has to know a call happened to run it, and a frame the schema does not
 * describe ends the run instead of being dropped.
 */
export const chatFrameSchema = z.discriminatedUnion("type", [
  toolCallSchema.extend({ type: z.literal("tool-call") }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("finish") }),
  z.object({ type: z.literal("error"), code: z.string().min(1), message: z.string() }),
])
export type ChatFrame = z.infer<typeof chatFrameSchema>
