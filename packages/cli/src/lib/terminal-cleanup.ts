import type { CliRenderer } from "@opentui/core"

/**
 * The one renderer the traps can tear down, set when the app boots.
 *
 * A module-scoped slot rather than a parameter, because a trap is registered before the renderer
 * exists and fires after it might not. `null` is the normal state on the non-tty path, which exits
 * before a renderer is ever created.
 */
let live: CliRenderer | null = null

/** Hands the traps the renderer they should end. Called once, beside the `createRoot` call. */
export function adoptRenderer(renderer: CliRenderer | null): void {
  live = renderer
}

/**
 * Ends the process with the terminal put back.
 *
 * The teardown delegates to the renderer's own `destroy()`, which restores the alternate screen, cursor
 * visibility, every mouse tracking mode, bracketed paste, and raw mode. Writing those escape sequences
 * here instead would make this file and OpenTUI two writers of the same terminal state, and two writers
 * of the same state is a bug rather than a belt.
 *
 * There is no "already ended" guard of its own. `destroy()` is idempotent by its own check, and
 * `process.exit` never returns, so a second call is not a sequence the real process produces. A guard
 * here would only ever fire against a stubbed exit, which is a test concern rather than a program one.
 *
 * Safe before a renderer exists and after it dies: `destroy()` is idempotent and a missing renderer is
 * simply nothing to restore.
 */
export function restoreTerminal(code: number): void {
  try {
    live?.destroy()
  } catch {
    // A renderer that already died still leaves the process to exit.
  }
  process.exit(code)
}

/**
 * Traps the paths that leave a dead terminal on screen.
 *
 * Signals are deliberately absent, and that is a measured decision rather than an omission. OpenTUI
 * already traps `SIGINT SIGTERM SIGQUIT SIGABRT SIGHUP SIGPIPE SIGBREAK SIGBUS`, and its handler
 * restores the terminal and lets the event loop drain. Both cases were driven against the real binary
 * in a pty: a healthy app sent `SIGTERM` exits `code=0`, and so does one sent `SIGTERM` four seconds
 * into a streaming turn, when a fetch is in flight. A second handler for them here would be a second
 * writer of teardown state for no gain.
 *
 * An error is the case that does not recover on its own. Measured: an uncaught exception is printed
 * into the TUI's own console panel, the terminal stays in the alternate screen, and the process runs
 * until something kills it. That is a CLI the user has to interrupt with a signal they did not plan
 * to send, which is what these two handlers are for.
 */
export function installExitTraps(): void {
  // The reason goes to stderr before the teardown, because the alternative is a stack trace written
  // into a terminal that is about to be restored, where nobody can read it. Stdout is never touched,
  // because CI asserts it is byte-empty on the non-tty path.
  const report = (kind: string, reason: unknown): void => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    process.stderr.write(`nightcode ${kind}\n${detail}\n`)
    restoreTerminal(1)
  }

  process.on("uncaughtException", (error) => report("crashed", error))
  process.on("unhandledRejection", (reason) => report("had an unhandled rejection", reason))
}
