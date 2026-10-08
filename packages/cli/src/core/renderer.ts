import { type CliRenderer, createCliRenderer } from "@opentui/core"

/**
 * A terminal UI needs a TTY: raw mode and cursor addressing are meaningless on a pipe. Fail loudly
 * with the fix instead of rendering escape codes into a log file.
 */
export function assertInteractiveTerminal(): void {
  if (!process.stdout.isTTY) {
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
