import { cwd } from "node:process"
import { type Session, systemPrompt } from "@nightcode/shared"
import type { CliRenderer, InputRenderable, KeyEvent } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { currentUser } from "../../auth/identity.js"
import { openTokenStore } from "../../auth/token-storage.js"
import { usePreferences } from "../../context/PreferencesContext.js"
import type { ChatTransport } from "../../core/chat/transport.js"
import { keyToken } from "../../core/keys.js"
import { activeMention, MENTION_LIMIT, type MentionSpan, rankMatches, replaceMention } from "../../core/mention.js"
import { exitCleanly } from "../../core/renderer.js"
import { useRootKeys } from "../../core/responder/useResponder.js"
import { type ChatSession, useChatSession } from "../../hooks/useChatSession.js"
import { useSessionHistory } from "../../hooks/useSessionHistory.js"
import { scanFiles } from "../../lib/file-scanner.js"
import { ROUTES, RouteView, useRouter } from "../../router/routes.js"
import { HomeView } from "../../views/HomeView.js"
import { SessionView } from "../../views/SessionView.js"
import { CommandMenu } from "../command-menu/CommandMenu.js"
import type { Command } from "../command-menu/commands.js"
import { ModelSelectDialog } from "../dialogs/ModelSelectDialog.js"
import { SessionListDialog } from "../dialogs/SessionListDialog.js"
import { FileMentionMenu } from "../input/FileMentionMenu.js"
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
  // Read once per shell rather than per submit: a sign-out in another terminal is a `nightcode login`
  // away, not something a running shell should silently pick up mid-conversation.
  const tokenStore = openTokenStore()
  const { theme, mode, model, setMode, setModel } = usePreferences()
  const { path, navigate } = useRouter()
  const { push } = useToast()
  const [composer, setComposer] = useState("")
  const composerRef = useRef("")
  const [filter, setFilter] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState("")
  const [modelsOpen, setModelsOpen] = useState(false)
  const [sessionFilter, setSessionFilter] = useState("")
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [mentionFiles, setMentionFiles] = useState<readonly string[]>([])
  const [mentionSelected, setMentionSelected] = useState(0)
  const [dismissedMention, setDismissedMention] = useState<MentionSpan | null>(null)
  const [caret, setCaret] = useState(0)
  const inputRef = useRef<InputRenderable | null>(null)
  const pendingCaret = useRef<number | null>(null)
  const chat = useChatSession(chatTransport)
  const history = useSessionHistory(chatTransport)

  const rescanMentionFiles = useCallback(() => {
    void scanFiles(cwd())
      .then(setMentionFiles)
      .catch(() => {
        // A failed scan is the picker's own failure mode, so it lands here rather than at the boundary
        // of the feature: the composer has to stay usable no matter what the tree does.
        setMentionFiles([])
      })
  }, [])

  useEffect(() => {
    rescanMentionFiles()
  }, [rescanMentionFiles])

  const mention = activeMention(composer, caret)
  // A dismissal is keyed to the span it dismissed, so typing reopens the picker while an unchanged
  // span stays closed. That is what keeps `escape` from being a key the user has to press twice.
  const mentionOpen =
    mention !== null && (dismissedMention === null || dismissedMention.start !== mention.start || dismissedMention.query !== mention.query)
  const mentionMatches = mention ? rankMatches(mentionFiles, mention.query, MENTION_LIMIT) : []
  const mentionCursor = Math.min(mentionSelected, Math.max(mentionMatches.length - 1, 0))

  // Re-scanned when the picker opens, because a turn or an editor may have written the file the user
  // is about to mention since the CLI started.
  useEffect(() => {
    if (mentionOpen) rescanMentionFiles()
  }, [mentionOpen, rescanMentionFiles])

  // React pushes the composer's `value` prop after this commit and that setter moves the caret to
  // the end of the new text, so an accepted mention's caret is restored here, after the push.
  useLayoutEffect(() => {
    const target = pendingCaret.current
    if (target === null) return
    pendingCaret.current = null
    const input = inputRef.current
    if (input) input.cursorOffset = target
  })

  const acceptMention = (span: MentionSpan, path: string) => {
    const replaced = replaceMention(composerRef.current, span, path)
    composerRef.current = replaced.value
    setComposer(replaced.value)
    setDismissedMention(null)
    setMentionSelected(0)
    pendingCaret.current = replaced.caret
    setCaret(replaced.caret)
  }

  const toggleMode = () => setMode(mode === "plan" ? "build" : "plan")

  useRootKeys((token) => {
    if (token === "ctrl+c") (onExit ?? exitCleanly)(renderer)
    // While a mention is live the picker owns `escape` and `tab`, and this global listener runs before
    // the composer's own key handler, so a `preventDefault` there cannot stop this one from firing
    // too: the mode would flip on every accepted file.
    if (mentionOpen && (token === "escape" || token === "tab")) return
    if (token === "tab") {
      toggleMode()
      return
    }
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

  const closeModelPicker = () => {
    setModelsOpen(false)
    setModelFilter("")
  }

  const closeSessionPicker = () => {
    setSessionsOpen(false)
    setSessionFilter("")
  }

  /**
   * The picker's keyboard, taken on the composer's own `onKeyDown`.
   *
   * This is the point the `@` mechanism turns on. A responder layer is useless here: it returns
   * `true` and the focused input still acts on the key anyway, which is a measured fact and the
   * reason the picker is not a modal. `onKeyDown` on the renderable runs before the buffer edits, so
   * a `preventDefault` on it really does stop the composer acting on the key.
   */
  const handleComposerKeyDown = (event: KeyEvent) => {
    const span = activeMention(composerRef.current, caret)
    if (!span) return
    const token = keyToken(event)
    if (token === "up" || token === "down") {
      // Always taken, so the caret cannot move out from under the picker while it is open.
      event.preventDefault()
      if (mentionMatches.length === 0) return
      const step = token === "down" ? 1 : -1
      setMentionSelected((index) => Math.min(Math.max(index + step, 0), mentionMatches.length - 1))
      return
    }
    if (token === "escape") {
      event.preventDefault()
      setDismissedMention(span)
      return
    }
    if (token !== "return" && token !== "tab") return
    const path = mentionMatches[mentionCursor]
    // With no row to accept the composer keeps its own submit binding, so the prompt still sends.
    if (!path) return
    event.preventDefault()
    acceptMention(span, path)
  }

  const handleComposerCursor = (visualColumn: number) => {
    setCaret(visualColumn)
    setDismissedMention(null)
  }

  const resumeSession = async (session: Session): Promise<void> => {
    closeSessionPicker()
    try {
      chat.resume(session, await chatTransport.listMessages(session.id))
      navigate(ROUTES.session)
    } catch {
      push({ kind: "error", message: "The transcript could not be read" })
    }
  }

  // Both modals take the printable keys the composer would otherwise eat, so both unfocus it. The
  // keyed remount is what the palette always needed: the slash that opened it was consumed, so the
  // composer's value never changes and React would leave the text in place.
  const modalOpen = menuOpen || modelsOpen || sessionsOpen

  const submit = (prompt: string) => {
    // The model the user picked has to reach the turn, or the picker changes a label and nothing
    // else: the session row is what the server resolves a provider from. The mode's system prompt
    // travels beside it, so the mode the header shows is the mode the model is told it is in. The
    // identity is the CLI's own token when it has one and the local user when it does not, which is
    // what lets `nightcode` answer a prompt with no credentials at all.
    const outcome = chat.submit(prompt, { model, system: systemPrompt(mode), user: currentUser(tokenStore) })
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
    if (command.id === "models") {
      setModelsOpen(true)
      return
    }
    if (command.id === "sessions") {
      // Re-read on open rather than trusting the mount-time list: a session created since the CLI
      // started is exactly the one the user is here to restore.
      history.reload()
      setSessionsOpen(true)
      return
    }
    if (command.id === "agents") {
      // Two values is a switch, not a list, so it goes through the same flip `tab` performs rather
      // than through a dialog that needs a row to move through.
      toggleMode()
      return
    }
    push({ kind: "info", message: `${command.name} is not wired up yet` })
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header theme={theme} cwd={cwd()} mode={mode} model={model} status={headerStatus(chat)} width={renderer.width} />
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
        key={modalOpen ? "composer-behind-modal" : "composer"}
        theme={theme}
        value={composer}
        focused={!modalOpen}
        onChange={changeComposer}
        onSubmit={submit}
        onKeyDown={handleComposerKeyDown}
        onCursorChange={handleComposerCursor}
        inputRef={inputRef}
      />
      {/*
        A sibling of the composer, not a child: it paints outside the composer's box, which needs the
        default `overflow: visible`. Unlike the palette, opening it changes no `key`, so the composer
        keeps focus and keeps every printable key.
      */}
      {mentionOpen && mention ? (
        <FileMentionMenu
          theme={theme}
          paths={mentionMatches}
          query={mention.query}
          selectedIndex={mentionCursor}
          anchor={{
            x: inputRef.current?.screenX ?? 0,
            y: inputRef.current?.screenY ?? 0,
            column: inputRef.current?.visualCursor.visualCol ?? 0,
          }}
        />
      ) : null}
      <box height={1} paddingX={1}>
        <text fg={theme.dim}>tab switch mode · / commands · @ mention a file · esc interrupt · ctrl+c quit</text>
      </box>
      {menuOpen ? <CommandMenu theme={theme} filter={filter} onFilter={setFilter} onRun={runCommand} onClose={closeMenu} /> : null}
      {modelsOpen ? (
        <ModelSelectDialog
          theme={theme}
          filter={modelFilter}
          onFilter={setModelFilter}
          onSelect={(modelId) => {
            setModel(modelId)
            closeModelPicker()
          }}
          onClose={closeModelPicker}
        />
      ) : null}
      {sessionsOpen ? (
        <SessionListDialog
          theme={theme}
          filter={sessionFilter}
          onFilter={setSessionFilter}
          sessions={history.sessions}
          loading={history.loading}
          error={history.error}
          onSelect={(session) => void resumeSession(session)}
          onClose={closeSessionPicker}
        />
      ) : null}
    </box>
  )
}
