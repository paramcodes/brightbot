import { useMemo } from "react"
import type { ChatMessage } from "../../core/chat/types.js"
import type { Theme } from "../../styles/theme.js"
import { syntaxStyle } from "./markdown-style.js"
import { Spinner } from "./Spinner.js"
import { ThinkingBlock } from "./ThinkingBlock.js"

export interface BotMessageProps {
  theme: Theme
  message: ChatMessage
}

/**
 * How a turn ended, as one sentence each. This is the only place a status becomes prose, so the
 * colors stay decoration rather than something the reader has to decode.
 *
 * A failed turn falls back to a generic sentence when the caller recorded no error text, because a
 * failure with no line under it would look like a rendering bug.
 */
function statusLine(theme: Theme, message: ChatMessage): { text: string; color: string } | null {
  if (message.status === "interrupted") return { text: "Interrupted before the answer finished.", color: theme.warning }
  if (message.status === "failed") return { text: message.error ?? "The turn failed.", color: theme.error }
  return null
}

/**
 * One assistant turn: the label, the reasoning, the body, and how it ended.
 *
 * The body goes through OpenTUI's markdown renderable with `streaming` set while the turn is live, so
 * the trailing block stays unstable until the generation finalizes.
 */
export function BotMessage({ theme, message }: BotMessageProps) {
  const style = useMemo(() => syntaxStyle(theme), [theme])
  const streaming = message.status === "streaming"
  const status = statusLine(theme, message)

  return (
    <box flexDirection="column" borderStyle="rounded" borderColor={theme.border} paddingX={1} marginBottom={1}>
      <text fg={theme.accentAlt}>nightcode</text>
      {message.reasoning.length > 0 ? <ThinkingBlock theme={theme} reasoning={message.reasoning} live={streaming} /> : null}
      {message.content.length > 0 ? (
        <markdown content={message.content} syntaxStyle={style} fg={theme.fg} streaming={streaming} />
      ) : streaming ? (
        <Spinner theme={theme} label="thinking" />
      ) : null}
      {status ? <text fg={status.color}>{status.text}</text> : null}
    </box>
  )
}
