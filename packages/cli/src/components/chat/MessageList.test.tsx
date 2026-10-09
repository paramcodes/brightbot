import { describe, expect, test } from "bun:test"
import { renderTui, untilSettled } from "../../../test/harness.js"
import type { ChatMessage } from "../../core/chat/types.js"
import { dracula } from "../../styles/theme.js"
import { MessageList } from "./MessageList.js"

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: "m1", role: "assistant", content: "", reasoning: "", status: "complete", error: null, ...overrides }
}

const TRANSCRIPT: readonly ChatMessage[] = [
  message({ id: "a", role: "user", content: "hello there" }),
  message({ id: "b", role: "assistant", content: "the answer is 42" }),
  message({ id: "c", role: "user", content: "> not a quote, a shell redirect" }),
]

describe("MessageList", () => {
  test("renders a user prompt with its label and prefix", async () => {
    const setup = await renderTui(<MessageList theme={dracula} messages={[TRANSCRIPT[0] as ChatMessage]} />)
    const frame = setup.captureCharFrame()
    expect(frame).toContain("you")
    expect(frame).toContain("> hello there")
    setup.renderer.destroy()
  })

  test("keeps a leading angle bracket in a prompt as plain text", async () => {
    const setup = await renderTui(<MessageList theme={dracula} messages={[message({ id: "c", role: "user", content: "> echo hi" })]} />)
    expect(setup.captureCharFrame()).toContain("> > echo hi")
    setup.renderer.destroy()
  })

  test("renders an assistant turn under the nightcode label", async () => {
    const setup = await renderTui(<MessageList theme={dracula} messages={[TRANSCRIPT[1] as ChatMessage]} />)
    await untilSettled(setup, () => setup.captureCharFrame().includes("the answer is 42"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("nightcode")
    expect(frame).toContain("the answer is 42")
    setup.renderer.destroy()
  })

  test("keeps the roles in the order it was handed", async () => {
    const setup = await renderTui(<MessageList theme={dracula} messages={TRANSCRIPT} />)
    await untilSettled(setup, () => setup.captureCharFrame().includes("the answer is 42"))
    const frame = setup.captureCharFrame()
    expect(frame.indexOf("you")).toBeLessThan(frame.indexOf("nightcode"))
    expect(frame.indexOf("nightcode")).toBeLessThan(frame.lastIndexOf("you"))
    setup.renderer.destroy()
  })

  test("renders nothing at all for an empty transcript", async () => {
    const setup = await renderTui(<MessageList theme={dracula} messages={[]} />)
    expect(setup.captureCharFrame().trim()).toBe("")
    setup.renderer.destroy()
  })
})
