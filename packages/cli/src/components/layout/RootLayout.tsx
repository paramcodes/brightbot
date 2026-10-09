import { cwd } from "node:process"
import type { CliRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useRef, useState } from "react"
import { useTheme } from "../../context/ThemeContext.js"
import type { ChatTransport } from "../../core/chat/transport.js"
import { exitCleanly } from "../../core/renderer.js"
import { useRootKeys } from "../../core/responder/useResponder.js"
import { type ChatSession, useChatSession } from "../../hooks/useChatSession.js"
import { DEFAULT_PREFERENCES } from "../../lib/config.js"
import { ROUTES, RouteView, useRouter } from "../../router/routes.js"
import { HomeView } from "../../views/HomeView.js"
import { SessionView } from "../../views/SessionView.js"
import { CommandMenu } from "../command-menu/CommandMenu.js"
import type { Command } from "../command-menu/commands.js"
import { InputBar } from "../input/InputBar.js"
import { useToast } from "../toast/useToast.js"
import { Header } from "./Header.js"

export interface RootLayoutProps {
  onExit?: (renderer: CliRenderer) => void
  chatTransport: ChatTransport
}

/** The one word the header shows for the whole conversation. Pure, so a test reads it without a terminal. */
export function headerStatus(chat: Pick<ChatSession, "generating" | "messages">): string {
  if (chat.generating) return "streaming"
  return chat.messages.length > 0 ? "sent" : "idle"
}

/** Header, the routed body, the composer, the hint row, and the `/` palette. */
export function RootLayout({ onExit, chatTransport }: RootLayoutProps) {
  const renderer = useRenderer()
  const { theme } = useTheme()
  const { path, navigate } = useRouter()
  const { push } = useToast()
  const [composer, setComposer] = useState("")
  const composerRef = useRef("")
  const [filter, setFilter] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode] = useState(DEFAULT_PREFERENCES.mode)
  const chat = useChatSession(chatTransport)

  useRootKeys((token) => {
    if (token === "ctrl+c") (onExit ?? exitCleanly)(renderer)
    if (token !== "escape") return
    // The unhandled fallback rather than a responder layer: a layer registered while a turn streams
    // sits above the command palette's, so Escape would kill the turn instead of closing the menu.
    if (chat.generating) {
      chat.abort()
      return
    }
    push({ kind: "info", message: "No generation to interrupt" })
  })

  const changeComposer = (value: string) => {
    // The palette triggers on the composer value, and two keystrokes can land in one React batch, so
    // the "was the composer empty" check reads a ref rather than the value this render closed over.
    const typedIntoAnEmptyComposer = composerRef.current.length === 0
    const opening = typedIntoAnEmptyComposer && value.startsWith("/")
    composerRef.current = opening ? "" : value
    setComposer(composerRef.current)
    if (opening) {
      // Anything typed into the composer in the same batch is the palette's filter.
      setFilter(value.slice(1))
      setMenuOpen(true)
    }
  }

  const closeMenu = () => {
    setMenuOpen(false)
    setFilter("")
  }

  const submit = (prompt: string) => {
    const outcome = chat.submit(prompt)
    if (!outcome.accepted) {
      push({ kind: "warning", message: outcome.reason })
      return
    }
    composerRef.current = ""
    setComposer("")
    if (path === ROUTES.home) navigate(ROUTES.session)
  }

  const runCommand = (command: Command) => {
    closeMenu()
    if (command.id === "clear") {
      chat.reset()
      composerRef.current = ""
      setComposer("")
      if (path === ROUTES.session) navigate(ROUTES.home)
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
      <Header theme={theme} cwd={cwd()} mode={mode} model={DEFAULT_PREFERENCES.model} status={headerStatus(chat)} width={renderer.width} />
      <box flexGrow={1}>
        <RouteView home={<HomeView theme={theme} />} session={<SessionView theme={theme} messages={chat.messages} />} />
      </box>
      {/*
        The slash that opens the palette is consumed, so the composer must be emptied with it. React
        diffs the `value` prop against the parent's last render, which never held the "/" the host
        input inserted itself, so no prop change is ever emitted and the text would survive. A keyed
        remount is the only thing that resets it.
      */}
      <InputBar
        key={menuOpen ? "composer-behind-palette" : "composer"}
        theme={theme}
        value={composer}
        focused={!menuOpen}
        onChange={changeComposer}
        onSubmit={submit}
      />
      <box height={1} paddingX={1}>
        <text fg={theme.dim}>tab switch mode · / commands · @ mention a file · esc interrupt · ctrl+c quit</text>
      </box>
      {menuOpen ? <CommandMenu theme={theme} filter={filter} onFilter={setFilter} onRun={runCommand} onClose={closeMenu} /> : null}
    </box>
  )
}
