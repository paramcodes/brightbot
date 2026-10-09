import { describe, expect, test } from "bun:test"
import { renderTui, settle, untilSettled } from "../../../test/harness.js"
import type { ChatMessage } from "../../core/chat/types.js"
import { dracula } from "../../styles/theme.js"
import { BotMessage } from "./BotMessage.js"

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: "m1", role: "assistant", content: "", reasoning: "", status: "complete", error: null, ...overrides }
}

describe("BotMessage", () => {
  test("a streaming body renders the text it has so far", async () => {
    const setup = await renderTui(
      <BotMessage theme={dracula} message={message({ content: "reading **package.json** now", status: "streaming" })} />,
    )
    const frame = setup.captureCharFrame()
    expect(frame).toContain("nightcode")
    expect(frame).toContain("reading")
    expect(frame).toContain("package.json")
    setup.renderer.destroy()
  })

  test("a streaming turn with nothing to show yet renders the spinner label", async () => {
    const setup = await renderTui(<BotMessage theme={dracula} message={message({ status: "streaming" })} />)
    expect(setup.captureCharFrame()).toContain("thinking")
    setup.renderer.destroy()
  })

  test("a finished turn renders no spinner", async () => {
    const setup = await renderTui(<BotMessage theme={dracula} message={message({ content: "done" })} />)
    await untilSettled(setup, () => setup.captureCharFrame().includes("done"))
    expect(setup.captureCharFrame()).not.toContain("thinking")
    setup.renderer.destroy()
  })

  test("an interrupted turn says so and shows no spinner", async () => {
    const setup = await renderTui(<BotMessage theme={dracula} message={message({ content: "half an ans", status: "interrupted" })} />)
    await untilSettled(setup, () => setup.captureCharFrame().includes("half an ans"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Interrupted before the answer finished.")
    expect(frame).not.toContain("thinking")
    setup.renderer.destroy()
  })

  test("a failed turn shows the error the caller recorded", async () => {
    const setup = await renderTui(
      <BotMessage theme={dracula} message={message({ status: "failed", error: "provider rejected the key" })} />,
    )
    expect(setup.captureCharFrame()).toContain("provider rejected the key")
    setup.renderer.destroy()
  })

  test("a complete turn renders no status line", async () => {
    const setup = await renderTui(<BotMessage theme={dracula} message={message({ content: "all finished" })} />)
    await untilSettled(setup, () => setup.captureCharFrame().includes("all finished"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("all finished")
    expect(frame).not.toContain("Interrupted")
    expect(frame).not.toContain("failed")
    setup.renderer.destroy()
  })

  test("reasoning shows its own label and the full trace while the turn is live", async () => {
    const setup = await renderTui(
      <BotMessage theme={dracula} message={message({ reasoning: "weighing two options", status: "streaming", content: "here goes" })} />,
    )
    const frame = setup.captureCharFrame()
    expect(frame).toContain("thinking")
    expect(frame).toContain("weighing two options")
    setup.renderer.destroy()
  })

  test("reasoning collapses to a count once the turn is over", async () => {
    const setup = await renderTui(
      <BotMessage theme={dracula} message={message({ reasoning: "weighing two options", content: "here goes" })} />,
    )
    await untilSettled(setup, () => setup.captureCharFrame().includes("here goes"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("thinking · 3 words")
    expect(frame).not.toContain("weighing two options")
    setup.renderer.destroy()
  })

  test("a failed turn with no recorded error still says the turn failed", async () => {
    const setup = await renderTui(<BotMessage theme={dracula} message={message({ status: "failed", error: null })} />)
    expect(setup.captureCharFrame()).toContain("The turn failed.")
    setup.renderer.destroy()
  })

  test("settles without help when nothing is streaming", async () => {
    const setup = await renderTui(<BotMessage theme={dracula} message={message({})} />)
    await settle(setup)
    expect(setup.captureCharFrame()).toContain("nightcode")
    setup.renderer.destroy()
  })
})
