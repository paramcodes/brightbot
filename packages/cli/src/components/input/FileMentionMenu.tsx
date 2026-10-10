import type { Theme } from "../../styles/theme.js"

export interface FileMentionMenuProps {
  theme: Theme
  /** Already ranked and capped, so the menu draws exactly what it is given. */
  paths: readonly string[]
  /** The text between the `@` and the caret, called out in each row. */
  query: string
  /** The highlighted row. */
  selectedIndex: number
  /** The composer's own screen coordinates plus the caret column, so the panel sits at the caret. */
  anchor: { x: number; y: number; column: number }
}

interface Segment {
  text: string
  match: boolean
  /** Where the segment starts in the path, which is the only stable key it has. */
  at: number
}

function segments(path: string, query: string): Segment[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [{ text: path, match: false, at: 0 }]
  const at = path.toLowerCase().indexOf(needle)
  if (at < 0) return [{ text: path, match: false, at: 0 }]
  return [
    { text: path.slice(0, at), match: false, at: 0 },
    { text: path.slice(at, at + needle.length), match: true, at },
    { text: path.slice(at + needle.length), match: false, at: at + needle.length },
  ].filter((segment) => segment.text.length > 0)
}

/**
 * The `@` picker, drawn as a floating panel beside the composer.
 *
 * It is deliberately not a `DialogSearchList`. That component owns `return` and `escape` through a
 * responder layer, and a layer returning `true` does not stop the focused composer from acting on the
 * same key, so its `return` would submit the prompt and its arrows would move the caret. This
 * component owns no keyboard logic and no state: the host takes the four keys on the composer's own
 * `onKeyDown`, where a `preventDefault` really does stop the buffer edit.
 */
export function FileMentionMenu({ theme, paths, query, selectedIndex, anchor }: FileMentionMenuProps) {
  const rows = paths.length + 2
  // Above the composer, because the composer sits over the body and the body is what the user reads.
  const top = Math.max(0, anchor.y - rows)
  const left = Math.max(0, anchor.x + anchor.column - 4)
  return (
    <box
      position="absolute"
      top={top}
      left={left}
      zIndex={45}
      borderStyle="rounded"
      borderColor={theme.borderFocused}
      backgroundColor={theme.panel}
      flexDirection="column"
      paddingX={1}
    >
      {paths.length === 0 ? <text fg={theme.warning}>no match</text> : null}
      {paths.map((path, index) => {
        const selected = index === selectedIndex
        return (
          <text key={path} fg={selected ? theme.panel : theme.fg} bg={selected ? theme.accent : undefined}>
            {selected ? ">" : " "}{" "}
            {segments(path, query).map((segment) => (
              <span
                key={segment.at}
                fg={segment.match ? theme.accentAlt : selected ? theme.panel : theme.fg}
                bg={selected ? theme.accent : undefined}
              >
                {segment.text}
              </span>
            ))}
          </text>
        )
      })}
    </box>
  )
}
