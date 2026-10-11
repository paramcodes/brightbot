import { afterEach, describe, expect, test } from "bun:test"
import type { CliRenderer } from "@opentui/core"
import { adoptRenderer, installExitTraps, restoreTerminal } from "./terminal-cleanup.js"

/**
 * A renderer stand-in that counts teardowns and refuses to run twice.
 *
 * The idempotence is modelled rather than assumed: the real `destroy()` returns early on its own
 * `_isDestroyed` flag, and the delegation in `restoreTerminal` is only correct because it does.
 */
function fakeRenderer(): { renderer: CliRenderer; destroyed: () => number } {
  let destroyed = 0
  let isDestroyed = false
  const destroy = (): void => {
    if (isDestroyed) return
    isDestroyed = true
    destroyed += 1
  }
  return { renderer: { destroy } as unknown as CliRenderer, destroyed: () => destroyed }
}

afterEach(() => {
  adoptRenderer(null)
})

describe("restoreTerminal", () => {
  test("it tears the renderer down and exits with the code it was given", () => {
    const fake = fakeRenderer()
    adoptRenderer(fake.renderer)
    const realExit = process.exit
    let code: number | undefined
    process.exit = ((value: number) => {
      code = value
      return undefined as never
    }) as typeof process.exit
    try {
      restoreTerminal(3)
    } finally {
      process.exit = realExit
    }
    expect(code).toBe(3)
    expect(fake.destroyed()).toBe(1)
  })

  test("a second call does not tear the renderer down twice", () => {
    // Two signals in a row is the real sequence, and a double teardown is what leaves a terminal half
    // restored while the process is already leaving. The idempotence belongs to the renderer, which
    // checks its own flag, so this asserts the delegation rather than a guard of our own.
    const fake = fakeRenderer()
    adoptRenderer(fake.renderer)
    const realExit = process.exit
    process.exit = (() => undefined) as typeof process.exit
    try {
      restoreTerminal(0)
      restoreTerminal(0)
    } finally {
      process.exit = realExit
    }
    expect(fake.destroyed()).toBe(1)
  })

  test("a renderer that throws on destroy still lets the process exit", () => {
    // A renderer that already died is the case, and an exit path that catches must not swallow it.
    const hostile = { destroy: () => expect().toThrow() } as unknown as CliRenderer
    adoptRenderer(hostile)
    const realExit = process.exit
    let code: number | undefined
    process.exit = ((value: number) => {
      code = value
      return undefined as never
    }) as typeof process.exit
    try {
      restoreTerminal(1)
    } finally {
      process.exit = realExit
    }
    expect(code).toBe(1)
  })

  test("no renderer is not a failure, because the non-tty path exits before one exists", () => {
    adoptRenderer(null)
    const realExit = process.exit
    let code: number | undefined
    process.exit = ((value: number) => {
      code = value
      return undefined as never
    }) as typeof process.exit
    try {
      restoreTerminal(1)
    } finally {
      process.exit = realExit
    }
    expect(code).toBe(1)
  })
})

describe("installExitTraps", () => {
  test("an uncaught exception is reported on stderr and ends the process", () => {
    const written: string[] = []
    const realWrite = process.stderr.write.bind(process.stderr)
    const realExit = process.exit
    let code: number | undefined
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    process.exit = ((value: number) => {
      code = value
      return undefined as never
    }) as typeof process.exit
    try {
      installExitTraps()
      process.emit("uncaughtException", new Error("the crash"))
    } finally {
      process.stderr.write = realWrite
      process.exit = realExit
    }
    const out = written.join("")
    // The stack is on stderr, not into the terminal that is about to be restored.
    expect(out).toContain("crashed")
    expect(out).toContain("the crash")
    expect(code).toBe(1)
  })

  test("an unhandled rejection is treated the same way", () => {
    const written: string[] = []
    const realWrite = process.stderr.write.bind(process.stderr)
    const realExit = process.exit
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    process.exit = (() => undefined) as typeof process.exit
    try {
      installExitTraps()
      process.emit("unhandledRejection", "the reason")
    } finally {
      process.stderr.write = realWrite
      process.exit = realExit
    }
    expect(written.join("")).toContain("unhandled rejection")
  })
})
