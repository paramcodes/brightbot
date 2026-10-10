import { z } from "zod"
import { ROLES } from "../ports/store.js"

/**
 * One event name for the whole stream. The discriminant lives inside the JSON payload, so a named
 * `event:` line never becomes a second taxonomy that has to be kept in sync with `type`.
 */
export const CHAT_STREAM_EVENT = "chat"

export const chatRoleSchema = z.enum(ROLES)
export type ChatRole = z.infer<typeof chatRoleSchema>

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string(),
})
export type ChatMessage = z.infer<typeof chatMessageSchema>

/**
 * The whole transcript travels with the request, so the server stays stateless about the conversation
 * and needs no read of past messages.
 *
 * `system` is required because the mode it carries is the difference between an agent that edits the
 * repository and one that only reads it. A turn without it would answer in no mode at all, which is the
 * failure this field exists to make impossible rather than merely unlikely.
 */
export const chatRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    messages: z.array(chatMessageSchema).min(1),
    system: z.string().min(1),
  })
  .refine((value) => value.messages.at(-1)?.role === "user", {
    message: "The last message must come from the user",
    path: ["messages"],
  })
export type ChatRequest = z.infer<typeof chatRequestSchema>

/**
 * A closed union, so a client decodes it exhaustively in one `switch` and a fifth variant is a compile
 * error rather than a frame the CLI silently drops.
 */
export const chatFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("finish") }),
  z.object({ type: z.literal("error"), code: z.string().min(1), message: z.string() }),
])
export type ChatFrame = z.infer<typeof chatFrameSchema>
