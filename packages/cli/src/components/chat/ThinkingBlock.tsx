import type { Theme } from "../../styles/theme.js"

export interface ThinkingBlockProps {
  theme: Theme
  reasoning: string
  /** True while the parent turn is still streaming. */
  live: boolean
}

/**
 * The reasoning trace, expanded while the turn is live and collapsed once it ends.
 *
 * Open and closed is derived from `live` rather than held as local state. A toggle would need a key,
 * every printable key belongs to the composer, and the control keys left over are taken or wrong for
 * this, so a control the user cannot press is a lie about what the terminal can do.
 */
export function ThinkingBlock({ theme, reasoning, live }: ThinkingBlockProps) {
  if (live) {
    return (
      <box flexDirection="column" marginBottom={1}>
        <text fg={theme.accentAlt}>thinking</text>
        <text fg={theme.dim}>{reasoning}</text>
      </box>
    )
  }

  const words = reasoning
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length
  return (
    <box flexDirection="column" marginBottom={1}>
      <text fg={theme.dim}>{`thinking · ${words} words`}</text>
    </box>
  )
}
