import type { ChatMessage } from "../../core/chat/types.js"
import type { Theme } from "../../styles/theme.js"
import { BotMessage } from "./BotMessage.js"
import { UserMessage } from "./UserMessage.js"

export interface MessageListProps {
  theme: Theme
  messages: readonly ChatMessage[]
}

/** A pure projection of the transcript. It owns no scrolling, no keys, and no state of its own. */
export function MessageList({ theme, messages }: MessageListProps) {
  return (
    <box flexDirection="column" width="100%">
      {messages.map((message) =>
        message.role === "user" ? (
          <UserMessage key={message.id} theme={theme} message={message} />
        ) : (
          <BotMessage key={message.id} theme={theme} message={message} />
        ),
      )}
    </box>
  )
}
