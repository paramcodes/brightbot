import { useKeyboard } from "@opentui/react"
import { isTextEntryKey, keyToken } from "../keys.js"
import { useResponderActions } from "./ResponderContext.js"

/**
 * The single keyboard entry point for the whole CLI. Printable keys are dropped before the chain sees
 * them, so a focused text editor can never trigger a shortcut. Control keys walk the responder chain,
 * and `onUnhandled` receives whatever no layer consumed.
 */
export function useRootKeys(onUnhandled: (token: string) => void) {
  const { dispatch } = useResponderActions()
  return useKeyboard((event) => {
    const token = keyToken(event)
    if (isTextEntryKey(token)) return
    if (dispatch({ token, event })) return
    onUnhandled(token)
  })
}
