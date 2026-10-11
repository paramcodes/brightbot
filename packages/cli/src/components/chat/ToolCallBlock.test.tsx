import { describe, expect, test } from "bun:test"
import { frame, renderTui, settle } from "../../../test/harness.js"
import type { ToolRun } from "../../core/chat/types.js"
import { defaultTheme } from "../../styles/theme.js"
import { ToolCallBlock } from "./ToolCallBlock.js"

const theme = defaultTheme

function run(overrides: Partial<ToolRun> & { toolName: string }): ToolRun {
  return {
    call: { toolCallId: `call-${overrides.toolName}`, toolName: overrides.toolName, input: { path: "a.ts" } },
    status: "complete",
    output: "done",
    durationMs: 3,
    ...overrides,
  }
}

describe("ToolCallBlock", () => {
  test("a block with no runs renders nothing, so a quiet turn stays quiet", async () => {
    const setup = await renderTui(
      <box flexDirection="column">
        <ToolCallBlock theme={theme} runs={[]} />
      </box>,
    )
    await settle(setup)
    expect(frame(setup)).not.toContain("tool call")
    setup.renderer.destroy()
  })

  test("one finished call is summarised as a single call", async () => {
    const setup = await renderTui(
      <box flexDirection="column">
        <ToolCallBlock theme={theme} runs={[run({ toolName: "read_file" })]} />
      </box>,
    )
    await settle(setup)

    expect(frame(setup)).toContain("1 tool call")
    expect(frame(setup)).toContain("read_file")
    setup.renderer.destroy()
  })

  test("consecutive calls are grouped into one summary, not four blocks", async () => {
    const runs = ["read_file", "glob", "grep", "list_directory"].map((toolName) => run({ toolName }))
    const setup = await renderTui(
      <box flexDirection="column">
        <ToolCallBlock theme={theme} runs={runs} />
      </box>,
    )
    await settle(setup)

    const screen = frame(setup)
    expect(screen).toContain("4 tool calls")
    // One summary line for the group rather than one header per call.
    expect(screen.split("tool call").length - 1).toBe(1)
    for (const toolName of ["read_file", "glob", "grep", "list_directory"]) expect(screen).toContain(toolName)
    setup.renderer.destroy()
  })

  test("a denied call marks the group denied, so a collapsed block still says so", async () => {
    const runs = [run({ toolName: "read_file" }), run({ toolName: "write_file", status: "denied", durationMs: 0 })]
    const setup = await renderTui(
      <box flexDirection="column">
        <ToolCallBlock theme={theme} runs={runs} />
      </box>,
    )
    await settle(setup)

    expect(frame(setup)).toContain("denied")
    setup.renderer.destroy()
  })

  test("a call still waiting says so rather than showing a duration", async () => {
    const setup = await renderTui(
      <box flexDirection="column">
        <ToolCallBlock theme={theme} runs={[run({ toolName: "bash", status: "running", durationMs: null })]} />
      </box>,
    )
    await settle(setup)

    const screen = frame(setup)
    expect(screen).toContain("running")
    expect(screen).not.toContain("ms")
    setup.renderer.destroy()
  })
})
