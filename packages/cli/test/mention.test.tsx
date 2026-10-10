import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import type { InputRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useRef } from "react"
import { App } from "../src/app.js"
import { frame, press, renderTui, type TuiHarness, type, untilSettled } from "./harness.js"
import { scriptedTransport } from "./scripted-transport.js"

/**
 * The picker is driven against the real working directory, which is the repository this test runs in.
 * `@packages/` therefore means the same thing to the test and to a user typing it here.
 */

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env[NIGHTCODE_HOME_ENV]
  home = mkdtempSync(join(tmpdir(), "nightcode-mention-"))
  process.env[NIGHTCODE_HOME_ENV] = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  if (previousHome === undefined) delete process.env[NIGHTCODE_HOME_ENV]
  else process.env[NIGHTCODE_HOME_ENV] = previousHome
})

/**
 * Reads the focused composer renderable, so a caret position is an assertion rather than an
 * inference. The picker keeps the composer focused, which is the whole reason this is readable.
 */
function ComposerProbe({ onInput }: { onInput: (input: InputRenderable) => void }) {
  const renderer = useRenderer()
  const latest = useRef(onInput)
  latest.current = onInput
  useEffect(() => {
    const focused = renderer.currentFocusedRenderable
    if (focused) latest.current(focused as InputRenderable)
  })
  return null
}

function Shell({ onInput }: { onInput: (input: InputRenderable) => void }) {
  const scripted = scriptedTransport([{ type: "finish" }], { parked: false })
  return (
    <App chatTransport={scripted.transport}>
      <ComposerProbe onInput={onInput} />
    </App>
  )
}

/** The header is the one surface that shows a mode, and it is the top row. */
function headerRow(setup: TuiHarness): string {
  return frame(setup).split("\n")[0] ?? ""
}

/** Wide enough that `Header`'s cells survive a long working-directory path. See the mode test. */
const WIDE = { width: 240, height: 30 }

/**
 * `@` is a text entry key, so it is sent through the kitty path exactly as a terminal sends it.
 */
async function mention(setup: TuiHarness): Promise<void> {
  await press(setup, ["@"])
}

async function shellWith(onInput: (input: InputRenderable) => void): Promise<TuiHarness> {
  return renderTui(<Shell onInput={onInput} />)
}

/**
 * The path the picker has highlighted, read off the row the user sees.
 *
 * The row is read from the screen rather than from the component's state, because this is the
 * assertion a user could make by looking. The composer's own row is excluded by its `@`, and the
 * first row is short enough that the panel never truncates it.
 */
function selectedPath(setup: TuiHarness): string {
  const row = frame(setup)
    .split("\n")
    .find((line) => line.includes("│ > ") && line.includes("packages/") && !line.includes("@packages/"))
  if (row === undefined) throw new Error("the picker has no highlighted row")
  return row
    .replace(/^.*?│ > /, "")
    .replace(/\s*│.*$/, "")
    .trim()
}

