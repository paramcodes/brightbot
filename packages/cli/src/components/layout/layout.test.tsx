import { describe, expect, test } from "bun:test"
import { renderTui } from "../../../test/harness.js"
import { defaultTheme } from "../../styles/theme.js"
import { Header } from "./Header.js"

const base = {
  theme: defaultTheme,
  cwd: "/home/dev/project",
  mode: "plan",
  model: "claude-3-5-sonnet",
  status: "idle",
}

function headerFrame(width: number, overrides: Partial<typeof base>) {
  return renderTui(<Header {...base} {...overrides} width={width} />, { width, height: 4 }).then((setup) => setup.captureCharFrame())
}

describe("Header", () => {
  test("shows every segment on a wide terminal", async () => {
    const frame = await headerFrame(120, {})
    expect(frame).toContain("Night Code")
    expect(frame).toContain("/home/dev/project")
    expect(frame).toContain("plan")
    expect(frame).toContain("claude-3-5-sonnet")
    expect(frame).toContain("idle")
  })

  test("truncates a long working directory instead of wrapping", async () => {
    const frame = await headerFrame(60, { cwd: "/home/developer/really/deep/nested/project/folder/structure" })
    expect(frame).toContain("…")
    expect(frame.split("\n").filter((row) => row.trim().length > 0)).toHaveLength(1)
  })
})
