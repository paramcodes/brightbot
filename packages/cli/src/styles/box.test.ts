import { describe, expect, test } from "bun:test"
import { HINT_BAR_HEIGHT, panelProps } from "./box.js"
import { defaultTheme, dracula } from "./theme.js"

describe("panelProps", () => {
  test("uses the theme border and the focused color when focused", () => {
    const relaxed = panelProps(dracula, {})
    expect(relaxed.borderColor).toBe(dracula.border)

    const focused = panelProps(dracula, { focused: true })
    expect(focused.borderColor).toBe(dracula.borderFocused)
  })

  test("defaults to a full-width column with a rounded border", () => {
    expect(panelProps(dracula, {})).toMatchObject({ borderStyle: "rounded", flexDirection: "column", width: "100%", height: "auto" })
  })

  test("keeps explicit geometry", () => {
    expect(panelProps(dracula, { flexDirection: "row", width: 40, height: 5, flexGrow: 2 })).toMatchObject({
      flexDirection: "row",
      width: 40,
      height: 5,
      flexGrow: 2,
    })
  })
})

describe("themes", () => {
  test("ships one default theme with every role filled", () => {
    expect(defaultTheme.name).toBe("dracula")
    for (const value of Object.values(defaultTheme)) {
      expect(typeof value === "number" || (typeof value === "string" && value.length > 0)).toBe(true)
    }
  })

  test("reserves three rows for the hint bar", () => {
    expect(HINT_BAR_HEIGHT).toBe(3)
  })
})
