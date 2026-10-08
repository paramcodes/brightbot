import type { KeyEvent } from "@opentui/core"
import type { KeyToken } from "../keys.js"

export interface KeyInput {
  token: KeyToken
  event: KeyEvent
}

/**
 * One keyboard layer. Returning `true` from `handleKey` consumes the key: no lower layer sees it.
 * Control keys only. Printable characters belong to the focused text editor, so the chain never
 * receives them and typing in an input can never trigger a shortcut.
 */
export interface Responder {
  id: string
  handleKey: (input: KeyInput) => boolean
}

export interface ResponderActions {
  register: (responder: Responder) => void
  unregister: (id: string) => void
  /** Walks the stack top-down and returns true as soon as a layer consumes the key. */
  dispatch: (input: KeyInput) => boolean
}
