import { openai } from "@ai-sdk/openai"
import { streamText } from "ai"
import { type Model, type ModelEvent, type ModelRequest, toModelMessages } from "../ai.js"

const DEFAULT_MODEL = "gpt-5"

export function resolveOpenAIModelName(environment: Record<string, string | undefined>): string {
  return environment.NIGHTCODE_OPENAI_MODEL || DEFAULT_MODEL
}

export function openaiModel(modelName: string = resolveOpenAIModelName(process.env)): Model {
  return {
    name: modelName,
    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent> {
      const result = streamText({
        model: openai(request.model || modelName),
        messages: toModelMessages(request.messages),
        abortSignal: request.signal,
      })
      // Phase 7 meters `totalUsage` off the `finish` part and Phase 8 renders the `tool-*` parts. Both
      // are dropped here until the phase that owns them lands.
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") yield { type: "text", text: part.text }
        else if (part.type === "reasoning-delta") yield { type: "reasoning", text: part.text }
      }
    },
  }
}
