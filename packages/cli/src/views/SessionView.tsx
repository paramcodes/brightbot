import { MessageList } from "../components/chat/MessageList.js"
import type { ChatMessage } from "../core/chat/types.js"
import type { Theme } from "../styles/theme.js"

export interface SessionViewProps {
  theme: Theme
  messages: readonly ChatMessage[]
}

/**
 * The active session, and nothing else.
 *
 * It takes literals as props and holds no transport, no session, and no keys, which is what keeps its
 * test a render test. `focused` stays `false` on the scroll box because a focused one would put itself
 * on the responder stack and eat the arrow keys the composer needs.
 */
export function SessionView({ theme, messages }: SessionViewProps) {
  return (
    <scrollbox stickyScroll stickyStart="bottom" focused={false} flexGrow={1} width="100%">
      <MessageList theme={theme} messages={messages} />
    </scrollbox>
  )
}
