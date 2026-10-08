import type { ReactNode } from "react"
import type { Theme } from "../../styles/theme.js"

export interface DialogBackdropProps {
  theme: Theme
  title?: string
  width?: number
  children: ReactNode
}

/**
 * The opaque layer every modal sits on. It exists so no dialog paints its own screen dimming, and it
 * stays below the toast layer (zIndex 50) so shell feedback always reads through a modal.
 */
export function DialogBackdrop({ theme, title, width = 56, children }: DialogBackdropProps) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
      backgroundColor={theme.panel}
      zIndex={40}
    >
      <box borderStyle="rounded" borderColor={theme.borderFocused} width={width} flexDirection="column" paddingX={1}>
        {title ? (
          <text fg={theme.accentAlt}>
            <strong>{title}</strong>
          </text>
        ) : null}
        {children}
      </box>
    </box>
  )
}
