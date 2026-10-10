#!/usr/bin/env bun
import { createRoot } from "@opentui/react"
import { App } from "./app.js"
import { loginCommand } from "./commands/login.js"
import { createAppRenderer } from "./core/renderer.js"

/**
 * `nightcode login` is a command, not a mode, and it never starts the terminal.
 *
 * A login is a browser round trip with a printed URL, so it belongs to the shell the user already has.
 * Rendering a TUI to show "signed in" would be a surface that starts, does nothing, and exits.
 *
 * `--url` prints the authorize URL and leaves the opening to the user, which is the one flag a machine
 * with no browser, a demo recording, or a verification drive actually needs.
 */
const [command, ...rest] = process.argv.slice(2)
if (command === "login") {
  process.exitCode = await loginCommand({ printUrl: rest.includes("--url") })
} else {
  const renderer = await createAppRenderer()
  createRoot(renderer).render(<App />)
}
