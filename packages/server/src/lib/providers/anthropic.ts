import { anthropic } from "@ai-sdk/anthropic"
import type { TokenUsage } from "@nightcode/shared"
import { streamText } from "ai"
import { type Model, type ModelEvent, type ModelRequest, toModelMessages } from "../ai.js"

const DEFAULT_MODEL = "claude-sonnet-4-5"

export function resolveAnthropicModelName(environment: Record<string, string | undefined>): string {
  return environment.NIGHTCODE_ANTHROPIC_MODEL || DEFAULT_MODEL
}

export function anthropicModel(modelName: string = resolveAnthropicModelName(process.env)): Model {
  return {
    name: modelName,
    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, TokenUsage | undefined> {
      const result = streamText({
        model: anthropic(request.model || modelName),
        system: request.system,
        messages: toModelMessages(request.messages),
        abortSignal: request.signal,
      })
      // Tool calls arrive as `tool-*` parts and are out of this phase's scope.
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") yield { type: "text", text: part.text }
        else if (part.type === "reasoning-delta") yield { type: "reasoning", text: part.text }
      }
      const billed = await result.usage
      // The usage arrives with the `finish` part, and an aborted turn never reaches it, which is
      // why the return is nullable.
      return billed ? { promptTokens: billed.inputTokens ?? 0, completionTokens: billed.outputTokens ?? 0 } : undefined
    },
  }
}
