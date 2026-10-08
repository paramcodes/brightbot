import type { Theme } from "../../styles/theme.js"

export interface InputBarProps {
  theme: Theme
  value: string
  focused: boolean
  placeholder?: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
}

/**
 * The composer. Printable characters land in the focused OpenTUI input; control keys travel the
 * responder chain, so this component never intercepts a key the chain needs.
 */
export function InputBar({ theme, value, focused, placeholder, onChange, onSubmit }: InputBarProps) {
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
          value={value}
          placeholder={placeholder ?? "ask nightcode to do something"}
          focused={focused}
          onInput={onChange}
          onChange={onChange}
          onSubmit={(next) => {
            const text = typeof next === "string" ? next : String(next)
            if (text.trim().length > 0) onSubmit(text.trim())
          }}
        />
      </box>
    </box>
  )
}
