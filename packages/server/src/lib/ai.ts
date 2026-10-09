import type { ChatFrame, ChatMessage } from "@nightcode/shared"
import type { ModelMessage } from "ai"
import { anthropicModel } from "./providers/anthropic.js"
import { openaiModel } from "./providers/openai.js"
import { scriptedModel } from "./providers/scripted.js"

/**
 * The two things a provider can emit while a turn is live. Nothing else crosses this boundary, so a
 * capability the phase does not have cannot be half-implemented in the fake.
 */
export type ModelEvent = { readonly type: "reasoning"; readonly text: string } | { readonly type: "text"; readonly text: string }

export interface ModelRequest {
  /** The model the session asked for. The session row is the single source of which model answered. */
  readonly model: string
  readonly messages: readonly ChatMessage[]
  /** Aborted by a client disconnect, so the provider stops pulling from its upstream. */
  readonly signal: AbortSignal
}

/**
 * Deliberately not the AI SDK's `LanguageModel`. That interface is wide, and every future capability
 * (Phase 8 tools, Phase 7 usage) would have to be implemented in the fake before it worked.
 */
export interface Model {
  readonly name: string
  stream(request: ModelRequest): AsyncIterable<ModelEvent>
}

export const MODEL_KINDS = ["scripted", "anthropic", "openai"] as const
export type ModelKind = (typeof MODEL_KINDS)[number]

function isModelKind(value: string | undefined): value is ModelKind {
  return value !== undefined && (MODEL_KINDS as readonly string[]).includes(value)
}

/**
 * An explicit `NIGHTCODE_MODEL_PROVIDER` wins over the key check, so a test on a machine that exports
 * `ANTHROPIC_API_KEY` stays hermetic.
 */
export function resolveModelKind(environment: Record<string, string | undefined>): ModelKind {
  const explicit = environment.NIGHTCODE_MODEL_PROVIDER
  if (isModelKind(explicit)) return explicit
  if (environment.ANTHROPIC_API_KEY) return "anthropic"
  if (environment.OPENAI_API_KEY) return "openai"
  return "scripted"
}

export function resolveModel(environment: Record<string, string | undefined>): Model {
  switch (resolveModelKind(environment)) {
    case "anthropic":
      return anthropicModel()
    case "openai":
      return openaiModel()
    case "scripted":
      return scriptedModel()
  }
}

/**
 * Exhaustive on purpose: a variant added to `ModelEvent` without a matching `ChatFrame` fails the
 * typecheck instead of falling through a `default` branch.
 */
export function toFrame(event: ModelEvent): ChatFrame {
  switch (event.type) {
    case "reasoning":
      return { type: "reasoning", text: event.text }
    case "text":
      return { type: "text", text: event.text }
    default: {
      const unhandled: never = event
      throw new Error(`No frame for the model event ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * The SDK's `ModelMessage` is keyed by a literal role, so `ChatMessage`'s union-typed `role` field has
 * to be spread across the three variants by hand. It lives here because both SDK adapters need the
 * same distribution.
 */
export function toModelMessages(messages: readonly ChatMessage[]): ModelMessage[] {
  return messages.map(({ role, content }) => {
    switch (role) {
      case "user":
        return { role: "user", content }
      case "assistant":
        return { role: "assistant", content }
      case "system":
        return { role: "system", content }
      default: {
        const unhandled: never = role
        throw new Error(`No model message for the role ${JSON.stringify(unhandled)}`)
      }
    }
  })
}
