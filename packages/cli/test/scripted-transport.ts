import type { AuthUser, ChatFrame, ChatRequest, CreditUsage, Message, NewSession, Session, TopUpResult } from "@nightcode/shared"
import type { ChatTransport } from "../src/core/chat/transport.js"

export const SCRIPTED_USER: AuthUser = { id: "user-local", email: "local@nightcode.dev" }

export const SCRIPTED_SESSION: Session = {
  id: "session-scripted",
  userId: SCRIPTED_USER.id,
  title: "Scripted",
  model: "claude-3-5-sonnet",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

export interface ScriptedTransport {
  readonly transport: ChatTransport
  /**
   * Opens the transport. Until it is called no session is created and no request is sent, so a test can
   * read the optimistic frame against a transport the client has provably not reached yet.
   */
  readonly release: () => void
  readonly created: NewSession[]
  readonly streamed: ChatRequest[]
  /** What `listSessions` answered, one entry per call. The call takes no argument, so the answer is the record. */
  readonly listed: Session[][]
  /** Every id `listMessages` was asked about, in the order they were asked. */
  readonly listedIds: string[]
  readonly usages: CreditUsage[]
}

export interface ScriptedTransportOptions {
  /** Park until `release` is called. On by default, so a test that forgets to release sees nothing rather than everything. */
  readonly parked?: boolean
  /** Park again after this many frames, and hold the stream open until the run is aborted. */
  readonly parkAfterFrames?: number
  /** What `listSessions` answers, newest first as the store returns it. */
  readonly sessions?: readonly Session[]
  /** What `listMessages` answers for any session id. */
  readonly messages?: readonly Message[]
  /** What `usage` answers for the `/usage` dialog. */
  readonly creditUsage?: CreditUsage
  /** What `topUp` answers for the `/upgrade` dialog. */
  readonly topUp?: TopUpResult
}

/** How a real socket ends: the pending read settles once the signal fires, so the iterator finishes. */
function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
}

/**
 * A transport that answers from a list of frames instead of a socket.
 *
 * Parking it behind an explicit release is what lets a test prove the turn was on screen before the
 * server was ever reached, rather than proving it by looking at a frame the server already answered.
 * `parkAfterFrames` parks again part way through, which is the only way to stop a turn that has
 * already started answering without waiting for the answer to finish. The two reads never park: they
 * are not the turn, and a history list that hung on a gate would prove nothing about a dialog.
 */
export function scriptedTransport(
  frames: readonly ChatFrame[] = [{ type: "finish" }],
  options: ScriptedTransportOptions = {},
): ScriptedTransport {
  const created: NewSession[] = []
  const streamed: ChatRequest[] = []
  const listed: Session[][] = []
  const listedIds: string[] = []
  const usages: CreditUsage[] = []
  const sessions = options.sessions ?? []
  const messages = options.messages ?? []
  const parked = options.parked ?? true
  const parkAfter = options.parkAfterFrames
  let open = (): void => {}
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  const through = async (): Promise<void> => {
    if (parked) await gate
  }

  return {
    created,
    streamed,
    listed,
    listedIds,
    usages,
    release: () => open(),
    transport: {
      async createSession(input) {
        await through()
        created.push(input)
        return { ...SCRIPTED_SESSION, title: input.title, model: input.model }
      },
      async listSessions() {
        listed.push([...sessions])
        return [...sessions]
      },
      async listMessages(sessionId) {
        listedIds.push(sessionId)
        return [...messages]
      },
      async stream(request, signal) {
        await through()
        streamed.push(request)
        return {
          async *[Symbol.asyncIterator]() {
            for (const [index, frame] of frames.entries()) {
              if (signal.aborted) return
              yield frame
              if (parkAfter !== undefined && index === parkAfter - 1) await untilAborted(signal)
            }
          },
        }
      },
      async usage() {
        const answer = options.creditUsage ?? { balance: 0, entries: [] }
        usages.push(answer)
        return answer
      },
      async topUp() {
        return options.topUp ?? { kind: "granted", credits: 0 }
      },
    },
  }
}

/** One scripted turn that reads as a model thinking for a moment and then answering. */
export const ANSWER_FRAMES: readonly ChatFrame[] = [
  { type: "reasoning", text: "weighing " },
  { type: "reasoning", text: "it" },
  { type: "text", text: "the answer " },
  { type: "text", text: "is 42" },
  { type: "finish" },
]
