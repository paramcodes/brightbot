import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV, PREFERENCES_PATH } from "@nightcode/shared"
import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import { renderTui, type } from "../../test/harness.js"
import { THEMES } from "../styles/themes/index.js"
import { ThemeProvider, useTheme } from "./ThemeContext.js"

let home: string
let previousHome: string | undefined

function rgb(hex: string): number[] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)]
}

function seed(raw: string): void {
  mkdirSync(home, { recursive: true })
  writeFileSync(PREFERENCES_PATH(), raw, "utf8")
}

function fgOf(setup: Awaited<ReturnType<typeof renderTui>>, text: string): number[] {
  const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
  const match = spans.find((span) => span.text.includes(text))
  return Array.from(match?.fg.buffer ?? [])
}

function Swatch() {
  const { theme, themeName, setTheme } = useTheme()
  const [pressed, setPressed] = useState(0)
  useKeyboard((event) => {
    if (event.name !== "t") return
    setPressed((count) => count + 1)
    setTheme(themeName === "dracula" ? "catppuccin" : "dracula")
  })
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>swatch</text>
      <text>theme:{themeName}</text>
      <text>pressed:{pressed}</text>
    </box>
  )
}

function mount(preferences?: string) {
  if (preferences !== undefined) seed(preferences)
  return renderTui(
    <ThemeProvider>
      <Swatch />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  previousHome = process.env[NIGHTCODE_HOME_ENV]
  home = mkdtempSync(join(tmpdir(), "nightcode-theme-"))
  process.env[NIGHTCODE_HOME_ENV] = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  if (previousHome === undefined) delete process.env[NIGHTCODE_HOME_ENV]
  else process.env[NIGHTCODE_HOME_ENV] = previousHome
})

describe("ThemeProvider", () => {
  test("a missing preferences file paints the default theme", async () => {
    const setup = await mount()
    expect(setup.captureCharFrame()).toContain("theme:dracula")
    expect(fgOf(setup, "swatch").slice(0, 3)).toEqual(rgb(THEMES.dracula.accent))
  })

  test("the persisted theme is painted on mount, with no interaction", async () => {
    const setup = await mount(JSON.stringify({ theme: "catppuccin" }))
    expect(setup.captureCharFrame()).toContain("theme:catppuccin")
    expect(fgOf(setup, "swatch").slice(0, 3)).toEqual(rgb(THEMES.catppuccin.accent))
  })

  test("switching theme repaints the frame and writes the choice back", async () => {
    const setup = await mount()
    expect(fgOf(setup, "swatch").slice(0, 3)).toEqual(rgb(THEMES.dracula.accent))
    await type(setup, "t")
    const frame = setup.captureCharFrame()
    expect(frame).toContain("theme:catppuccin")
    expect(frame).toContain("pressed:1")
    expect(fgOf(setup, "swatch").slice(0, 3)).toEqual(rgb(THEMES.catppuccin.accent))

    const stored: unknown = JSON.parse(readFileSync(PREFERENCES_PATH(), "utf8"))
    expect(stored).toEqual({ theme: "catppuccin", mode: "plan", model: "claude-3-5-sonnet" })
  })
})
