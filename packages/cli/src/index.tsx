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
 */
if (process.argv[2] === "login") {
  process.exitCode = await loginCommand()
} else {
  const renderer = await createAppRenderer()
  createRoot(renderer).render(<App />)
}
