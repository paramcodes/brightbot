import { readFileSync } from "node:fs"
import { relative, sep } from "node:path"
import type { ToolCall, ToolResult } from "@nightcode/shared"
import { toolNameSchema } from "@nightcode/shared"
import { Glob } from "bun"
import ignore, { type Ignore } from "ignore"
import { ensureParent, exists, isDirectory, readText, resolveWithin, toolRoot, writeText } from "./fs-utils.js"

/**
 * Directories no tool walks, whatever the `.gitignore` says.
 *
 * The same list the `@` picker prunes, and for the same reason: a repo that never wrote the rule still
 * has a vendored `vendor` or a generated `build`, and a tool that spent its budget there would answer
 * about generated files. `.nightcode` is here so a session started in the home directory cannot read
 * its own credentials back out.
 */
const ALWAYS_SKIP = new Set([".git", ".nightcode", "node_modules", "dist", "build", "out", "target", "vendor", ".next", ".cache"])

/** Rows one listing or one search ever returns. Past this the result is a wall, not an answer. */
export const MAX_TOOL_ROWS = 500

/** A command that has not finished by here is killed, because a turn must not hang forever. */
export const TOOL_TIMEOUT_MS = 30_000

/**
 * Characters of one file a read returns.
 *
 * The cap is applied after the read rather than by a partial read, so a truncated file still says it
 * was truncated instead of pretending to be short.
 */
export const MAX_FILE_CHARS = 200_000

/** A result that carries a refusal. The model is told, so it can ask differently. */
function refused(run: ToolCall, why: string): ToolResult {
  return { toolCallId: run.toolCallId, toolName: run.toolName, ok: false, output: why }
}

function answered(run: ToolCall, output: string): ToolResult {
  return { toolCallId: run.toolCallId, toolName: run.toolName, ok: true, output }
}

/** The path as the caller wrote it, relative and with forward slashes. */
function inside(root: string, target: string): string {
  return relative(root, target).split(sep).join("/")
}

/**
 * Every entry the walk keeps under `root`, relative to it, with directories marked by a slash.
 *
 * One `Glob` per directory rather than one pattern for the tree, because a single pattern cannot prune a
 * nested `node_modules` and `Glob` has no scan-time filter to do it for us. Each directory carries its
 * own accumulated matcher built in descent order, so a deeper `.gitignore` overrides a shallower one,
 * which is git's own precedence. Symlinks are never descended into, because following one could cycle
 * forever.
 */
function collect(root: string, directory: string, matcher: Ignore, found: string[], withDirectories: boolean): void {
  if (found.length >= MAX_TOOL_ROWS) return
  const prefix = inside(root, directory)
  const local = loadGitignore(directory, prefix, matcher)
  for (const name of new Glob("*").scanSync({ cwd: directory, dot: true, onlyFiles: false })) {
    if (found.length >= MAX_TOOL_ROWS) return
    const path = prefix.length === 0 ? name : `${prefix}/${name}`
    const absolute = `${directory}${sep}${name}`
    const dir = isDirectory(absolute)
    if (ALWAYS_SKIP.has(name)) continue
    if (matcher.ignores(dir ? `${path}/` : path)) continue
    if (dir) {
      if (withDirectories) found.push(`${path}/`)
      collect(root, absolute, local, found, withDirectories)
      continue
    }
    if (exists(absolute)) found.push(path)
  }
}

/** Every file a tool may see, as a sorted relative list. */
function visibleFiles(root: string): string[] {
  const found: string[] = []
  collect(root, root, ignore(), found, false)
  found.sort()
  return found
}

/** Every entry a directory holds, nested and capped, with directories marked. */
function visibleEntries(root: string): string[] {
  const found: string[] = []
  collect(root, root, ignore(), found, true)
  found.sort()
  return found
}

function loadGitignore(directory: string, prefix: string, matcher: Ignore): Ignore {
  let text: string
  try {
    text = readFileSync(`${directory}${sep}.gitignore`, "utf8")
  } catch {
    // Either there is no `.gitignore` here or it cannot be read. Neither is a reason to abandon the
    // rest of the directory.
    return matcher
  }
  const patterns = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => prefixPattern(line, prefix))
  return matcher.add(patterns)
}

/**
 * A `.gitignore` line as the matcher wants it, relocated to the directory it was found in.
 *
 * The root file is the case `ignore` was built for, so it is handed over untouched. Above the root,
 * an unanchored rule matches at any depth below its own directory, which is a globstar, and an
 * anchored one matches only directly in it, which is the prefix alone.
 */
