import type { KeyEvent } from "@opentui/core"

/**
 * A keypress reduced to a stable name: `escape`, `return`, `up`, `a`, `ctrl+c`, `alt+left`.
 */
export type KeyToken = string

/**
 * Legacy terminals deliver ctrl+c as ESC+ETX, which the key parser reports as both ctrl and meta.
 * Normalising that here keeps `ctrl+c` working on every terminal.
 */
export function keyToken(event: KeyEvent): KeyToken {
  const name = event.name
  if (name.length === 0) return ""
  if (event.ctrl && event.meta) return `ctrl+${name}`
  if (event.ctrl) return `ctrl+${name}`
  if (event.meta) return `meta+${name}`
  if (event.option) return `alt+${name}`
  return name
}

/** True for keys a focused text editor consumes itself, so the responder chain must not steal them. */
export function isTextEntryKey(token: KeyToken): boolean {
  return token.length === 1 || token === "space"
}
