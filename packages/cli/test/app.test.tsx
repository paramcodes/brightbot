import { describe, expect, test } from "bun:test"
import { App } from "../src/app.js"
import { renderTui } from "./harness.js"

describe("app shell", () => {
  test("renders the placeholder greeting in the terminal root", async () => {
    const setup = await renderTui(<App />)
    expect(setup.captureCharFrame()).toContain("terminal coding agent")
    expect(setup.captureCharFrame()).toContain("ctrl+c to quit")
  })
})