function prefixPattern(line: string, prefix: string): string {
  if (prefix.length === 0) return line
  const negated = line.startsWith("!")
  const pattern = negated ? line.slice(1) : line
  const anchored = pattern.startsWith("/")
  const bare = anchored ? pattern.slice(1) : pattern
  // A bare slash names the directory itself, which the prefix already is.
  if (bare.length === 0) return line
  const body = anchored ? `${prefix}/${bare}` : `${prefix}/**/${bare}`
  return negated ? `!${body}` : body
}

/**
 * A glob matcher over a whole relative path.
 *
 * `Bun.Glob` is the runtime's own, and the tests above it only ever needed a file to match: it is not
 * a second glob implementation to keep in step with the walk.
 */
export function matchGlob(pattern: string, path: string): boolean {
  return new Glob(pattern).match(path)
}

function truncated(text: string): string {
  if (text.length <= MAX_FILE_CHARS) return text
  return `${text.slice(0, MAX_FILE_CHARS)}\n[truncated at ${MAX_FILE_CHARS} of ${text.length} characters]`
}

function pathOf(input: Record<string, unknown>): string {
  const path = input.path
  return typeof path === "string" ? path : ""
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === "string" ? value : null
}

function readFileTool(root: string, call: ToolCall, input: Record<string, unknown>): ToolResult {
  const asked = pathOf(input)
  const target = resolveWithin(root, asked)
  if (target === null) return refused(call, `${asked} is outside the working directory`)
  if (!exists(target) || isDirectory(target)) return refused(call, `no file at ${asked}`)
  return answered(call, truncated(readText(target)))
}

function writeFileTool(root: string, call: ToolCall, input: Record<string, unknown>): ToolResult {
  const asked = pathOf(input)
  const target = resolveWithin(root, asked)
  if (target === null) return refused(call, `${asked} is outside the working directory`)
  if (isDirectory(target)) return refused(call, `${asked} is a directory`)
  const content = stringField(input, "content")
  if (content === null) return refused(call, "content was not a string")
  ensureParent(target)
  writeText(target, content)
  return answered(call, `wrote ${content.length} characters to ${asked}`)
}

function editFileTool(root: string, call: ToolCall, input: Record<string, unknown>): ToolResult {
  const asked = pathOf(input)
  const target = resolveWithin(root, asked)
  if (target === null) return refused(call, `${asked} is outside the working directory`)
  if (!exists(target) || isDirectory(target)) return refused(call, `no file at ${asked}`)
  const search = stringField(input, "search")
  const replace = stringField(input, "replace")
  if (search === null || search.length === 0) return refused(call, "search was not a non-empty string")
  if (replace === null) return refused(call, "replace was not a string")

  const original = readText(target)
  // Counted rather than replaced-then-compared, because an edit that touched the wrong occurrence has
  // already done the damage by the time a comparison could notice it.
  const occurrences = original.split(search).length - 1
  if (occurrences === 0) return refused(call, `${JSON.stringify(search)} does not appear in ${asked}`)
  if (occurrences > 1) {
    return refused(
      call,
      `${JSON.stringify(search)} appears ${occurrences} times in ${asked}, and one occurrence is the only one a targeted edit can mean`,
    )
  }
  writeText(target, original.replace(search, replace))
  return answered(call, `replaced 1 occurrence in ${asked}`)
}

function listDirectoryTool(root: string, call: ToolCall, input: Record<string, unknown>): ToolResult {
  const asked = pathOf(input)
  const target = resolveWithin(root, asked)
  if (target === null) return refused(call, `${asked} is outside the working directory`)
  if (!isDirectory(target)) return refused(call, `no directory at ${asked}`)
  const entries = visibleEntries(target)
  return answered(call, entries.length === 0 ? "(empty)" : entries.join("\n"))
}

function globTool(root: string, call: ToolCall, input: Record<string, unknown>): ToolResult {
  const pattern = stringField(input, "pattern")
  if (pattern === null || pattern.length === 0) return refused(call, "pattern was not a non-empty string")
  const matches = visibleFiles(root).filter((file) => matchGlob(pattern, file))
  const shown = matches.slice(0, MAX_TOOL_ROWS)
  const suffix = matches.length > shown.length ? `\n[${matches.length - shown.length} more not shown]` : ""
  return answered(call, matches.length === 0 ? "no match" : `${shown.join("\n")}${suffix}`)
}

