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

  test("submitting a prompt on Home lands in Session with the prompt visible", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "hello there")
    await press(setup, ["RETURN"])
    const frame = setup.captureCharFrame()
    expect(frame).toContain("> hello there")
    expect(frame).not.toContain("terminal coding agent")
    expect(frame).toContain("ask nightcode to do something")
  })

  test("a second prompt inside the session is appended as another turn", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "first")
    await press(setup, ["RETURN"])
    await type(setup, "second")
    await press(setup, ["RETURN"])
    const frame = setup.captureCharFrame()
    expect(frame).toContain("> first")
    expect(frame).toContain("> second")
    expect(frame).not.toContain("terminal coding agent")
  })

  test("/clear empties the session and returns Home", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "hello")
    await press(setup, ["RETURN"])
    await type(setup, "/clear")
    await press(setup, ["RETURN"])
    const frame = setup.captureCharFrame()
    expect(frame).toContain("terminal coding agent")
    expect(frame).not.toContain("> hello")
  })

  test("/exit asks the host to exit", async () => {
    const exits: CliRenderer[] = []
    const setup = await renderTui(<App onExit={(renderer) => exits.push(renderer)} />)
    await type(setup, "/exit")
    await press(setup, ["RETURN"])
    expect(exits).toHaveLength(1)
  })

  test("escape reports that there is nothing to interrupt", async () => {
    const setup = await renderTui(<App />)
    await press(setup, ["ESCAPE"])
    expect(setup.captureCharFrame()).toContain("No generation to interrupt")
  })

  test("a slash in an empty composer opens the command menu and lists every command", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "/")
    const frame = setup.captureCharFrame()
    for (const name of ["/clear", "/sessions", "/models", "/agents", "/usage", "/exit"]) {
      expect(frame).toContain(name)
    }
    expect(frame).toContain("switch the active model")
  })

  test("a slash that is not the first character does not open the menu", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "read /package.json")
    expect(setup.captureCharFrame()).not.toContain("filter commands")
  })

  test("the menu filters as the user types into it", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "/")
    await type(setup, "usage")
    const frame = setup.captureCharFrame()
    expect(frame).toContain("/usage")
    expect(frame).not.toContain("/agents")
  })

  test("return runs the highlighted command", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "/")
    await type(setup, "usage")
    await press(setup, ["RETURN"])
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("filter commands")
    expect(frame).toContain("/usage is not wired up yet")
  })

  test("escape closes the menu and only the menu", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "/")
    await press(setup, ["ESCAPE"])
    let frame = setup.captureCharFrame()
    expect(frame).not.toContain("filter commands")
    expect(frame).not.toContain("No generation to interrupt")
    expect(frame).toContain("ask nightcode to do something")

    // The slash was consumed with the palette, so the composer starts empty again.
    await type(setup, "next prompt")
    frame = setup.captureCharFrame()
    expect(frame).toContain("next prompt")
    expect(frame).not.toContain("/next prompt")
  })

  test("a second slash in the now-empty composer opens the menu again", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "/")
    await press(setup, ["ESCAPE"])
    await type(setup, "/")
    const frame = setup.captureCharFrame()
    expect(frame).toContain("filter commands")
    expect(frame).toContain("/exit")
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
