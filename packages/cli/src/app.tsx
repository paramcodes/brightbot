import type { CliRenderer } from "@opentui/core"
import { RootLayout } from "./components/layout/RootLayout.js"
import { ToastProvider } from "./components/toast/ToastProvider.js"
import { ThemeProvider, useTheme } from "./context/ThemeContext.js"
import { ResponderProvider } from "./core/responder/useResponder.js"
import { MemoryRouterProvider } from "./router/routes.js"

export interface AppProps {
  onExit?: (renderer: CliRenderer) => void
  /** Overlay layers (modals, dialogs) render inside the providers so they share the chain. */
  children?: React.ReactNode
}

/** Theme, route, keyboard chain, toasts: the four things every screen below depends on. */
export function App({ onExit, children }: AppProps = {}) {
  return (
    <ThemeProvider>
      <MemoryRouterProvider>
        <ResponderProvider>
          <ThemedShell onExit={onExit} />
          {children}
        </ResponderProvider>
      </MemoryRouterProvider>
    </ThemeProvider>
  )
}

/** The toasts paint from the active theme, so they read it below the provider rather than importing it. */
function ThemedShell({ onExit }: AppProps) {
  const { theme } = useTheme()
  return (
    <ToastProvider theme={theme}>
      <RootLayout onExit={onExit} />
    </ToastProvider>
  )
}
