import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import type { CliRenderer } from "@opentui/core"
import { App } from "../src/app.js"
import { useResponder } from "../src/core/responder/useResponder.js"
import { frame, press, renderTui, settle, type TuiHarness, type, untilSettled } from "./harness.js"
import { ANSWER_FRAMES, scriptedTransport } from "./scripted-transport.js"

/**
 * Wide enough that the working directory fits whole, so the mode and model cells survive the header's
 * truncation. `spinnerVisible` explains why the header is otherwise a cwd-dependent surface.
 */
const WIDE = { width: 240, height: 30 }

let home: string
let previousHome: string | undefined

beforeEach(() => {
  // The mode and model are live preferences now, so a test that flips one writes preferences.json.
  // Point the home at a scratch directory so the operator's own file is never touched.
  previousHome = process.env[NIGHTCODE_HOME_ENV]
  home = mkdtempSync(join(tmpdir(), "nightcode-app-"))
  process.env[NIGHTCODE_HOME_ENV] = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  if (previousHome === undefined) delete process.env[NIGHTCODE_HOME_ENV]
  else process.env[NIGHTCODE_HOME_ENV] = previousHome
})

/** The header is the one surface that shows a mode or a model, and it is the top row. */
function headerRow(setup: TuiHarness): string {
  return frame(setup).split("\n")[0] ?? ""
}

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

/**
 * True while a content-less turn is in flight, read from the spinner's label in the body.
 *
 * These tests do not read the header's status cell for the same reason: the header drops or truncates
 * that cell when the working directory is long, and a worktree path is far longer than the checkout
 * path, so a header assertion is cwd-dependent and hangs in the isolated verification worktrees. The
 * body's label is what the user reads, and it survives a truncated header. The status logic itself is a
 * pure function and is covered directly in `layout.test.tsx`.
 */
function spinnerVisible(setup: TuiHarness): boolean {
  return frame(setup)
    .split("\n")
    .some((row) => row.includes("thinking"))
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
    // See `spinnerLabel` for why this waits on the body rather than the header's status cell.
    await untilSettled(setup, () => !spinnerVisible(setup))
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

  test("tab flips the mode the header shows, and again", async () => {
    const setup = await renderTui(<Shell />, WIDE)
    expect(headerRow(setup)).toContain("plan")
    expect(headerRow(setup)).not.toContain("build")

    await press(setup, ["TAB"])
    let row = headerRow(setup)
    expect(row).toContain("build")
    expect(row).not.toContain("plan")

    await press(setup, ["TAB"])
    row = headerRow(setup)
    expect(row).toContain("plan")
    expect(row).not.toContain("build")
  })

  test("a model chosen from /models is on the header and is the model the next turn sends", async () => {
    const scripted = scriptedTransport([{ type: "finish" }], { parked: false })
    const setup = await renderTui(<App chatTransport={scripted.transport} />, WIDE)
    expect(headerRow(setup)).toContain("claude-sonnet-4-5")

    await type(setup, "/models")
    const palette = frame(setup)
    expect(palette).toContain("commands")
    expect(palette).toContain("/models")
    await press(setup, ["RETURN"])

    const picker = frame(setup)
    expect(picker).toContain("filter models")
    expect(picker).toContain("Claude Haiku 4.5")
    expect(picker).toContain("$1 in / $5 out per MTok")
    expect(picker).toContain("GPT-5 pro")

    await type(setup, "haiku")
    expect(frame(setup)).not.toContain("GPT-5 pro")
    await press(setup, ["RETURN"])
    expect(frame(setup)).not.toContain("filter models")
    expect(headerRow(setup)).toContain("claude-haiku-4-5")

    await type(setup, "what does this repo do")
    await press(setup, ["RETURN"])
    await untilSettled(setup, () => scripted.created.length === 1)

    expect(scripted.created).toEqual([{ title: "what does this repo do", model: "claude-haiku-4-5" }])
  })

  test("/agents flips the mode the header shows", async () => {
    const setup = await renderTui(<Shell />, WIDE)
    expect(headerRow(setup)).toContain("plan")

    await type(setup, "/agents")
    await press(setup, ["RETURN"])
    const row = headerRow(setup)
    expect(row).toContain("build")
    expect(row).not.toContain("plan")
  })

  test("escape leaves the model picker and its filter, and the header is untouched", async () => {
    const setup = await renderTui(<Shell />, WIDE)
    await type(setup, "/models")
    await press(setup, ["RETURN"])
    expect(frame(setup)).toContain("filter models")

    await type(setup, "haiku")
    expect(frame(setup)).toContain("Claude Haiku 4.5")
    expect(frame(setup)).not.toContain("GPT-5 pro")

    await press(setup, ["ESCAPE"])
    expect(frame(setup)).not.toContain("filter models")
    expect(headerRow(setup)).toContain("claude-sonnet-4-5")
    expect(headerRow(setup)).toContain("plan")
  })
})
