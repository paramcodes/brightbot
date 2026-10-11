import { randomUUID } from "node:crypto"
import { cwd } from "node:process"
import type { AuthUser, ChatRequest, Message, Session, ToolCall, ToolName } from "@nightcode/shared"
import { useRef, useState } from "react"
import type { ChatTransport } from "../core/chat/transport.js"
import type { ChatMessage, ChatMessageStatus, ToolConfirmation, ToolDecision, ToolRun } from "../core/chat/types.js"
import { executeTool } from "../lib/local-tools.js"
import { useChatStream } from "./useChatStream.js"

/** The create-session route refuses a longer title, so the client's own cap is the same number. */
const TITLE_LIMIT = 200

const EMPTY_TITLE = "Untitled session"

/**
 * How many times one prompt may come back with tool calls before the loop gives up.
 *
 * Eight is far past a read, an edit, and a check. A loop that outlives it is a model that is stuck
 * rather than one that is working, and the turn ends with a named failure rather than a bill.
 */
export const MAX_TOOL_ROUNDS = 8

/** The tools that change the machine they run on, so each one is gated behind a confirmation. */
const WRITE_TOOLS: ReadonlySet<string> = new Set(["write_file", "edit_file", "bash"])

export type SubmitOutcome = { readonly accepted: true } | { readonly accepted: false; readonly reason: string }

/**
 * What the caller knows before a turn starts.
 *
 * Every field is the client's own choice rather than server state: the model names a row of the shared
 * catalog, the system prompt is the mode's own text, and the identity is the CLI's own token. The
 * server resolves a provider from the session's model row, so the three travel separately on purpose.
 * `tools` is what this mode may ask for, and the server offers exactly it.
 */
export interface TurnContext {
  readonly model: string
  readonly system: string
  readonly user: AuthUser
  readonly tools: readonly ToolName[]
}

export interface ChatSession {
  readonly messages: readonly ChatMessage[]
  readonly sessionId: string | null
  readonly generating: boolean
  readonly submit: (prompt: string, turn: TurnContext) => SubmitOutcome
  readonly abort: () => void
  readonly reset: () => void
  /** Puts a saved transcript and its session on screen, dropping whatever the view held before. */
  readonly resume: (session: Session, rows: readonly Message[]) => void
  /** A destructive call waiting on the user, rendered by the shell and answered by it. */
  readonly confirmation: ToolConfirmation | null
  readonly decide: (decision: ToolDecision) => void
}

/**
 * What the loop needs beyond the transport.
 *
 * `root` is the directory tools run against. It defaults to the working directory, which is the only
 * right answer for the CLI a user runs, and it is a seam rather than a global so a test can point the
 * executor at a directory it made.
 */
export interface ChatSessionOptions {
  readonly root?: () => string
}

/**
 * Everything the server is asked to answer next.
 *
 * An assistant turn that ran tools goes back as its text followed by one row per call, and the row
 * carries the result, so a round after the first re-enters the loop without the model being asked to
 * restate what it already knows. A turn still streaming contributes only the calls that have actually
 * answered.
 *
 * The transcript is the client's to build. The server is stateless about the conversation, so what the
 * model is handed is exactly what the loop posted.
 */
export function transcript(messages: readonly ChatMessage[]): ChatRequest["messages"] {
  return messages.flatMap((message) => {
    const rows = message.toolRuns
      .filter((run) => run.durationMs !== null || run.status === "denied")
      .map((run) => ({
        role: "tool" as const,
        toolCallId: run.call.toolCallId,
        toolName: run.call.toolName,
        input: run.call.input,
        output: run.output,
        ok: run.status === "complete",
      }))
    if (message.status === "streaming" && rows.length === 0) return []
    return [{ role: message.role, content: message.content }, ...rows]
  })
}

/** What the session is named after. Pure, so the cap and the fallback are readable in one place. */
export function sessionTitle(prompt: string): string {
  return prompt.trim().slice(0, TITLE_LIMIT) || EMPTY_TITLE
}

/**
 * A stored transcript as the view renders it.
 *
 * A `system` row is dropped rather than translated, because `ChatRole` is `user | assistant` and a
 * system turn has no representation in that vocabulary; putting it on screen would need a third role
 * nothing renders. Reasoning and error start empty and null because the shared `Message` has no field
 * for either. `status` needs no translation at all: `complete` and `interrupted` are already the same
 * two values on both sides of the port.
 */
export function toChatMessages(rows: readonly Message[]): ChatMessage[] {
  return rows.flatMap((row) =>
    row.role === "system"
      ? []
      : [{ id: row.id, role: row.role, content: row.content, reasoning: "", status: row.status, error: null, toolRuns: [] }],
  )
}

