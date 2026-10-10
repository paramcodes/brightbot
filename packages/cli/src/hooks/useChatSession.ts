import { randomUUID } from "node:crypto"
import type { ChatRequest, Message, Session } from "@nightcode/shared"
import { useRef, useState } from "react"
import type { ChatTransport } from "../core/chat/transport.js"
import type { ChatMessage, ChatMessageStatus } from "../core/chat/types.js"
import { useChatStream } from "./useChatStream.js"

/** The create-session route refuses a longer title, so the client's own cap is the same number. */
const TITLE_LIMIT = 200

const EMPTY_TITLE = "Untitled session"

export type SubmitOutcome = { readonly accepted: true } | { readonly accepted: false; readonly reason: string }

/**
 * What the caller knows before a turn starts.
 *
 * Both fields are the client's own choices rather than server state: the model names a row of the
 * shared catalog, and the system prompt is the mode's own text. The server resolves a provider from
 * the session's model row, so the two travel separately on purpose.
 */
export interface TurnContext {
  readonly model: string
  readonly system: string
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
}

/**
 * Everything the server is asked to answer next: every turn that has ended, plus the prompt just typed.
 *
 * The in-flight assistant message is left out because it is half-written. The request schema refuses a
 * transcript that does not end on the user, and an unfinished answer is not context for the next turn,
 * so sending it back would be both rejected and wrong.
 */
export function transcript(messages: readonly ChatMessage[]): ChatRequest["messages"] {
  return messages.filter((message) => message.status !== "streaming").map((message) => ({ role: message.role, content: message.content }))
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
    row.role === "system" ? [] : [{ id: row.id, role: row.role, content: row.content, reasoning: "", status: row.status, error: null }],
  )
}

/**
 * The conversation. It is the only writer of the messages list and the session id.
 *
 * A submit puts the prompt and an empty assistant turn on screen in one state write before it awaits
 * anything, so the first frame after `Enter` already shows the turn rather than a round trip's silence.
 */
export function useChatSession(transport: ChatTransport): ChatSession {
  const [messages, setMessages] = useState<readonly ChatMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const stream = useChatStream()
  // `/clear` is reachable mid-turn, so a run that outlives its conversation has to recognise it has been
  // cleared. Without this the run would set a session id back into a state that just forgot one, and the
  // next prompt would join a session the user threw away.
  const generation = useRef(0)

  const patch = (id: string, apply: (message: ChatMessage) => ChatMessage): void => {
    // Functional, because two deltas can land in one React batch and a closed-over list would let the
    // second overwrite the first.
    setMessages((current) => current.map((message) => (message.id === id ? apply(message) : message)))
  }

  const submit = (prompt: string, turn: TurnContext): SubmitOutcome => {
    if (stream.active) return { accepted: false, reason: "A turn is already running" }

    const question: ChatMessage = { id: randomUUID(), role: "user", content: prompt, reasoning: "", status: "complete", error: null }
    const answerId = randomUUID()
    const stub: ChatMessage = { id: answerId, role: "assistant", content: "", reasoning: "", status: "streaming", error: null }
    setMessages((current) => [...current, question, stub])
    // The generation this submit belongs to. A later `/clear` bumps the counter, and comparing against
    // it is what stops a run from the discarded conversation from writing its session id back.
    const started = generation.current

    let failure: string | null = null
    const run = async (signal: AbortSignal): Promise<ChatMessageStatus> => {
      try {
        let id = sessionId
        if (id === null) {
          id = (await transport.createSession({ title: sessionTitle(prompt), model: turn.model })).id
          if (generation.current !== started) return "interrupted"
          setSessionId(id)
        }
        const frames = await transport.stream({ sessionId: id, messages: transcript([...messages, question]), system: turn.system }, signal)
        for await (const frame of frames) {
          if (frame.type === "text") patch(answerId, (message) => ({ ...message, content: message.content + frame.text }))
          if (frame.type === "reasoning") patch(answerId, (message) => ({ ...message, reasoning: message.reasoning + frame.text }))
          if (frame.type === "error") {
            failure = frame.message
            return "failed"
          }
        }
        return signal.aborted ? "interrupted" : "complete"
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
        if (generation.current === started) patch(answerId, (message) => settled(message, status, failure))
      },
    })
    return { accepted: true }
  }

  const reset = (): void => {
    stream.abort()
    generation.current += 1
    setMessages([])
    setSessionId(null)
  }

  const resume = (session: Session, rows: readonly Message[]): void => {
    // `reset`'s shape exactly. The abort stops a turn that is mid-answer, and the generation bump is
    // what keeps a run still unwinding from the previous conversation from writing its session id back
    // over the one just resumed.
    stream.abort()
    generation.current += 1
    setMessages(toChatMessages(rows))
    setSessionId(session.id)
  }

  return { messages, sessionId, generating: stream.active, submit, abort: stream.abort, reset, resume }
}

/** The single write that ends a turn, guarded so a second call cannot move a message that already landed. */
function settled(message: ChatMessage, status: ChatMessageStatus, failure: string | null): ChatMessage {
  if (message.status !== "streaming") return message
  return { ...message, status, error: status === "failed" ? (failure ?? "The turn failed") : null }
}
