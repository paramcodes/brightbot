import type { CursorChangeEvent, InputRenderable, KeyEvent } from "@opentui/core"
import type { Ref } from "react"
import type { Theme } from "../../styles/theme.js"

export interface InputBarProps {
  theme: Theme
  value: string
  focused: boolean
  placeholder?: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  /** The mention picker's keys. Presentational only: the picker itself lives outside this component. */
  onKeyDown?: (event: KeyEvent) => void
  /** The caret's column, so a host can derive what the caret is inside. A ref cannot report a move. */
  onCursorChange?: (column: number) => void
  /** The renderable itself, for the screen coordinates the picker is positioned from. */
  inputRef?: Ref<InputRenderable>
}

/**
 * The composer. Printable characters land in the focused OpenTUI input; control keys travel the
 * responder chain, so this component never intercepts a key the chain needs.
 */
export function InputBar({ theme, value, focused, placeholder, onChange, onSubmit, onKeyDown, onCursorChange, inputRef }: InputBarProps) {
  return (
    <box
      borderStyle="rounded"
      borderColor={focused ? theme.borderFocused : theme.border}
      flexDirection="row"
      alignItems="center"
      gap={1}
      width="100%"
      paddingX={1}
    >
      <text fg={theme.accent}>{">"}</text>
      <box flexGrow={1}>
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder ?? "ask nightcode to do something"}
          focused={focused}
          onInput={onChange}
          onChange={onChange}
          onSubmit={(next) => {
            const text = typeof next === "string" ? next : String(next)
            if (text.trim().length > 0) onSubmit(text.trim())
          }}
          onKeyDown={onKeyDown}
          onCursorChange={(event: CursorChangeEvent) => onCursorChange?.(event.visualColumn)}
        />
      </box>
    </box>
  )
}
