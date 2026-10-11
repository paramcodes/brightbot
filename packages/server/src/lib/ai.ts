import type { ChatFrame, ChatMessage, TokenUsage, ToolName } from "@nightcode/shared"
import { MODELS, toolDescriptions, toolSchemas } from "@nightcode/shared"
import type { ModelMessage, ToolSet } from "ai"
import { tool } from "ai"
import { anthropicModel } from "./providers/anthropic.js"
import { openaiModel } from "./providers/openai.js"
import { scriptedModel } from "./providers/scripted.js"

/**
 * The two things a provider can emit while a turn is live. Nothing else crosses this boundary, so a
 * capability the phase does not have cannot be half-implemented in the fake.
 */
export type ModelEvent =
  | { readonly type: "reasoning"; readonly text: string }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool-call"; readonly toolCallId: string; readonly toolName: string; readonly input: unknown }

export interface ModelRequest {
  /** The model the session asked for. The session row is the single source of which model answered. */
  readonly model: string
  readonly messages: readonly ChatMessage[]
  /**
   * What the model is told it is, chosen by the client's mode. Required rather than optional so a
   * provider that forgets to pass it through fails the typecheck instead of answering in no mode.
   */
  readonly system: string
  /**
   * What the caller can run. The server offers exactly this set, because a tool the CLI cannot
   * execute is a tool the model will call and nothing will answer.
   */
  readonly tools: readonly ToolName[]
  /** Aborted by a client disconnect, so the provider stops pulling from its upstream. */
  readonly signal: AbortSignal
}

/**
 * Deliberately not the AI SDK's `LanguageModel`. That interface is wide, and every future capability
 * (tools, token usage) would have to be implemented in the fake before it worked.
 */
export interface Model {
  readonly name: string
  /**
   * Streams a turn. The generator's return value is what the provider billed, which is the one thing
   * a consumer learns when the stream ends and the one moment a provider knows it.
   */
  stream(request: ModelRequest): AsyncGenerator<ModelEvent, TokenUsage | undefined>
}

export const MODEL_KINDS = ["scripted", "anthropic", "openai"] as const
export type ModelKind = (typeof MODEL_KINDS)[number]

function isModelKind(value: string | undefined): value is ModelKind {
  return value !== undefined && (MODEL_KINDS as readonly string[]).includes(value)
}

/**
 * Which provider answers a turn.
 *
 * An explicit `NIGHTCODE_MODEL_PROVIDER` wins over everything, so a test on a machine that exports a key
 * stays hermetic. After that the requested model id decides, because the shared catalog already records
 * which provider owns each id and a session picked `gpt-5` should not be answered by Anthropic. The key
 * check is the last resort, for a session row whose model predates the catalog.
 */
export function resolveModelKind(environment: Record<string, string | undefined>, model?: string): ModelKind {
  const explicit = environment.NIGHTCODE_MODEL_PROVIDER
  if (isModelKind(explicit)) return explicit
  const owner = MODELS.find((option) => option.id === model)?.provider
  if (isModelKind(owner)) return owner
  if (environment.ANTHROPIC_API_KEY) return "anthropic"
  if (environment.OPENAI_API_KEY) return "openai"
  return "scripted"
}

export function resolveModel(environment: Record<string, string | undefined>, model?: string): Model {
  switch (resolveModelKind(environment, model)) {
    case "anthropic":
      return anthropicModel(model)
    case "openai":
      return openaiModel(model)
    case "scripted":
      return scriptedModel()
  }
}

/**
 * The shared contracts as the tools the SDK will offer the model.
 *
 * Each definition is written out rather than built from a lookup, because a schema reached by a
 * variable of type `ToolName` is a union of seven shapes and the SDK cannot infer its input through
 * one. Writing them out keeps every definition's input type precise, which is what lets a provider
 * validate what the model sent.
 *
 * A definition carries no `execute`, and that is the whole point of the phase: the executor is on the
 * developer's machine and the server has none. The SDK therefore surfaces the call and stops, which
 * is exactly the one step the client loop needs.
 */
const TOOL_DEFINITIONS: ToolSet = {
  read_file: tool({ description: toolDescriptions.read_file, inputSchema: toolSchemas.read_file }),
  write_file: tool({ description: toolDescriptions.write_file, inputSchema: toolSchemas.write_file }),
  edit_file: tool({ description: toolDescriptions.edit_file, inputSchema: toolSchemas.edit_file }),
  list_directory: tool({ description: toolDescriptions.list_directory, inputSchema: toolSchemas.list_directory }),
  glob: tool({ description: toolDescriptions.glob, inputSchema: toolSchemas.glob }),
  grep: tool({ description: toolDescriptions.grep, inputSchema: toolSchemas.grep }),
  bash: tool({ description: toolDescriptions.bash, inputSchema: toolSchemas.bash }),
}

export function toolSet(names: readonly ToolName[]): ToolSet {
  const offered: ToolSet = {}
  for (const name of names) {
    const definition = TOOL_DEFINITIONS[name]
    if (definition) offered[name] = definition
  }
  return offered
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
    case "tool-call":
      return { type: "tool-call", toolCallId: event.toolCallId, toolName: event.toolName, input: event.input }
    default: {
      const unhandled: never = event
      throw new Error(`No frame for the model event ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * The SDK's `ModelMessage` is keyed by a literal role, so `ChatMessage`'s union-typed `role` field has
 * to be spread across the variants by hand. It lives here because both SDK adapters need the same
 * distribution.
 *
 * A tool row becomes one `ToolModelMessage` carrying the result part that answers it, with the
 * command's own output as `text` and a refusal or a failure as `error-text`. The SDK has a channel for
 * a call that did not work, and using it means the model is told it was refused rather than handed a
 * sentence it might read as the answer.
 */
export function toModelMessages(messages: readonly ChatMessage[]): ModelMessage[] {
  return messages.map((message) => {
    switch (message.role) {
      case "user":
        return { role: "user", content: message.content }
      case "assistant":
        return { role: "assistant", content: message.content }
      case "system":
        return { role: "system", content: message.content }
      case "tool":
        return {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: message.toolCallId,
              toolName: message.toolName,
              output: message.ok ? { type: "text", value: message.output } : { type: "error-text", value: message.output },
            },
          ],
        }
      default: {
        const unhandled: never = message
        throw new Error(`No model message for the role ${JSON.stringify(unhandled)}`)
      }
    }
  })
}
