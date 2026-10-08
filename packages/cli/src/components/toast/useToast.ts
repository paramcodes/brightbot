import { createContext, useContext } from "react"

export type ToastKind = "success" | "error" | "warning" | "info"

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  durationMs: number
}

export interface ToastApi {
  push: (toast: Omit<Toast, "id" | "durationMs"> & { durationMs?: number }) => number
  dismiss: (id: number) => void
  toasts: readonly Toast[]
}

export const DEFAULT_TOAST_DURATION_MS = 4000

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error("useToast must be used inside ToastProvider")
  return api
}
