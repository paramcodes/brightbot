import { describe, expect, test } from "bun:test"
import { App } from "../src/app.js"
import { renderTui, type } from "./harness.js"

describe("app shell", () => {
  test("renders header, banner, and composer", async () => {
    const setup = await renderTui(<App />)
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Night Code")
    expect(frame).toContain("terminal coding agent")
    expect(frame).toContain("ask nightcode to do something")
  })

  test("echoes typed text into the composer", async () => {
    const setup = await renderTui(<App />)
    await type(setup, "read package.json")
    expect(setup.captureCharFrame()).toContain("read package.json")
  })
})
