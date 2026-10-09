import type { CliRenderer } from "@opentui/core"
import type { ReactNode } from "react"
import { RootLayout } from "./components/layout/RootLayout.js"
import { ToastProvider } from "./components/toast/ToastProvider.js"
import { ThemeProvider, useTheme } from "./context/ThemeContext.js"
import type { ChatTransport } from "./core/chat/transport.js"
import { ResponderProvider } from "./core/responder/useResponder.js"
import { httpChatTransport } from "./lib/api-client.js"
import { MemoryRouterProvider } from "./router/routes.js"

export interface AppProps {
  onExit?: (renderer: CliRenderer) => void
  /** The chat boundary. Injectable so a test drives the shell without a server, exactly as `onExit` is. */
  chatTransport?: ChatTransport
  /** Overlay layers (modals, dialogs) render inside the providers so they share the chain. */
  children?: ReactNode
}

/** Theme, route, keyboard chain, toasts: the four things every screen below depends on. */
export function App({ onExit, chatTransport = httpChatTransport, children }: AppProps = {}) {
  return (
    <ThemeProvider>
      <MemoryRouterProvider>
        <ResponderProvider>
          <ThemedShell onExit={onExit} chatTransport={chatTransport} />
          {children}
        </ResponderProvider>
      </MemoryRouterProvider>
    </ThemeProvider>
  )
}

interface ShellProps {
  onExit?: (renderer: CliRenderer) => void
  chatTransport: ChatTransport
}

/** The toasts paint from the active theme, so they read it below the provider rather than importing it. */
function ThemedShell({ onExit, chatTransport }: ShellProps) {
  const { theme } = useTheme()
  return (
    <ToastProvider theme={theme}>
      <RootLayout onExit={onExit} chatTransport={chatTransport} />
    </ToastProvider>
  )
}
