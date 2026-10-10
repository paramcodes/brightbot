import { openai } from "@ai-sdk/openai"
import type { TokenUsage } from "@nightcode/shared"
import { streamText } from "ai"
import { type Model, type ModelEvent, type ModelRequest, toModelMessages } from "../ai.js"

const DEFAULT_MODEL = "gpt-5"

export function resolveOpenAIModelName(environment: Record<string, string | undefined>): string {
  return environment.NIGHTCODE_OPENAI_MODEL || DEFAULT_MODEL
}

export function openaiModel(modelName: string = resolveOpenAIModelName(process.env)): Model {
  return {
    name: modelName,
    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, TokenUsage | undefined> {
      const result = streamText({
        model: openai(request.model || modelName),
        system: request.system,
        messages: toModelMessages(request.messages),
        abortSignal: request.signal,
      })
      // Every other part type is dropped. Tool calls arrive as `tool-*` parts and are out of this
      // phase's scope. Usage is no longer one of the dropped ones: it is returned below.
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") yield { type: "text", text: part.text }
        else if (part.type === "reasoning-delta") yield { type: "reasoning", text: part.text }
      }
      const billed = await result.usage
      // The `finish` part is the last one the stream produces, so the usage it carries is what this
      // generator returns. An aborted turn never reaches it, which is why the return is nullable.
      return billed ? { promptTokens: billed.inputTokens ?? 0, completionTokens: billed.outputTokens ?? 0 } : undefined
    },
  }
}
