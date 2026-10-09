import { describe, expect, test } from "bun:test"
import { renderTui, untilSettled } from "../../test/harness.js"
import type { ChatMessage } from "../core/chat/types.js"
import { dracula } from "../styles/theme.js"
import { SessionView } from "./SessionView.js"

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: "m1", role: "user", content: "", reasoning: "", status: "complete", error: null, ...overrides }
}

const TRANSCRIPT: readonly ChatMessage[] = [
  message({ id: "a", role: "user", content: "first prompt" }),
  message({ id: "b", role: "assistant", content: "first answer" }),
  message({ id: "c", role: "user", content: "second prompt" }),
]

describe("SessionView", () => {
  test("keeps every turn visible in the order it was handed, with no transport in sight", async () => {
    const setup = await renderTui(<SessionView theme={dracula} messages={TRANSCRIPT} />)
    await untilSettled(setup, () => setup.captureCharFrame().includes("first answer"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("> first prompt")
    expect(frame).toContain("first answer")
    expect(frame).toContain("> second prompt")
    expect(frame.indexOf("> first prompt")).toBeLessThan(frame.indexOf("first answer"))
    expect(frame.indexOf("first answer")).toBeLessThan(frame.indexOf("> second prompt"))
    setup.renderer.destroy()
  })

  test("a turn still streaming shows its spinner and says nothing yet", async () => {
    const setup = await renderTui(
      <SessionView
        theme={dracula}
        messages={[message({ id: "a", role: "user", content: "ask me" }), message({ id: "b", role: "assistant", status: "streaming" })]}
      />,
    )
    const frame = setup.captureCharFrame()
    expect(frame).toContain("> ask me")
    expect(frame).toContain("thinking")
    expect(frame).not.toContain("no response yet")
    setup.renderer.destroy()
  })
})