describe("mention picker", () => {
  test("@packages/ lists the paths under it, ranked, and nothing else", async () => {
    const setup = await renderTui(<Shell onInput={() => {}} />)
    await mention(setup)
    await type(setup, "packages/")
    const screen = frame(setup)
    expect(screen).toContain("packages/cli/package.json")
    expect(screen).toContain("packages/cli/src/app.tsx")
    expect(screen).not.toContain("packages/shared")
    expect(screen).not.toContain("no match")
    setup.renderer.destroy()
  })

  test("the list filters as more of the query is typed, so the composer never lost focus", async () => {
    let input: InputRenderable | undefined
    const setup = await shellWith((found) => {
      input = found
    })
    await mention(setup)
    await type(setup, "pack")
    expect(frame(setup)).toContain("packages/cli/package.json")
    expect(input?.value).toBe("@pack")

    await type(setup, "ages/cli/sr")
    expect(input?.value).toBe("@packages/cli/sr")
    const screen = frame(setup)
    expect(screen).toContain("packages/cli/src/app.tsx")
    expect(screen).not.toContain("packages/cli/package.json")
    expect(screen).not.toContain("packages/shared")
    setup.renderer.destroy()
  })

  test("down then return puts the path in the composer with the caret at its end", async () => {
    let input: InputRenderable | undefined
    const setup = await shellWith((found) => {
      input = found
    })
    await mention(setup)
    await type(setup, "packages/")
    await press(setup, ["DOWN"])
    await press(setup, ["RETURN"])

    expect(input?.value).toBe("packages/cli/src/app.tsx ")
    // The `value` setter moves the caret to the end of the new text on its own, so an exact caret is
    // the one assertion that distinguishes a restored caret from a lucky one.
    expect(input?.cursorOffset).toBe(25)
    const screen = frame(setup)
    expect(screen).toContain("packages/cli/src/app.tsx")
    expect(screen).not.toContain("packages/cli/package.json")

    // What the user sees next: the caret was at the end, so the next character lands after the path.
    await type(setup, "and more")
    expect(input?.value).toBe("packages/cli/src/app.tsx and more")
    setup.renderer.destroy()
  })

  test("return with no row highlighted takes the first row", async () => {
    let input: InputRenderable | undefined
    const setup = await shellWith((found) => {
      input = found
    })
    await mention(setup)
    await type(setup, "packages/")
    await press(setup, ["RETURN"])
    expect(input?.value).toBe("packages/cli/package.json ")
    expect(input?.cursorOffset).toBe(26)
    setup.renderer.destroy()
  })

  test("up at the top of the list stays at the top", async () => {
    let input: InputRenderable | undefined
    const setup = await shellWith((found) => {
      input = found
    })
    await mention(setup)
    await type(setup, "packages/")
    expect(selectedPath(setup)).toBe("packages/cli/package.json")

    await press(setup, ["UP"])
    // UP at the top is a no-op, and if it moved the selection off the list then the `return` below
    // would fall through to the composer's own submit binding and no path would ever be inserted.
    expect(selectedPath(setup)).toBe("packages/cli/package.json")
    await press(setup, ["RETURN"])
    expect(input?.value).toBe("packages/cli/package.json ")
    setup.renderer.destroy()
  })

  test("an accepted mention inside a longer prompt leaves the caret after it, not at the end", async () => {
    let input: InputRenderable | undefined
    const setup = await shellWith((found) => {
      input = found
    })
    await mention(setup)
    await type(setup, "src/ and read the rest")
    // Back into the mention, so the text after it is a tail the insertion has to keep and push past.
    await press(setup, ["HOME"])
    await press(setup, ["RIGHT"])
    await press(setup, ["RIGHT"])
    await press(setup, ["RIGHT"])
    await press(setup, ["RIGHT"])
    await press(setup, ["RIGHT"])
    expect(input?.value).toBe("@src/ and read the rest")
    expect(input?.cursorOffset).toBe(5)

    await press(setup, ["RETURN"])
    expect(input?.value).toBe("packages/cli/src/app.tsx  and read the rest")
    // 43 is the end of the whole string. 25 is after the inserted path and its space, which is what
    // `replaceMention` asked for. Only the explicit restore lands on it.
    expect(input?.cursorOffset).toBe(25)
    setup.renderer.destroy()
  })

  test("tab accepts the highlighted row and does not also flip the mode", async () => {
    let input: InputRenderable | undefined
    // Wide, because `Header` truncates its cells from a shrinking budget when the working directory is
    // long and a verification worktree path is far longer than the checkout path. At the default
    // viewport the mode cell there becomes `plan…`, so the assertion below would pass here and hang in
    // an isolated worktree. Every header assertion in `app.test.tsx` renders wide for the same reason.
    const setup = await renderTui(<Shell onInput={(found) => (input = found)} />, WIDE)
    await mention(setup)
    await type(setup, "packages/")
    await press(setup, ["DOWN"])
    await press(setup, ["TAB"])
    expect(input?.value).toBe("packages/cli/src/app.tsx ")
    expect(input?.cursorOffset).toBe(25)
    // `tab` is a shell key, and the global listener runs before the composer's own handler, so a picker
    // that accepted the key without suppressing it would also switch the mode here.
    expect(headerRow(setup)).toContain("plan")
    expect(headerRow(setup)).not.toContain("build")
    setup.renderer.destroy()
  })

  test("escape closes the picker and leaves the composer untouched", async () => {
    let input: InputRenderable | undefined
    const setup = await shellWith((found) => {
      input = found
    })
    await mention(setup)
    await type(setup, "packages/")
    expect(frame(setup)).toContain("packages/cli/package.json")

    await press(setup, ["ESCAPE"])
    const screen = frame(setup)
    expect(screen).not.toContain("packages/cli/package.json")
    expect(screen).not.toContain("no match")
    // The escape that closes the picker must not also reach the shell's own escape handler.
    expect(screen).not.toContain("No generation to interrupt")
    expect(input?.value).toBe("@packages/")
    setup.renderer.destroy()
  })

  test("typing again after an escape opens the picker again", async () => {
    let input: InputRenderable | undefined
    const setup = await shellWith((found) => {
      input = found
    })
    await mention(setup)
    await type(setup, "packages/")
    await press(setup, ["ESCAPE"])
    await type(setup, "cli")
    expect(frame(setup)).toContain("packages/cli/package.json")
    expect(input?.value).toBe("@packages/cli")
    setup.renderer.destroy()
  })

  test("an email address opens no picker", async () => {
    let input: InputRenderable | undefined
    const setup = await shellWith((found) => {
      input = found
    })
    await type(setup, "mail me at user@example.com")
    const screen = frame(setup)
    expect(screen).toContain("user@example.com")
    expect(screen).not.toContain("no match")
    expect(screen).not.toContain("packages/cli")
    expect(input?.value).toBe("mail me at user@example.com")
    setup.renderer.destroy()
  })

  test("node_modules and dist are never mentionable, so a query for them finds nothing", async () => {
    const setup = await renderTui(<Shell onInput={() => {}} />)
    await mention(setup)
    await type(setup, "node_modules")
    expect(frame(setup)).toContain("no match")
    setup.renderer.destroy()
  })

  test("return on an empty picker submits the prompt rather than swallowing the key", async () => {
    const setup = await renderTui(<Shell onInput={() => {}} />)
    await mention(setup)
    await type(setup, "no-such-file-anywhere")
    await press(setup, ["RETURN"])
    await untilSettled(setup, () => frame(setup).includes("no-such-file-anywhere"))
    expect(frame(setup)).toContain("> @no-such-file-anywhere")
    setup.renderer.destroy()
  })

  test("a prompt with no @ still submits, exactly as before", async () => {
    const scripted = scriptedTransport([{ type: "finish" }], { parked: false })
    const setup = await renderTui(<App chatTransport={scripted.transport} />)
    await type(setup, "read package.json")
    await press(setup, ["RETURN"])
    await untilSettled(setup, () => scripted.created.length === 1)
    expect(scripted.created).toEqual([{ title: "read package.json", model: "claude-sonnet-4-5" }])
    expect(frame(setup)).toContain("> read package.json")
    setup.renderer.destroy()
  })
})
