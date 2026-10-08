/** Night Code palette. The dark default; Phase 2 makes this switchable and persistent. */
export interface Theme {
  name: string
  fg: string
  muted: string
  dim: string
  accent: string
  accentAlt: string
  border: string
  borderFocused: string
  success: string
  warning: string
  error: string
  info: string
  panel: string
}

export const dracula: Theme = {
  name: "dracula",
  fg: "#f8f8f2",
  muted: "#cdcbd0",
  dim: "#6272a4",
  accent: "#8be9fd",
  accentAlt: "#bd93f9",
  border: "#6272a4",
  borderFocused: "#8be9fd",
  success: "#50fa7b",
  warning: "#f1fa8c",
  error: "#ff5555",
  info: "#8be9fd",
  panel: "#282a36",
}

export const defaultTheme: Theme = dracula

export const TOAST_COLORS = {
  success: dracula.success,
  error: dracula.error,
  warning: dracula.warning,
  info: dracula.info,
} as const
