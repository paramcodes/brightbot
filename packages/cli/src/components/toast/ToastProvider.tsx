import { useCallback, useEffect, useRef, useState } from "react"
import { defaultTheme, type Theme } from "../../styles/theme.js"
import { ToastItem } from "./ToastItem.js"
import { DEFAULT_TOAST_DURATION_MS, type Toast, type ToastApi, ToastContext } from "./useToast.js"

let nextId = 1

/**
 * Non-blocking feedback channel. Toasts float above the UI and dismiss themselves; the theme is
 * injected so the provider stays the single owner of both the queue and its presentation.
 */
export function ToastProvider({ children, theme = defaultTheme }: { children: React.ReactNode; theme?: Theme }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback<ToastApi["push"]>(
    (input) => {
      const id = nextId
      nextId += 1
      const toast: Toast = { id, durationMs: DEFAULT_TOAST_DURATION_MS, ...input }
      setToasts((current) => [...current.slice(-3), toast])
      if (toast.durationMs > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), toast.durationMs),
        )
      }
      return id
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const api: ToastApi = { push, dismiss, toasts }

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 ? (
        <box position="absolute" top={2} right={2} flexDirection="column" gap={0} zIndex={50}>
          {toasts.map((toast) => (
            <ToastItem key={toast.id} theme={theme} toast={toast} />
          ))}
        </box>
      ) : null}
    </ToastContext.Provider>
  )
}
