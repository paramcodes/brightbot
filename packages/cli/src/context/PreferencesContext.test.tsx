import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV, PREFERENCES_PATH } from "@nightcode/shared"
import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import { renderTui, type } from "../../test/harness.js"
import { THEMES } from "../styles/themes/index.js"
import { PreferencesProvider, usePreferences } from "./PreferencesContext.js"

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
  const { theme, themeName, mode, model, setTheme } = usePreferences()
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
      <text>mode:{mode}</text>
      <text>model:{model}</text>
      <text>pressed:{pressed}</text>
    </box>
  )
}

function Buttons() {
  const { mode, model, setMode, setModel } = usePreferences()
  const [presses, setPresses] = useState(0)
  useKeyboard((event) => {
    if (event.name === "m") {
      setPresses((count) => count + 1)
      setMode(mode === "plan" ? "build" : "plan")
    }
    if (event.name === "d") {
      setPresses((count) => count + 1)
      setModel(model === "claude-haiku-4-5" ? "claude-opus-4-5" : "claude-haiku-4-5")
    }
  })
  return (
    <box flexDirection="column">
      <text>mode:{mode}</text>
      <text>model:{model}</text>
      <text>presses:{presses}</text>
    </box>
  )
}

function mount(preferences?: string) {
  if (preferences !== undefined) seed(preferences)
  return renderTui(
    <PreferencesProvider>
      <Swatch />
      <Buttons />
    </PreferencesProvider>,
  )
}

beforeEach(() => {
  previousHome = process.env[NIGHTCODE_HOME_ENV]
  home = mkdtempSync(join(tmpdir(), "nightcode-preferences-"))
  process.env[NIGHTCODE_HOME_ENV] = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  if (previousHome === undefined) delete process.env[NIGHTCODE_HOME_ENV]
  else process.env[NIGHTCODE_HOME_ENV] = previousHome
})

describe("PreferencesProvider", () => {
  test("a missing preferences file reads every default", async () => {
    const setup = await mount()
    const screen = setup.captureCharFrame()
    expect(screen).toContain("theme:dracula")
    expect(screen).toContain("mode:plan")
    expect(screen).toContain("model:claude-sonnet-4-5")
    expect(fgOf(setup, "swatch").slice(0, 3)).toEqual(rgb(THEMES.dracula.accent))
  })

  test("the persisted values are read on mount, with no interaction", async () => {
    const setup = await mount(JSON.stringify({ theme: "catppuccin", mode: "build", model: "gpt-5" }))
    const screen = setup.captureCharFrame()
    expect(screen).toContain("theme:catppuccin")
    expect(screen).toContain("mode:build")
    expect(screen).toContain("model:gpt-5")
    expect(fgOf(setup, "swatch").slice(0, 3)).toEqual(rgb(THEMES.catppuccin.accent))
  })

  test("a mode the file cannot back up reads as the default rather than crashing", async () => {
    const setup = await mount(JSON.stringify({ mode: "autopilot", model: "gpt-5" }))
    const screen = setup.captureCharFrame()
    expect(screen).toContain("mode:plan")
    expect(screen).toContain("model:gpt-5")
  })

  test("switching theme repaints the frame and writes the choice back", async () => {
    const setup = await mount()
    expect(fgOf(setup, "swatch").slice(0, 3)).toEqual(rgb(THEMES.dracula.accent))
    await type(setup, "t")
    const screen = setup.captureCharFrame()
    expect(screen).toContain("theme:catppuccin")
    expect(screen).toContain("pressed:1")
    expect(fgOf(setup, "swatch").slice(0, 3)).toEqual(rgb(THEMES.catppuccin.accent))

    const stored: unknown = JSON.parse(readFileSync(PREFERENCES_PATH(), "utf8"))
    expect(stored).toEqual({ theme: "catppuccin", mode: "plan", model: "claude-sonnet-4-5" })
  })

  test("setMode and setModel update the live values and persist both", async () => {
    const setup = await mount()
    expect(setup.captureCharFrame()).toContain("mode:plan")

    // Two setters over one provider. Two providers over one file would each rewrite the whole file
    // from its own copy of state, so the second write would drop the first; the file below holding
    // both is the proof that this app has exactly one instance.
    await type(setup, "m")
    await type(setup, "d")
    const screen = setup.captureCharFrame()
    expect(screen).toContain("mode:build")
    expect(screen).toContain("model:claude-haiku-4-5")

    const stored: unknown = JSON.parse(readFileSync(PREFERENCES_PATH(), "utf8"))
    expect(stored).toEqual({ theme: "dracula", mode: "build", model: "claude-haiku-4-5" })
  })

  test("a setter over an unwritable home changes the run and does not crash", async () => {
    const setup = await mount()
    // A directory where the file belongs is unreadable as JSON and unwritable as JSON, which is a
    // store whose every write throws without depending on how this machine's uid treats file modes.
    mkdirSync(PREFERENCES_PATH(), { recursive: true })

    await type(setup, "m")
    const screen = setup.captureCharFrame()
    expect(screen).toContain("mode:build")
    expect(screen).toContain("presses:1")
    rmSync(PREFERENCES_PATH(), { recursive: true, force: true })
  })
})
