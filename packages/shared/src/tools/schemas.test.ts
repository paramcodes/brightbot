import { describe, expect, test } from "bun:test"
import type { AgentMode } from "../index.js"
import { chatFrameSchema, chatRequestSchema } from "../schemas/chat.js"
import type { ToolName } from "../tools/index.js"
import { TOOL_NAMES, toolNameSchema, toolSchemas, toolsForMode } from "./schemas.js"

const USER_REQUEST = { sessionId: "session-1", system: "you are nightcode", tools: ["read_file"] }

/** A tool call and the result that answers it, as the wire carries them. */
const CALL = { toolCallId: "call-1", toolName: "read_file", input: { path: "README.md" } }

const VALID_INPUTS: Record<ToolName, unknown> = {
  read_file: { path: "README.md" },
  write_file: { path: "notes.md", content: "hello" },
  edit_file: { path: "notes.md", search: "hello", replace: "goodbye" },
  list_directory: { path: "." },
  glob: { pattern: "packages/**/*.ts" },
  grep: { pattern: "todo" },
  bash: { command: "echo hi" },
}

// @ts-expect-error "neither" is not an AgentMode
const NEITHER_MODE: AgentMode = "neither"

describe("toolsForMode", () => {
  test("plan mode is the four readers", () => {
    expect(toolsForMode("plan")).toEqual(["read_file", "list_directory", "glob", "grep"])
  })

  test("build mode is every tool", () => {
    expect(toolsForMode("build")).toEqual([...TOOL_NAMES])
  })

  test("plan mode names no tool that writes", () => {
    const plan = toolsForMode("plan")
    expect(plan).not.toContain("write_file")
    expect(plan).not.toContain("edit_file")
    expect(plan).not.toContain("bash")
  })

  test("a mode outside the union throws", () => {
    expect(() => toolsForMode(NEITHER_MODE)).toThrow()
  })
})

describe("the tool contracts", () => {
  test("the names tuple is closed at seven and names each schema", () => {
    for (const name of TOOL_NAMES) expect(Object.hasOwn(toolSchemas, name)).toBe(true)
    expect(Object.keys(toolSchemas)).toHaveLength(7)
  })

  for (const name of TOOL_NAMES) {
    test(`${name} accepts its input`, () => {
      expect(toolSchemas[name].safeParse(VALID_INPUTS[name]).success).toBe(true)
    })
    test(`${name} rejects an empty input`, () => {
      expect(toolSchemas[name].safeParse({}).success).toBe(false)
    })
  }

  test("read_file refuses an empty path", () => {
    expect(toolSchemas.read_file.safeParse({ path: "" }).success).toBe(false)
  })

  test("an unknown name is not a tool name", () => {
    expect(toolNameSchema.safeParse("delete_everything").success).toBe(false)
    expect(toolNameSchema.safeParse("read_file").success).toBe(true)
  })
})

describe("the tool-call frame", () => {
  test("a call decodes with its id, name, and input", () => {
    const parsed = chatFrameSchema.safeParse({ type: "tool-call", ...CALL })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toEqual({ type: "tool-call", ...CALL })
  })

  test("a call with no id is refused", () => {
    expect(chatFrameSchema.safeParse({ type: "tool-call", toolName: "read_file", input: {} }).success).toBe(false)
  })

  test("a frame the union does not describe is still refused", () => {
    expect(chatFrameSchema.safeParse({ type: "progress", percent: 50 }).success).toBe(false)
  })
})

describe("the transcript", () => {
  test("a round that ends on a tool result is accepted", () => {
    const parsed = chatRequestSchema.safeParse({
      ...USER_REQUEST,
      messages: [
        { role: "user", content: "read the readme" },
        { role: "assistant", content: "reading" },
        { role: "tool", ...CALL, output: "# Night Code", ok: true },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  test("a round that ends on the user is still accepted", () => {
    const parsed = chatRequestSchema.safeParse({ ...USER_REQUEST, messages: [{ role: "user", content: "hello" }] })
    expect(parsed.success).toBe(true)
  })

  test("a request that declares no tools is refused", () => {
    const parsed = chatRequestSchema.safeParse({
      sessionId: "session-1",
      system: "you are nightcode",
      messages: [{ role: "user", content: "hello" }],
    })
    expect(parsed.success).toBe(false)
  })

  test("a request that ends on an assistant message is refused", () => {
    const parsed = chatRequestSchema.safeParse({
      ...USER_REQUEST,
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    })
    expect(parsed.success).toBe(false)
  })

  test("a tool message with no output is refused", () => {
    const parsed = chatRequestSchema.safeParse({
      ...USER_REQUEST,
      messages: [
        { role: "user", content: "read the readme" },
        { role: "tool", ...CALL, ok: true },
      ],
    })
    expect(parsed.success).toBe(false)
  })
})
