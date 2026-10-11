import type { KeyEvent } from "@opentui/core"
import type { ToolConfirmation, ToolDecision } from "../../core/chat/types.js"
import { keyToken } from "../../core/keys.js"
import type { Theme } from "../../styles/theme.js"
import { DialogBackdrop } from "./DialogBackdrop.js"

export interface ConfirmToolDialogProps {
  theme: Theme
  confirmation: ToolConfirmation
  /** Decided for the caller, so the dialog owns no state of its own. */
  onDecide: (decision: ToolDecision) => void
}

/**
 * The prompt in front of a call that changes the machine.
 *
 * Three single letters rather than a list with arrow keys, because the question has exactly three
 * answers and a cursor that has to be moved to reach one of them is a cursor standing between the user
 * and a decision they have already made.
 *
 * The letters arrive through the input's own `onKeyDown` rather than through a responder layer, which
 * is the same reason the mention picker is built that way: `isTextEntryKey` drops every single
 * character before the chain sees it, so a layer would never hear `y` at all. `escape` is the one
 * exception, because it is a control key, and the shell routes it here from its own fallback.
 */
export function ConfirmToolDialog({ theme, confirmation, onDecide }: ConfirmToolDialogProps) {
  const call = confirmation.call

  const handleKey = (event: KeyEvent): void => {
    const letter = keyToken(event)
    const decision: ToolDecision | null =
      letter === "y" ? "once" : letter === "a" ? "always" : letter === "n" || letter === "escape" ? "deny" : null
    if (decision === null) return
    // Taken here so the letter never reaches the composer underneath, and because the input is the
    // only focused thing while the prompt is up.
    event.preventDefault()
    onDecide(decision)
  }

  return (
    <DialogBackdrop theme={theme} title="run this tool?" width={72}>
      <box flexDirection="column" marginBottom={1}>
        <text fg={theme.fg}>{call.toolName}</text>
        <text fg={theme.dim}>{JSON.stringify(call.input)}</text>
        <text fg={theme.warning}>this changes files or runs a command</text>
      </box>
      <box borderStyle="rounded" borderColor={theme.border} flexDirection="row" alignItems="center" gap={1} marginBottom={1}>
        <text fg={theme.accent}>{">"}</text>
        <box flexGrow={1}>
          {/* Focused so the letters are delivered to this handler, and focused only while the prompt
              is up, because the composer remounts behind it. */}
          <input value="" placeholder="y, a, or n" focused onKeyDown={handleKey} />
        </box>
      </box>
      <text fg={theme.dim}>{"y allow once \u00b7 a always allow this session \u00b7 n deny \u00b7 esc deny"}</text>
    </DialogBackdrop>
  )
}
