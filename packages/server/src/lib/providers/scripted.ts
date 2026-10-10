import type { TokenUsage } from "@nightcode/shared"
import type { Model, ModelEvent, ModelRequest } from "../ai.js"

const DEFAULT_DELAY_MS = 3

export interface ScriptedOptions {
  readonly reply?: string
  readonly reasoning?: string
  readonly delayMs?: number
}

export interface ScriptedSettings {
  readonly reply: string
  readonly reasoning: string
  readonly delayMs: number
}

function delayFrom(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DELAY_MS
}

/** Pure, so a test can hand it the environment it wants without touching `process.env`. */
export function resolveScriptedOptions(environment: Record<string, string | undefined>, overrides: ScriptedOptions = {}): ScriptedSettings {
  return {
    reply: overrides.reply ?? environment.NIGHTCODE_SCRIPTED_REPLY ?? "",
    reasoning: overrides.reasoning ?? environment.NIGHTCODE_SCRIPTED_REASONING ?? "",
    delayMs: overrides.delayMs ?? delayFrom(environment.NIGHTCODE_SCRIPTED_DELAY_MS),
  }
}

function chunks(text: string): string[] {
  return text.split(/(?<=\s)/).filter((chunk) => chunk.length > 0)
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, milliseconds)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    signal.addEventListener("abort", done, { once: true })
  })
}

/**
 * The local default has no provider to bill it, so its usage is an estimate.
 *
 * Named for what it is: a test asserting against a fake number is fine and one asserting against a
 * lie is not.
 */
export function estimateUsage(prompt: string, said: string): TokenUsage {
  return { promptTokens: Math.ceil(prompt.length / 4), completionTokens: Math.ceil(said.length / 4) }
}

/**
 * The local default: no SDK import, no secret, no network. The pause is cancelled by the signal rather
 * than left to expire, so an abort lands between words instead of after the reply.
 */
export function scriptedModel(options: ScriptedOptions = {}): Model {
  const settings = resolveScriptedOptions(process.env, options)
  return {
    name: "scripted",
    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, TokenUsage | undefined> {
      const prompt = request.messages.map((message) => message.content).join("")
      for (const type of ["reasoning", "text"] as const) {
        const text = type === "reasoning" ? settings.reasoning : settings.reply
        const words = chunks(text)
        for (const [index, word] of words.entries()) {
          if (index > 0) await pause(settings.delayMs, request.signal)
          if (request.signal.aborted) return undefined
          yield { type, text: word }
        }
      }
      return estimateUsage(prompt, `${settings.reasoning}${settings.reply}`)
    },
  }
}
