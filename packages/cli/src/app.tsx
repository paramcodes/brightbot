import { cwd } from "node:process"
import type { CliRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useState } from "react"
import { InputBar } from "./components/input/InputBar.js"
import { Banner } from "./components/layout/Banner.js"
import { Header } from "./components/layout/Header.js"
import { ToastProvider } from "./components/toast/ToastProvider.js"
import { useToast } from "./components/toast/useToast.js"
import { ThemeProvider, useTheme } from "./context/ThemeContext.js"
import { exitCleanly } from "./core/renderer.js"
import { ResponderProvider, useRootKeys } from "./core/responder/useResponder.js"
import { DEFAULT_PREFERENCES } from "./lib/config.js"

export interface AppProps {
  onExit?: (renderer: CliRenderer) => void
  /** Overlay layers (modals, dialogs) render inside the providers so they share the chain. */
  children?: React.ReactNode
}

export function App({ onExit, children }: AppProps = {}) {
  return (
    <ThemeProvider>
      <ResponderProvider>
        <ThemedShell onExit={onExit} />
        {children}
      </ResponderProvider>
    </ThemeProvider>
  )
}

/** The toasts paint from the active theme, so they read it below the provider rather than importing it. */
function ThemedShell({ onExit }: AppProps) {
  const { theme } = useTheme()
  return (
    <ToastProvider theme={theme}>
      <AppShell onExit={onExit} />
    </ToastProvider>
  )
}

/** The shell: header, brand, composer, and the one root keyboard listener for the whole app. */
function AppShell({ onExit }: AppProps) {
  const renderer = useRenderer()
  const { theme } = useTheme()
  const { push } = useToast()
  const [draft, setDraft] = useState("")
  const [status, setStatus] = useState("idle")

  useRootKeys((token) => {
    if (token === "ctrl+c") (onExit ?? exitCleanly)(renderer)
    if (token === "escape") push({ kind: "info", message: "No generation to interrupt" })
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header theme={theme} cwd={cwd()} mode="plan" model={DEFAULT_PREFERENCES.model} status={status} width={renderer.width} />
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <Banner theme={theme} />
      </box>
      <InputBar
        theme={theme}
        value={draft}
        focused
        onChange={setDraft}
        onSubmit={(value) => {
          setStatus("sent")
          setDraft("")
          push({ kind: "info", message: `Queued: ${value}`, durationMs: 1500 })
        }}
      />
      <box height={1} paddingX={1}>
        <text fg={theme.dim}>tab switch mode · / commands · @ mention a file · esc interrupt · ctrl+c quit</text>
      </box>
    </box>
  )
}
