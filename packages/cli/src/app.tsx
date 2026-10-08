import { cwd } from "node:process"
import type { CliRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useRef, useState } from "react"
import { CommandMenu } from "./components/command-menu/CommandMenu.js"
import type { Command } from "./components/command-menu/commands.js"
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
  const draftRef = useRef("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [status, setStatus] = useState("idle")

  useRootKeys((token) => {
    if (token === "ctrl+c") (onExit ?? exitCleanly)(renderer)
    if (token === "escape") push({ kind: "info", message: "No generation to interrupt" })
  })

  const changeDraft = (value: string) => {
    // The palette triggers on the composer value, and two keystrokes can land in one React batch, so
    // the "was the composer empty" check reads a ref rather than the value this render closed over.
    const typedIntoAnEmptyComposer = draftRef.current.length === 0
    const opening = typedIntoAnEmptyComposer && value === "/"
    draftRef.current = opening ? "" : value
    setDraft(draftRef.current)
    if (opening) setMenuOpen(true)
  }

  const runCommand = (command: Command) => {
    setMenuOpen(false)
    if (command.id === "clear") {
      changeDraft("")
      setStatus("idle")
      return
    }
    if (command.id === "exit") {
      ;(onExit ?? exitCleanly)(renderer)
      return
    }
    push({ kind: "info", message: `${command.name} is not wired up yet` })
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header theme={theme} cwd={cwd()} mode="plan" model={DEFAULT_PREFERENCES.model} status={status} width={renderer.width} />
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <Banner theme={theme} />
      </box>
      {/*
        The slash that opens the palette is consumed, so the composer must be emptied with it. React
        diffs the `value` prop against the parent's last render, which never held the "/" the host
        input inserted itself, so no prop change is ever emitted and the text survives. A keyed remount
        is the only thing that resets it.
      */}
      <InputBar
        key={menuOpen ? "composer-behind-palette" : "composer"}
        theme={theme}
        value={draft}
        focused={!menuOpen}
        onChange={changeDraft}
        onSubmit={(value) => {
          setStatus("sent")
          setDraft("")
          draftRef.current = ""
          push({ kind: "info", message: `Queued: ${value}`, durationMs: 1500 })
        }}
      />
      <box height={1} paddingX={1}>
        <text fg={theme.dim}>tab switch mode · / commands · @ mention a file · esc interrupt · ctrl+c quit</text>
      </box>
      {menuOpen ? <CommandMenu theme={theme} onRun={runCommand} onClose={() => setMenuOpen(false)} /> : null}
    </box>
  )
}
