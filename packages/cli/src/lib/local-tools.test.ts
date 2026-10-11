import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolCall } from "@nightcode/shared"
import { ensureParent, exists, isDirectory, readText, resolveWithin, toolRoot, writeText } from "./fs-utils.js"
import { executeTool, matchGlob } from "./local-tools.js"

function call(toolName: string, input: unknown): ToolCall {
  return { toolCallId: randomUUID(), toolName, input }
}

describe("resolveWithin", () => {
  test("a relative path resolves inside the root", () => {
    expect(resolveWithin("/repo", "src/app.ts")).toBe("/repo/src/app.ts")
  })

  test("the root itself is inside the root", () => {
    expect(resolveWithin("/repo", ".")).toBe("/repo")
  })

  test("a parent escape is refused", () => {
    expect(resolveWithin("/repo", "../etc/passwd")).toBeNull()
  })

  test("a sibling with a shared prefix is refused", () => {
    // The bound includes the separator, so `/repo-other` is not inside `/repo`.
    expect(resolveWithin("/repo", "/repo-other/x")).toBeNull()
  })

  test("an absolute path is refused rather than reinterpreted", () => {
    expect(resolveWithin("/repo", "/etc/passwd")).toBeNull()
  })

  test("a nested escape through a symlinked directory is refused", () => {
    expect(resolveWithin("/repo/sub", "../../other")).toBeNull()
  })
})

