import { cwd } from "node:process"
import type { CliRenderer } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/react"
import { useState } from "react"
import { InputBar } from "./components/input/InputBar.js"
import { Banner } from "./components/layout/Banner.js"
import { Header } from "./components/layout/Header.js"
import { ToastProvider } from "./components/toast/ToastProvider.js"
import { useToast } from "./components/toast/useToast.js"
import { isTextEntryKey, keyToken } from "./core/keys.js"
import { exitCleanly } from "./core/renderer.js"
import { ResponderProvider, useResponderActions } from "./core/responder/ResponderContext.js"
import { defaultTheme } from "./styles/theme.js"

const DEFAULT_MODEL = "claude-3-5-sonnet"

export interface AppProps {
  onExit?: (renderer: CliRenderer) => void
  /** Overlay layers (modals, dialogs) render inside the providers so they share the chain. */
  children?: React.ReactNode
}

export function App({ onExit, children }: AppProps = {}) {
  return (
    <ToastProvider>
      <ResponderProvider>
        <AppShell onExit={onExit} />
        {children}
      </ResponderProvider>
    </ToastProvider>
  )
}

/** The shell: header, brand, composer, and the one root keyboard listener for the whole app. */
function AppShell({ onExit }: AppProps) {
  const renderer = useRenderer()
  const theme = defaultTheme
  const { dispatch } = useResponderActions()
  const { push } = useToast()
  const [draft, setDraft] = useState("")
  const [status, setStatus] = useState("idle")
  const [model] = useState(DEFAULT_MODEL)

  useKeyboard((event) => {
    const token = keyToken(event)
    // Printable keys belong to the focused input; the chain only ever sees control keys.
    if (isTextEntryKey(token)) return
    if (dispatch({ token, event })) return
    if (token === "ctrl+c") (onExit ?? exitCleanly)(renderer)
    if (token === "escape") push({ kind: "info", message: "No generation to interrupt" })
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header theme={theme} cwd={cwd()} mode="plan" model={model} status={status} width={renderer.width} />
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
