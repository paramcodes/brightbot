import type { Theme } from "../../styles/theme.js"
import type { Toast, ToastKind } from "./useToast.js"

const ICONS: Record<ToastKind, string> = {
  success: "✓",
  error: "✗",
  warning: "!",
  info: "i",
}

const COLOR: Record<ToastKind, keyof Pick<Theme, "success" | "error" | "warning" | "info">> = {
  success: "success",
  error: "error",
  warning: "warning",
  info: "info",
}

export function ToastItem({ theme, toast }: { theme: Theme; toast: Toast }) {
  const color = theme[COLOR[toast.kind]]
  return (
    <box flexDirection="row" gap={1} borderStyle="rounded" borderColor={color} paddingX={1} backgroundColor={theme.panel}>
      <text fg={color}>{ICONS[toast.kind]}</text>
      <text fg={theme.fg}>{toast.message}</text>
    </box>
  )
}