describe("executeTool", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nightcode-tools-"))
    mkdirSync(join(root, "src/nested"), { recursive: true })
    mkdirSync(join(root, "node_modules/left-pad"), { recursive: true })
    writeFileSync(join(root, "README.md"), "# Night Code\nread the docs\n")
    writeFileSync(join(root, "src/app.ts"), "export const a = 1\n")
    writeFileSync(join(root, "src/nested/deep.ts"), "export const b = 2\n")
    writeFileSync(join(root, "node_modules/left-pad/index.js"), "module.exports = {}\n")
    writeFileSync(join(root, ".gitignore"), "ignored.txt\nbuild/\n")
    writeFileSync(join(root, "ignored.txt"), "do not see me\n")
    mkdirSync(join(root, "build"), { recursive: true })
    writeFileSync(join(root, "build/out.js"), "generated\n")
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test("read_file returns the text", async () => {
    const result = await executeTool(call("read_file", { path: "README.md" }), root)
    expect(result).toEqual({ toolCallId: result.toolCallId, toolName: "read_file", ok: true, output: "# Night Code\nread the docs\n" })
  })

  test("read_file refuses a path outside the root", async () => {
    const result = await executeTool(call("read_file", { path: "../etc/passwd" }), root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain("outside the working directory")
  })

  test("read_file refuses a file that is not there", async () => {
    const result = await executeTool(call("read_file", { path: "nope.md" }), root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain("no file at")
  })

  test("read_file refuses a directory", async () => {
    const result = await executeTool(call("read_file", { path: "src" }), root)
    expect(result.ok).toBe(false)
  })

  test("write_file creates a file and its parents", async () => {
    const result = await executeTool(call("write_file", { path: "src/nested/made.ts", content: "hello\n" }), root)
    expect(result.ok).toBe(true)
    expect(readText(`${root}/src/nested/made.ts`)).toBe("hello\n")
  })

  test("write_file overwrites what was there", async () => {
    await executeTool(call("write_file", { path: "README.md", content: "replaced" }), root)
    expect(readText(`${root}/README.md`)).toBe("replaced")
  })

  test("write_file refuses an escape", async () => {
    const result = await executeTool(call("write_file", { path: "../escaped.ts", content: "x" }), root)
    expect(result.ok).toBe(false)
    expect(exists(`${root}/../escaped.ts`)).toBe(false)
  })

  test("edit_file replaces the one occurrence", async () => {
    const result = await executeTool(call("edit_file", { path: "README.md", search: "Night Code", replace: "Night Code 2" }), root)
    expect(result.ok).toBe(true)
    expect(readText(`${root}/README.md`)).toBe("# Night Code 2\nread the docs\n")
  })

  test("edit_file refuses an ambiguous edit", async () => {
    const result = await executeTool(call("edit_file", { path: "README.md", search: "e", replace: "E" }), root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain("appears")
    // The file is untouched, which is the whole point of counting before replacing.
    expect(readText(`${root}/README.md`)).toBe("# Night Code\nread the docs\n")
  })

  test("edit_file refuses a search that is not there", async () => {
    const result = await executeTool(call("edit_file", { path: "README.md", search: "absent", replace: "x" }), root)
    expect(result.ok).toBe(false)
  })

  test("list_directory lists entries and marks directories", async () => {
    const result = await executeTool(call("list_directory", { path: "." }), root)
    expect(result.ok).toBe(true)
    expect(result.output.split("\n")).toContain("README.md")
    expect(result.output.split("\n")).toContain("src/")
    expect(result.output.split("\n")).toContain("src/nested/")
  })

  test("list_directory skips what the gitignore hides", async () => {
    const result = await executeTool(call("list_directory", { path: "." }), root)
    expect(result.output).not.toContain("ignored.txt")
    expect(result.output).not.toContain("build/")
    expect(result.output).not.toContain("node_modules")
  })

  test("glob matches at any depth with a double star", async () => {
    const result = await executeTool(call("glob", { pattern: "src/**/*.ts" }), root)
    expect(result.ok).toBe(true)
    expect(result.output.split("\n").sort()).toEqual(["src/app.ts", "src/nested/deep.ts"])
  })

  test("glob matches a single segment with a single star", async () => {
    const result = await executeTool(call("glob", { pattern: "*.md" }), root)
    expect(result.output).toBe("README.md")
  })

  test("glob refuses an empty pattern", async () => {
    const result = await executeTool(call("glob", { pattern: "" }), root)
    expect(result.ok).toBe(false)
  })

  test("grep returns path, line, and text", async () => {
    const result = await executeTool(call("grep", { pattern: "read the docs" }), root)
    expect(result.ok).toBe(true)
    expect(result.output).toBe("README.md:2:read the docs\n[1 line]")
  })

  test("grep does not search ignored files", async () => {
    const result = await executeTool(call("grep", { pattern: "do not see me" }), root)
    expect(result.ok).toBe(true)
    expect(result.output).toBe("no match")
  })

  test("grep refuses an invalid expression", async () => {
    const result = await executeTool(call("grep", { pattern: "([unclosed" }), root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain("invalid regular expression")
  })

  test("bash runs a command in the working directory", async () => {
    const result = await executeTool(call("bash", { command: "pwd" }), root)
    expect(result.ok).toBe(true)
    expect(result.output.trim()).toBe(root)
  })

  test("bash reports a non-zero exit", async () => {
    const result = await executeTool(call("bash", { command: "exit 3" }), root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain("exited 3")
  })

  test("bash captures stdout and stderr", async () => {
    const result = await executeTool(call("bash", { command: "echo out; echo err 1>&2" }), root)
    expect(result.ok).toBe(true)
    expect(result.output).toContain("out")
    expect(result.output).toContain("err")
  })

  test("a tool that does not exist is refused", async () => {
    const result = await executeTool(call("delete_everything", {}), root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain("no tool named")
  })

  test("an input that is not an object is refused", async () => {
    const result = await executeTool(call("read_file", "README.md"), root)
    expect(result.ok).toBe(false)
  })

  test("a symlink out of the root is not followed", async () => {
    mkdirSync(join(tmpdir(), `nightcode-outside-${randomUUID()}`), { recursive: true })
    writeFileSync(`${tmpdir()}/outside-target.txt`, "secret\n")
    try {
      symlinkSync(`${tmpdir()}/outside-target.txt`, `${root}/link.txt`)
      const listed = await executeTool(call("list_directory", { path: "." }), root)
      expect(listed.output).not.toContain("outside-target.txt")
      const read = await executeTool(call("read_file", { path: "link.txt" }), root)
      expect(read.ok).toBe(false)
    } finally {
      rmSync(`${tmpdir()}/outside-target.txt`, { force: true })
    }
  })
})

describe("matchGlob", () => {
  test("a single star matches inside one segment", () => {
    expect(matchGlob("*.md", "README.md")).toBe(true)
    expect(matchGlob("*", "app.ts")).toBe(true)
  })

  test("a double star reaches any depth, including none", () => {
    expect(matchGlob("src/**/*.ts", "src/app.ts")).toBe(true)
    expect(matchGlob("src/**/*.ts", "src/nested/deep.ts")).toBe(true)
    expect(matchGlob("**/*.ts", "src/app.ts")).toBe(true)
    expect(matchGlob("**/*.ts", "app.ts")).toBe(true)
  })

  test("a star does not cross a separator", () => {
    expect(matchGlob("*.ts", "src/app.ts")).toBe(false)
    expect(matchGlob("src/*", "src/nested/app.ts")).toBe(false)
  })

  test("a segment must match exactly", () => {
    expect(matchGlob("src/app.ts", "src/app.ts")).toBe(true)
    expect(matchGlob("src/app.ts", "src/app.tsx")).toBe(false)
  })

  test("a literal dot is not a wildcard", () => {
    expect(matchGlob("*.ts", "appXts")).toBe(false)
  })
})

describe("the filesystem helpers", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nightcode-fs-"))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test("ensureParent makes the directories a path passes through", () => {
    ensureParent(`${root}/a/b/c.txt`)
    writeText(`${root}/a/b/c.txt`, "x")
    expect(readText(`${root}/a/b/c.txt`)).toBe("x")
  })

  test("exists answers for a file and a directory and for nothing", () => {
    writeText(`${root}/file.txt`, "x")
    mkdirSync(`${root}/dir`)
    expect(exists(`${root}/file.txt`)).toBe(true)
    expect(exists(`${root}/dir`)).toBe(true)
    expect(exists(`${root}/absent`)).toBe(false)
  })

  test("isDirectory answers only for a directory", () => {
    writeText(`${root}/file.txt`, "x")
    mkdirSync(`${root}/dir`)
    expect(isDirectory(`${root}/dir`)).toBe(true)
    expect(isDirectory(`${root}/file.txt`)).toBe(false)
    expect(isDirectory(`${root}/absent`)).toBe(false)
  })

  test("toolRoot is the process working directory", () => {
    expect(toolRoot()).toBe(process.cwd())
  })
})
