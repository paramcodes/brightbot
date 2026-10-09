import { anthropic } from "@ai-sdk/anthropic"
import { streamText } from "ai"
import { type Model, type ModelEvent, type ModelRequest, toModelMessages } from "../ai.js"

const DEFAULT_MODEL = "claude-sonnet-4-5"

export function resolveAnthropicModelName(environment: Record<string, string | undefined>): string {
  return environment.NIGHTCODE_ANTHROPIC_MODEL || DEFAULT_MODEL
}

export function anthropicModel(modelName: string = resolveAnthropicModelName(process.env)): Model {
  return {
    name: modelName,
    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent> {
      const result = streamText({
        model: anthropic(request.model || modelName),
        messages: toModelMessages(request.messages),
        abortSignal: request.signal,
      })
      // Every other part type is dropped. The two that matter later are usage, which arrives on the
      // `finish` part, and tool calls, which arrive as `tool-*` parts. Both are out of this phase's scope.
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") yield { type: "text", text: part.text }
        else if (part.type === "reasoning-delta") yield { type: "reasoning", text: part.text }
      }
    },
  }
}