function grepTool(root: string, call: ToolCall, input: Record<string, unknown>): ToolResult {
  const pattern = stringField(input, "pattern")
  if (pattern === null || pattern.length === 0) return refused(call, "pattern was not a non-empty string")
  let expression: RegExp
  try {
    expression = new RegExp(pattern)
  } catch (error) {
    return refused(call, `invalid regular expression: ${error instanceof Error ? error.message : "unknown reason"}`)
  }
  const hits: string[] = []
  for (const file of visibleFiles(root)) {
    let text: string
    try {
      text = readText(`${root}${sep}${file}`)
    } catch {
      // A file the walk can see but the read cannot is a file that changed under the walk. It is
      // skipped rather than reported, because the answer is about what was found.
      continue
    }
    for (const [index, line] of text.split("\n").entries()) {
      if (hits.length >= MAX_TOOL_ROWS) break
      if (expression.test(line)) hits.push(`${file}:${index + 1}:${truncated(line)}`)
    }
  }
  return answered(call, hits.length === 0 ? "no match" : `${hits.join("\n")}\n[${hits.length} ${hits.length === 1 ? "line" : "lines"}]`)
}

/**
 * Reads a stream to the end, or gives up at the deadline and reports what arrived before it.
 *
 * A command that left a background process behind holds its pipe open after the shell exits, so the
 * exit settles immediately and the read would otherwise hang the turn on a developer server. The
 * reader is cancelled on the way out, because an abandoned read leaves a promise nothing will settle
 * and a process that never drains.
 */
async function drain(stream: ReadableStream<Uint8Array>, milliseconds = TOOL_TIMEOUT_MS): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  const deadline = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), milliseconds))
  try {
    while (true) {
      const next = await Promise.race([reader.read(), deadline])
      if (next === "timeout" || next.done) break
      chunks.push(decoder.decode(next.value, { stream: true }))
    }
  } finally {
    // Racing a read against a timer leaves the read pending, so it is cancelled here rather than left
    // for the process to clean up.
    await reader.cancel().catch(() => {})
  }
  return chunks.join("")
}

function bashTool(root: string, call: ToolCall, input: Record<string, unknown>): Promise<ToolResult> {
  const command = stringField(input, "command")
  if (command === null || command.trim().length === 0) return Promise.resolve(refused(call, "command was empty"))
  return new Promise((settle) => {
    const child = Bun.spawn(["sh", "-c", command], { cwd: root, stdout: "pipe", stderr: "pipe" })
    // Killed rather than awaited, because a command that hangs is a turn that never ends and the user
    // has no way to stop it that is not killing the CLI.
    const timer = setTimeout(() => child.kill(), TOOL_TIMEOUT_MS)
    void child.exited.then(async () => {
      clearTimeout(timer)
      // The exit settles when the shell does, and a command that left a background process behind
      // holds its pipe open after that. Draining without a deadline would hang the turn on a
      // developer server, so the drain is bounded and its silence is reported rather than swallowed.
      const out = await drain(child.stdout)
      const err = await drain(child.stderr)
      const partial = out.length === 0 && err.length === 0
      const combined = [...[out, err], ...(partial ? ["[the command left a process running, so its output was not collected]"] : [])]
        .join("")
        .trim()
      const code = child.exitCode ?? 0
      const body = combined.length > 0 ? combined : `exited ${code}`
      settle(code === 0 ? answered(call, body) : refused(call, `exited ${code}\n${body}`))
    })
  })
}

/**
 * Runs one call against the working directory.
 *
 * Each executor answers with a `ToolResult` and never throws: a turn that reads a file it cannot open
 * is a turn that reports that, and a stack trace is not a sentence the model can act on. The output is
 * always a string because it goes straight back to the model as text.
 */
export async function executeTool(call: ToolCall, root: string = toolRoot()): Promise<ToolResult> {
  const named = toolNameSchema.safeParse(call.toolName)
  if (!named.success) return refused(call, `no tool named ${call.toolName}`)
  if (typeof call.input !== "object" || call.input === null) return refused(call, "input was not an object")
  const input = call.input as Record<string, unknown>

  switch (named.data) {
    case "read_file":
      return readFileTool(root, call, input)
    case "write_file":
      return writeFileTool(root, call, input)
    case "edit_file":
      return editFileTool(root, call, input)
    case "list_directory":
      return listDirectoryTool(root, call, input)
    case "glob":
      return globTool(root, call, input)
    case "grep":
      return grepTool(root, call, input)
    case "bash":
      return bashTool(root, call, input)
  }
}
