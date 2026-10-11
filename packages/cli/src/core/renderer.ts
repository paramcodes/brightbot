import { type CliRenderer, createCliRenderer } from "@opentui/core"

/**
 * A terminal UI needs a TTY on both streams, and the two are checked for different reasons.
 *
 * Stdout carries the escape sequences, so a pipe there writes a log file instead of a screen. Stdin
 * is where the keys come from, and raw mode cannot be set on something that is not a terminal, so a
 * non-TTY stdin leaves the app rendering a screen it can never read a keypress for. Measured: with
 * stdout as a pty and stdin from `/dev/null`, the banner draws and the process then hangs forever.
 *
 * One message and one exit code, because a caller who got this wrong needs one thing to fix rather
 * than a guess about which half of the terminal failed.
 */
export function assertInteractiveTerminal(): void {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write("nightcode needs an interactive terminal. Run it directly, not through a pipe.\n")
    process.exit(1)
  }
}

export async function createAppRenderer(): Promise<CliRenderer> {
  assertInteractiveTerminal()
  return createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true })
}

/** Ends the process with the terminal restored. */
export function exitCleanly(renderer: CliRenderer, code = 0): void {
  try {
    renderer.destroy()
  } catch {
    // A renderer that already died still leaves the process to exit.
  }
  process.exit(code)
}