/** The blank state a turn starts with, shared so the two call sites cannot drift. */
function blank(id: string, role: ChatMessage["role"]): ChatMessage {
  return { id, role, content: "", reasoning: "", status: role === "user" ? "complete" : "streaming", error: null, toolRuns: [] }
}

/** A call that never ran because the user said no. The model is told, so it can say something else. */
function refusedByUser(run: ToolRun): ToolRun {
  return { ...run, status: "denied", output: "The user denied this call", durationMs: 0 }
}

/**
 * The conversation. It is the only writer of the messages list and the session id.
 *
 * A submit puts the prompt and an empty assistant turn on screen in one state write before it awaits
 * anything, so the first frame after `Enter` already shows the turn rather than a round trip's silence.
 */
export function useChatSession(transport: ChatTransport, options: ChatSessionOptions = {}): ChatSession {
  const [messages, setMessages] = useState<readonly ChatMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ToolConfirmation | null>(null)
  const stream = useChatStream()
  // `/clear` is reachable mid-turn, so a run that outlives its conversation has to recognise it has been
  // cleared. Without this the run would set a session id back into a state that just forgot one, and the
  // next prompt would join a session the user threw away.
  const generation = useRef(0)
  /**
   * The tools this session has been told to stop asking about.
   *
   * A set rather than a flag, because "always" is a decision about one tool and a flag covering all of
   * them would widen on the first yes.
   */
  const alwaysAllowed = useRef<ReadonlySet<string>>(new Set())
  /**
   * The transcript the loop has posted, kept by the loop rather than read back from React state.
   *
   * A detached run does not await a commit, so the state it would read is one round stale. This ref is
   * the same list the view renders, written here in the loop's own tick so the next round is built from
   * what was actually sent.
   */
  const posted = useRef<readonly ChatMessage[]>([])

  const patch = (id: string, apply: (message: ChatMessage) => ChatMessage): void => {
    // Functional, because two deltas can land in one React batch and a closed-over list would let the
    // second overwrite the first.
    setMessages((current) => current.map((message) => (message.id === id ? apply(message) : message)))
    posted.current = posted.current.map((message) => (message.id === id ? apply(message) : message))
  }

  const patchRun = (answerId: string, toolCallId: string, apply: (run: ToolRun) => ToolRun): void => {
    patch(answerId, (message) => ({
      ...message,
      toolRuns: message.toolRuns.map((run) => (run.call.toolCallId === toolCallId ? apply(run) : run)),
    }))
  }

  /**
   * Asks the user about a destructive call and waits for the answer.
   *
   * The shell owns the dialog, so the loop holds no key handling of its own. An abort during the wait
   * resolves as a deny, because a turn the user stopped is a turn whose pending call never ran, and a
   * promise left pending would hang the run.
   */
  const askAbout = (run: ToolRun, signal: AbortSignal): Promise<ToolDecision> => {
    return new Promise((resolve) => {
      const done = (decision: ToolDecision): void => {
        signal.removeEventListener("abort", onAbort)
        setConfirmation(null)
        resolve(decision)
      }
      const onAbort = (): void => done("deny")
      signal.addEventListener("abort", onAbort, { once: true })
      setConfirmation({ call: run.call, decide: done })
    })
  }

  const decide = (decision: ToolDecision): void => {
    confirmation?.decide(decision)
  }

  /**
   * One call from the model to a result, with the confirmation in front of it.
   *
   * Returns the run as it finishes, so the loop carries it on the transcript rather than reading it
   * back out of React state it cannot read synchronously.
   */
  const perform = async (run: ToolRun, answerId: string, signal: AbortSignal): Promise<ToolRun> => {
    const needsAsking = WRITE_TOOLS.has(run.call.toolName) && !alwaysAllowed.current.has(run.call.toolName)
    if (needsAsking) {
      patchRun(answerId, run.call.toolCallId, (entry) => ({ ...entry, status: "awaiting-confirmation" }))
      const decision = await askAbout(run, signal)
      if (decision === "deny") {
        const denied = refusedByUser(run)
        patchRun(answerId, run.call.toolCallId, () => denied)
        return denied
      }
      if (decision === "always") alwaysAllowed.current = new Set([...alwaysAllowed.current, run.call.toolName])
    }

    patchRun(answerId, run.call.toolCallId, (entry) => ({ ...entry, status: "running" }))
    const startedAt = Date.now()
    const result = await executeTool(run.call, options.root?.() ?? cwd())
    const finished: ToolRun = {
      call: run.call,
      status: result.ok ? "complete" : "failed",
      output: result.output,
      durationMs: Date.now() - startedAt,
    }
    patchRun(answerId, run.call.toolCallId, () => finished)
    return finished
  }

  const submit = (prompt: string, turn: TurnContext): SubmitOutcome => {
    if (stream.active) return { accepted: false, reason: "A turn is already running" }

    const question = { ...blank(randomUUID(), "user"), content: prompt }
    const answer = blank(randomUUID(), "assistant")
    posted.current = [...messages, question, answer]
    setMessages(posted.current)
    // The generation this submit belongs to. A later `/clear` bumps the counter, and comparing against
    // it is what stops a run from the discarded conversation from writing its session id back.
    const started = generation.current
    let failure: string | null = null

    /** Pulls the assistant turn the loop has been building. Same list, one read, no commit wait. */
    const currentAnswer = (): ChatMessage => {
      const found = posted.current.find((message) => message.id === answer.id)
      return found ?? answer
    }

    const run = async (signal: AbortSignal): Promise<ChatMessageStatus> => {
      try {
        let id = sessionId
        if (id === null) {
          id = (await transport.createSession({ title: sessionTitle(prompt), model: turn.model, userId: turn.user.id })).id
          if (generation.current !== started) return "interrupted"
          setSessionId(id)
        }

        for (let round = 0; ; round += 1) {
          // The cap counts requests rather than calls, so a turn that asks and never finishes stops
          // before the request that would be number nine.
          if (round >= MAX_TOOL_ROUNDS) {
            failure = `The model asked for a tool ${MAX_TOOL_ROUNDS} times without finishing. Send the prompt again, or ask it to act on what it has.`
            return "failed"
          }
          const frames = await transport.stream(
            { sessionId: id, messages: transcript(posted.current), system: turn.system, tools: turn.tools },
            signal,
          )
          const calls: ToolCall[] = []
          for await (const frame of frames) {
            if (frame.type === "text") patch(answer.id, (message) => ({ ...message, content: message.content + frame.text }))
            if (frame.type === "reasoning") patch(answer.id, (message) => ({ ...message, reasoning: message.reasoning + frame.text }))
            if (frame.type === "tool-call") {
              calls.push(frame)
              patch(answer.id, (message) => ({
                ...message,
                toolRuns: [...message.toolRuns, { call: frame, status: "pending", output: "", durationMs: null }],
              }))
            }
            if (frame.type === "error") {
              failure = frame.message
              return "failed"
            }
          }
          if (signal.aborted) return "interrupted"
          if (calls.length === 0) return "complete"

          // Sequenced rather than gathered, because two calls can both want the answer and a
          // confirmation on screen at once reads as one broken prompt.
          const runs: ToolRun[] = []
          for (const entry of currentAnswer().toolRuns) runs.push(await perform(entry, answer.id, signal))
          if (signal.aborted) return "interrupted"
          posted.current = posted.current.map((message) => (message.id === answer.id ? { ...message, toolRuns: runs } : message))
        }
      } catch (error) {
        // An aborted fetch rejects its reader rather than ending the stream, so the signal is what
        // decides whether the user stopped this turn or it broke.
        if (signal.aborted) return "interrupted"
        failure = error instanceof Error && error.message.length > 0 ? error.message : "The turn could not be completed"
        return "failed"
      }
    }

    void stream.start(run, {
      onSettled: (status) => {
        if (generation.current === started) patch(answer.id, (message) => settled(message, status, failure))
      },
    })
    return { accepted: true }
  }

  const forgetPermissions = (): void => {
    // A session-scoped decision dies with its session. `/clear` and a resume both start a new
    // conversation, and a permission granted in the old one would otherwise silently widen the first
    // write of the new one.
    alwaysAllowed.current = new Set()
    setConfirmation(null)
  }

  const reset = (): void => {
    stream.abort()
    forgetPermissions()
    generation.current += 1
    setMessages([])
    setSessionId(null)
  }

  const resume = (session: Session, rows: readonly Message[]): void => {
    // `reset`'s shape exactly. The abort stops a turn that is mid-answer, and the generation bump is
    // what keeps a run still unwinding from the previous conversation from writing its session id back
    // over the one just resumed.
    stream.abort()
    forgetPermissions()
    generation.current += 1
    setMessages(toChatMessages(rows))
    setSessionId(session.id)
  }

  return { messages, sessionId, generating: stream.active, submit, abort: stream.abort, reset, resume, confirmation, decide }
}

/** The single write that ends a turn, guarded so a second call cannot move a message that already landed. */
function settled(message: ChatMessage, status: ChatMessageStatus, failure: string | null): ChatMessage {
  if (message.status !== "streaming") return message
  return { ...message, status, error: status === "failed" ? (failure ?? "The turn failed") : null }
}
