import { describe, expect, test } from "bun:test"
import { MODEL_KINDS, type ModelEvent, type ModelRequest, resolveModelKind, toFrame } from "./ai.js"
import { resolveScriptedOptions, scriptedModel } from "./providers/scripted.js"

const REQUEST: ModelRequest = {
  model: "scripted",
  messages: [{ role: "user", content: "hello" }],
  signal: new AbortController().signal,
}

async function drain(model: ReturnType<typeof scriptedModel>, signal = REQUEST.signal): Promise<ModelEvent[]> {
  const events: ModelEvent[] = []
  for await (const event of model.stream({ ...REQUEST, signal })) events.push(event)
  return events
}

describe("resolveModelKind", () => {
  test("no key selects the scripted provider", () => {
    expect(resolveModelKind({})).toBe("scripted")
    expect(resolveModelKind({ ANTHROPIC_API_KEY: "" })).toBe("scripted")
    expect(resolveModelKind({ OPENAI_API_KEY: "" })).toBe("scripted")
  })

  test("a key selects its provider", () => {
    expect(resolveModelKind({ ANTHROPIC_API_KEY: "key" })).toBe("anthropic")
    expect(resolveModelKind({ OPENAI_API_KEY: "key" })).toBe("openai")
    expect(resolveModelKind({ ANTHROPIC_API_KEY: "key", OPENAI_API_KEY: "key" })).toBe("anthropic")
  })

  test("an explicit provider wins over the key check, so a keyed machine stays hermetic", () => {
    expect(resolveModelKind({ NIGHTCODE_MODEL_PROVIDER: "scripted", ANTHROPIC_API_KEY: "key" })).toBe("scripted")
    expect(resolveModelKind({ NIGHTCODE_MODEL_PROVIDER: "openai", ANTHROPIC_API_KEY: "key" })).toBe("openai")
    expect(resolveModelKind({ NIGHTCODE_MODEL_PROVIDER: "anthropic" })).toBe("anthropic")
  })

  test("an unknown provider falls through to the key check", () => {
    expect(resolveModelKind({ NIGHTCODE_MODEL_PROVIDER: "gemini", OPENAI_API_KEY: "key" })).toBe("openai")
    expect(resolveModelKind({ NIGHTCODE_MODEL_PROVIDER: "gemini" })).toBe("scripted")
  })

  test("every kind selects itself", () => {
    for (const kind of MODEL_KINDS) {
      expect(resolveModelKind({ NIGHTCODE_MODEL_PROVIDER: kind })).toBe(kind)
    }
  })
})

describe("toFrame", () => {
  test("each event maps onto the frame that carries the same text", () => {
    expect(toFrame({ type: "text", text: "answer" })).toEqual({ type: "text", text: "answer" })
    expect(toFrame({ type: "reasoning", text: "thought" })).toEqual({ type: "reasoning", text: "thought" })
  })
})

describe("the scripted provider", () => {
  test("options come from the environment through the pure resolver", () => {
    expect(
      resolveScriptedOptions({
        NIGHTCODE_SCRIPTED_REPLY: "one two",
        NIGHTCODE_SCRIPTED_REASONING: "why",
        NIGHTCODE_SCRIPTED_DELAY_MS: "7",
      }),
    ).toEqual({ reply: "one two", reasoning: "why", delayMs: 7 })
  })

  test("an unset or unparseable delay falls back to the default", () => {
    expect(resolveScriptedOptions({}).delayMs).toBe(3)
    expect(resolveScriptedOptions({ NIGHTCODE_SCRIPTED_DELAY_MS: "soon" }).delayMs).toBe(3)
  })

  test("it streams the reasoning first, then the reply, one word per event", async () => {
    const model = scriptedModel({ reply: "hello world", reasoning: "thinking", delayMs: 0 })

    expect(await drain(model)).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "hello " },
      { type: "text", text: "world" },
    ])
  })

  test("an already-aborted signal stops it before the first event", async () => {
    const controller = new AbortController()
    controller.abort()

    expect(await drain(scriptedModel({ reply: "hello world", delayMs: 5 }), controller.signal)).toEqual([])
  })

  test("an abort mid-reply stops it between words", async () => {
    const controller = new AbortController()
    const model = scriptedModel({ reply: "one two three", delayMs: 40 })
    const events: ModelEvent[] = []

    for await (const event of model.stream({ ...REQUEST, signal: controller.signal })) {
      events.push(event)
      controller.abort()
    }

    expect(events).toEqual([{ type: "text", text: "one " }])
  })
})
