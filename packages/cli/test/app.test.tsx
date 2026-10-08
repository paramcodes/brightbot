import { describe, expect, test } from "bun:test"
import type { CliRenderer } from "@opentui/core"
import { App } from "../src/app.js"
import { useResponder } from "../src/core/responder/useResponder.js"
import { press, renderTui, settle, type } from "./harness.js"

/** Mounted as an overlay layer by the last test: proves a layer can own a key before the shell. */
function ConsumeEscape() {
  useResponder("test-modal", (input) => input.token === "escape")
  return null
}

describe("app shell", () => {
  test("renders brand, header, composer, and hint row", async () => {
    const frame = (await renderTui(<App />)).captureCharFrame()
    expect(frame).toContain("Night Code")
    expect(frame).toContain("terminal coding agent")
    expect(frame).toContain("ask nightcode to do something")
    expect(frame).toContain("esc interrupt")
  })

  test("echoes typed text into the composer", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "read package.json")
    expect(setup.captureCharFrame()).toContain("read package.json")
  })

  test("submits on return, clears the composer, and queues a toast", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "hello there")
    await press(setup, ["RETURN"])
    const frame = setup.captureCharFrame()
    expect(frame).toContain("ask nightcode to do something")
    expect(frame).toContain("Queued: hello there")
  })

  test("escape reports that there is nothing to interrupt", async () => {
    const setup = await renderTui(<App />)
    await press(setup, ["ESCAPE"])
    expect(setup.captureCharFrame()).toContain("No generation to interrupt")
  })

  test("ctrl+c asks the host to exit", async () => {
    const exits: CliRenderer[] = []
    const setup = await renderTui(<App onExit={(renderer) => exits.push(renderer)} />)
    await setup.mockInput.pressKey("c", { ctrl: true })
    await settle(setup)
    expect(exits).toHaveLength(1)
  })

  test("an overlay layer consumes escape before the shell sees it", async () => {
    const setup = await renderTui(
      <App>
        <ConsumeEscape />
      </App>,
    )
    await press(setup, ["ESCAPE"])
    expect(setup.captureCharFrame()).not.toContain("No generation to interrupt")
  })
})
