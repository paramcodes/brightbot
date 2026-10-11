import { z } from "zod"

/**
 * One tool invocation as the model asked for it.
 *
 * The id is minted by whoever asks, and it is the only thing that pairs a call with the result that
 * answers it, so it belongs to the record rather than to the side that reads it.
 */
export const toolCallSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
})
export type ToolCall = z.infer<typeof toolCallSchema>

/**
 * What the executor got back.
 *
 * `ok` is false for a refusal and for a failure alike, because the caller that renders the line
 * needs to distinguish neither, and the caller that sends the result on has to mark a non-answer as
 * a non-answer whichever kind it was.
 */
export const toolResultSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  ok: z.boolean(),
  output: z.string(),
})
export type ToolResult = z.infer<typeof toolResultSchema>
