import { BRAND } from "@nightcode/shared"
import { useTerminalDimensions } from "@opentui/react"
import type { Theme } from "../../styles/theme.js"

/** The ASCII wordmark needs the columns; narrow terminals get the text brand instead. */
export function Banner({ theme }: { theme: Theme }) {
  const { width } = useTerminalDimensions()
  const wide = width >= 56

  return (
    <box flexDirection="column" alignItems="center" width="100%">
      {wide ? (
        <box flexDirection="column" alignItems="center">
          <ascii-font text="NIGHT" font="block" color={theme.accent} />
          <ascii-font text="CODE" font="block" color={theme.accentAlt} />
        </box>
      ) : (
        <box flexDirection="row" gap={1}>
          <text fg={theme.accent}>
            <strong>{BRAND.name}</strong>
          </text>
          <text fg={theme.dim}>v{BRAND.version}</text>
        </box>
      )}
      <text fg={theme.muted}>{BRAND.tagline}</text>
      <text fg={theme.dim}>press / for commands · esc interrupts · ctrl+c quits</text>
    </box>
  )
}
