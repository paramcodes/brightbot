import type { Theme } from "./theme.js"

export const BORDER_STYLES = ["single", "double", "round", "bold", "row", "column"] as const
export type BorderStyleName = (typeof BORDER_STYLES)[number]

/** Every bordered surface in the CLI draws from one place, so a resize or a theme change is uniform. */
export interface PanelOptions {
  title?: string
  borderColor?: string
  focused?: boolean
  flexDirection?: "row" | "column"
  flexGrow?: number
  width?: number | "auto" | `${number}%`
  height?: number | "auto" | `${number}%`
  padding?: number
  paddingX?: number
  paddingY?: number
  gap?: number
}

export function panelProps(theme: Theme, options: PanelOptions) {
  return {
    borderStyle: "rounded" as const,
    borderColor: options.focused ? theme.borderFocused : (options.borderColor ?? theme.border),
    title: options.title,
    flexDirection: options.flexDirection ?? "column",
    flexGrow: options.flexGrow,
    width: options.width ?? "100%",
    height: options.height ?? "auto",
    padding: options.padding ?? 0,
    paddingX: options.paddingX,
    paddingY: options.paddingY,
    gap: options.gap,
  }
}

export const HINT_BAR_HEIGHT = 3
export const HEADER_HEIGHT = 3
