import { afterEach, describe, expect, test } from "bun:test"
import { assertInteractiveTerminal } from "./renderer.js"

const originalStdout = process.stdout.isTTY
const originalStdin = process.stdin.isTTY

/** The guard reads two properties, so a test says which one it changed and puts both back. */
function streams(stdout: boolean, stdin: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true })
  Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true })
}

/** Runs the guard with `exit` and `stderr.write` captured, and restores both whatever happens. */
function guard(): { code: number | null; written: string } {
  let code: number | null = null
  let written = ""
  const realExit = process.exit
  const realWrite = process.stderr.write.bind(process.stderr)
  process.exit = ((value: number) => {
    code = value
    return undefined as never
  }) as typeof process.exit
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written += String(chunk)
    return true
  }) as typeof process.stderr.write
  try {
    assertInteractiveTerminal()
  } finally {
    process.exit = realExit
    process.stderr.write = realWrite
  }
  return { code, written }
}

afterEach(() => {
  streams(originalStdout, originalStdin)
})

describe("assertInteractiveTerminal", () => {
  test("a real terminal on both streams passes", () => {
    streams(true, true)
    expect(guard()).toEqual({ code: null, written: "" })
  })

  test("a piped stdout is refused with the message CI greps for", () => {
    streams(false, true)
    expect(guard()).toEqual({
      code: 1,
      written: "nightcode needs an interactive terminal. Run it directly, not through a pipe.\n",
    })
  })

  test("a non-tty stdin is refused even when stdout is a terminal", () => {
    // The case that hangs: the banner draws and no keypress is ever read.
    streams(true, false)
    expect(guard()).toEqual({ code: 1, written: expect.any(String) })
  })
})
