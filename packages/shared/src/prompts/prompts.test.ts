import { describe, expect, test } from "bun:test"
import { type AgentMode, isAgentMode, systemPrompt } from "../index.js"

/**
 * A mode outside the union is unrepresentable, so this assignment refuses to compile. It is the
 * compile check rather than a runtime one, and it fails in both directions: widening `AgentMode`
 * to `string` leaves the `@ts-expect-error` directive unused, which is itself a typecheck error.
 */
// @ts-expect-error "autopilot" is not an AgentMode
export const MODE_OUTSIDE_THE_UNION: AgentMode = "autopilot"

describe("systemPrompt", () => {
  test("plan mode is read-only and build mode is not", () => {
    const plan = systemPrompt("plan")
    const build = systemPrompt("build")

    expect(plan).toContain("read-only")
    expect(plan).toContain("cannot create, modify, or delete")
    expect(build).toContain("can create, modify, and delete")
    expect(build).not.toContain("read-only")
  })

  test("each mode selects its own prompt, and neither is empty", () => {
    expect(systemPrompt("plan")).not.toBe(systemPrompt("build"))
    expect(systemPrompt("plan").length).toBeGreaterThan(0)
    expect(systemPrompt("build").length).toBeGreaterThan(0)
  })
})

describe("isAgentMode", () => {
  test("accepts the two modes and rejects anything else a file could hold", () => {
    expect(isAgentMode("plan")).toBe(true)
    expect(isAgentMode("build")).toBe(true)
    expect(isAgentMode("autopilot")).toBe(false)
    expect(isAgentMode("")).toBe(false)
  })
})
