import type { ChatMessage } from "../../core/chat/types.js"
import type { Theme } from "../../styles/theme.js"

export interface UserMessageProps {
  theme: Theme
  message: ChatMessage
}

/**
 * The prompt the user typed, as plain text.
 *
 * It never goes through the markdown renderable, because a leading `>` would become a blockquote and
 * a pasted shell command would lose its first character. The `you` label and the `> ` prefix are
 * load-bearing: the composer and the session read as one conversation because of them.
 */
export function UserMessage({ theme, message }: UserMessageProps) {
  return (
    <box flexDirection="column" marginBottom={1}>
      <text fg={theme.accent}>you</text>
      <text fg={theme.fg}>{`> ${message.content}`}</text>
    </box>
  )
}
