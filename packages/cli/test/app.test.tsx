import { describe, expect, test } from "bun:test"
import type { CliRenderer } from "@opentui/core"
import { App } from "../src/app.js"
import { useResponder } from "../src/core/responder/useResponder.js"
import { frame, press, renderTui, settle, type, untilSettled } from "./harness.js"
import { ANSWER_FRAMES, scriptedTransport } from "./scripted-transport.js"

/** Mounted as an overlay layer by the last test: proves a layer can own a key before the shell. */
function ConsumeEscape() {
  useResponder("test-modal", (input) => input.token === "escape")
  return null
}

/** The shell on its own, with the chat boundary scripted so a submit never reaches for a server. */
function Shell(props: { onExit?: (renderer: CliRenderer) => void }) {
  const scripted = scriptedTransport([{ type: "finish" }], { parked: false })
  return <App {...props} chatTransport={scripted.transport} />
}

describe("app shell", () => {
  test("renders brand, header, composer, and hint row", async () => {
    const screen = (await renderTui(<Shell />)).captureCharFrame()
    expect(screen).toContain("Night Code")
    expect(screen).toContain("terminal coding agent")
    expect(screen).toContain("ask nightcode to do something")
    expect(screen).toContain("esc interrupt")
  })

  test("echoes typed text into the composer", async () => {
    const setup = await renderTui(<Shell />)
    await type(setup, "read package.json")
    expect(setup.captureCharFrame()).toContain("read package.json")
  })

  test("submitting a prompt on Home lands in Session with the prompt visible", async () => {
    const setup = await renderTui(<Shell />)
    await type(setup, "hello there")
    await press(setup, ["RETURN"])
    const screen = frame(setup)
    expect(screen).toContain("> hello there")
    expect(screen).not.toContain("terminal coding agent")
    expect(screen).toContain("ask nightcode to do something")
  })

  test("a second prompt inside the session is appended as another turn", async () => {
    const setup = await renderTui(<Shell />)
    await type(setup, "first")
    await press(setup, ["RETURN"])
    // The wait is on the spinner's label in the body, not the header's status cell: the header drops or
    // truncates that cell when the working directory is long (a worktree path is much longer than the
    // checkout path), so a header wait is cwd-dependent and hangs there. "thinking" is present only while
    // a content-less turn is in flight, so its absence is the first turn having settled, which is what
    // has to be true before the second prompt can be accepted.
    await untilSettled(
      setup,
      () =>
        frame(setup)
          .split("\n")
          .some((row) => row.includes("thinking")) === false,
    )
    await type(setup, "second")
    await press(setup, ["RETURN"])
    const screen = frame(setup)
    expect(screen).toContain("> first")
    expect(screen).toContain("> second")
    expect(screen).not.toContain("terminal coding agent")
  })

  test("/clear empties the session and returns Home", async () => {
    const setup = await renderTui(<Shell />)
    await type(setup, "hello")
    await press(setup, ["RETURN"])
    await type(setup, "/clear")
    await press(setup, ["RETURN"])
    const screen = frame(setup)
    expect(screen).toContain("terminal coding agent")
    expect(screen).not.toContain("> hello")
  })

  test("/exit asks the host to exit", async () => {
    const exits: CliRenderer[] = []
    const setup = await renderTui(<Shell onExit={(renderer) => exits.push(renderer)} />)
    await type(setup, "/exit")
    await press(setup, ["RETURN"])
    expect(exits).toHaveLength(1)
  })

  test("escape reports that there is nothing to interrupt", async () => {
    const setup = await renderTui(<Shell />)
    await press(setup, ["ESCAPE"])
    expect(setup.captureCharFrame()).toContain("No generation to interrupt")
  })

  test("a slash in an empty composer opens the command menu and lists every command", async () => {
    const setup = await renderTui(<Shell />)
    await type(setup, "/")
    const screen = frame(setup)
    for (const name of ["/clear", "/sessions", "/models", "/agents", "/usage", "/exit"]) {
      expect(screen).toContain(name)
    }
    expect(screen).toContain("switch the active model")
  })

  test("a slash that is not the first character does not open the menu", async () => {
    const setup = await renderTui(<Shell />)
    await type(setup, "read /package.json")
    expect(setup.captureCharFrame()).not.toContain("filter commands")
  })

  test("the menu filters as the user types into it", async () => {
    const setup = await renderTui(<Shell />)
    await type(setup, "/")
    await type(setup, "usage")
    const screen = frame(setup)
    expect(screen).toContain("/usage")
    expect(screen).not.toContain("/agents")
  })

  test("return runs the highlighted command", async () => {
    const setup = await renderTui(<Shell />)
    await type(setup, "/")
    await type(setup, "usage")
    await press(setup, ["RETURN"])
    const screen = frame(setup)
    expect(screen).not.toContain("filter commands")
    expect(screen).toContain("/usage is not wired up yet")
  })

  test("with a turn live, escape closes the command menu and leaves the turn running", async () => {
    const scripted = scriptedTransport(ANSWER_FRAMES)
    const setup = await renderTui(<App chatTransport={scripted.transport} />)

    await type(setup, "a question that takes a while")
    await press(setup, ["RETURN"])
    await type(setup, "/")
    expect(frame(setup)).toContain("filter commands")

    await press(setup, ["ESCAPE"])
    const screen = frame(setup)
    expect(screen).not.toContain("filter commands")
    expect(screen).not.toContain("No generation to interrupt")
    // The turn is untouched. `release` has not been called, so the transport has not answered and the
    // spinner is proof the generation is still live rather than a stale frame.
    expect(screen.split("\n").some((row) => row.includes("thinking"))).toBe(true)
    expect(scripted.streamed).toHaveLength(0)

    scripted.release()
    await untilSettled(setup, () => frame(setup).includes("the answer is 42"))
    expect(frame(setup)).not.toContain("Interrupted before the answer finished.")
    setup.renderer.destroy()
  })

  test("escape closes the menu and only the menu", async () => {
    const setup = await renderTui(<Shell />)
    await type(setup, "/")
    await press(setup, ["ESCAPE"])
    let screen = frame(setup)
    expect(screen).not.toContain("filter commands")
    expect(screen).not.toContain("No generation to interrupt")
    expect(screen).toContain("ask nightcode to do something")

    // The slash was consumed with the palette, so the composer starts empty again.
    await type(setup, "next prompt")
    screen = frame(setup)
    expect(screen).toContain("next prompt")
    expect(screen).not.toContain("/next prompt")
  })

  test("a second slash in the now-empty composer opens the menu again", async () => {
    const setup = await renderTui(<Shell />)
    await type(setup, "/")
    await press(setup, ["ESCAPE"])
    await type(setup, "/")
    const screen = frame(setup)
    expect(screen).toContain("filter commands")
    expect(screen).toContain("/exit")
  })

  test("ctrl+c asks the host to exit", async () => {
    const exits: CliRenderer[] = []
    const setup = await renderTui(<Shell onExit={(renderer) => exits.push(renderer)} />)
    await setup.mockInput.pressKey("c", { ctrl: true })
    await settle(setup)
    expect(exits).toHaveLength(1)
  })

  test("an overlay layer consumes escape before the shell sees it", async () => {
    const setup = await renderTui(
      <App chatTransport={scriptedTransport([{ type: "finish" }], { parked: false }).transport}>
        <ConsumeEscape />
      </App>,
    )
    await press(setup, ["ESCAPE"])
    expect(setup.captureCharFrame()).not.toContain("No generation to interrupt")
  })
})
