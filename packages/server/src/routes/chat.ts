import { zValidator } from "@hono/zod-validator"
import type { ChatFrame, ChatRequest, Session, Store } from "@nightcode/shared"
import { CHAT_STREAM_EVENT, chatRequestSchema } from "@nightcode/shared"
import { Hono } from "hono"
import type { SSEStreamingApi } from "hono/streaming"
import { streamSSE } from "hono/streaming"
import { z } from "zod"
import { type Model, type ModelEvent, resolveModel, toFrame } from "../lib/ai.js"
import { reportError } from "../lib/sentry.js"
import { ApiError, errorResponse } from "../middleware/error-handler.js"
import { createStore } from "../store/index.js"

/** What a turn ended as, decided by one `AbortSignal` evaluated at the last possible moment. */
export type TurnResult =
  | { readonly outcome: "complete" | "interrupted"; readonly content: string; readonly reasoning: string }
  | { readonly outcome: "failed"; readonly code: string; readonly message: string }

/**
 * Drains a provider's events into the wire and decides how the turn ended.
 *
 * The signal is checked before every pull and once more after the loop, so a client that leaves during
 * the last chunk is still recorded as interrupted. An abort is never a failure.
 */
export async function relayTurn(
  events: AsyncIterable<ModelEvent>,
  write: (frame: ChatFrame) => Promise<void>,
  signal: AbortSignal,
): Promise<TurnResult> {
  let content = ""
  let reasoning = ""
  const iterator = events[Symbol.asyncIterator]()
  try {
    while (!signal.aborted) {
      const next = await iterator.next()
      if (next.done) break
      const event = next.value
      if (event.type === "text") content += event.text
      else reasoning += event.text
      await write(toFrame(event))
    }
  } catch (error) {
    // The client only ever sees the sanitized frame, so the cause is reported here rather than carried
    // in `TurnResult`, where nothing could forward it.
    reportError(error)
    return { outcome: "failed", code: "MODEL_FAILED", message: "The model failed to answer this turn" }
  }
  if (signal.aborted) return { outcome: "interrupted", content, reasoning }
  return { outcome: "complete", content, reasoning }
}

const STREAM_FAILURE: ChatFrame = { type: "error", code: "STREAM_FAILED", message: "The stream failed" }

function writeFrame(stream: SSEStreamingApi, frame: ChatFrame): Promise<void> {
  return stream.writeSSE({ event: CHAT_STREAM_EVENT, data: JSON.stringify(frame) })
}

async function writeQuietly(stream: SSEStreamingApi, frame: ChatFrame): Promise<void> {
  try {
    await writeFrame(stream, frame)
  } catch {
    // Nothing reaches a client that has already left.
  }
}

async function reportStreamFailure(error: unknown, stream: SSEStreamingApi): Promise<void> {
  reportError(error)
  await writeQuietly(stream, STREAM_FAILURE)
}

interface Turn {
  readonly store: Store
  readonly session: Session
  readonly body: ChatRequest
  readonly selectModel: () => Model
}

async function streamTurn(stream: SSEStreamingApi, turn: Turn, signal: AbortSignal): Promise<void> {
  // A rejected write means the client vanished, which is the same thing an abort means, so the status
  // stays a function of the signal instead of becoming a second failure mode.
  const write = async (frame: ChatFrame) => {
    try {
      await writeFrame(stream, frame)
    } catch (error) {
      if (!signal.aborted) throw error
    }
  }

  const result = await relayTurn(
    turn.selectModel().stream({ model: turn.session.model, messages: turn.body.messages, signal }),
    write,
    signal,
  )

  if (result.outcome === "failed") {
    await write({ type: "error", code: result.code, message: result.message })
    return
  }
  if (result.content.length > 0) {
    await turn.store.appendMessage({
      sessionId: turn.session.id,
      role: "assistant",
      content: result.content,
      status: result.outcome,
    })
  }
  // The row is already on disk, so a client that dies between this write and `finish` still sees a turn
  // that exists.
  await write({ type: "finish" })
}

/**
 * The route takes the model as a source resolved per request, so the provider choice and the scripted
 * knobs are read from the environment at request time rather than frozen at import.
 */
// The return type is left inferred. Naming it `Hono` widens the route's schema to `BlankSchema`, which
// erases this route from `hc<AppType>` and leaves the CLI with a client that cannot see the one route
// the whole streaming path depends on.
export function createChatRoute(selectModel: () => Model = () => resolveModel(process.env)) {
  return new Hono().post(
    "/",
    zValidator("json", chatRequestSchema, (result, _c) => (result.success ? undefined : errorResponse(400, z.prettifyError(result.error)))),
    async (c) => {
      const body: ChatRequest = c.req.valid("json")
      const store = await createStore()
      const session = await store.getSession(body.sessionId)
      if (!session) throw new ApiError(404, `No session with id ${body.sessionId}`)
      const turn = body.messages.at(-1)
      if (!turn) throw new ApiError(400, "The last message must come from the user")

      await store.appendMessage({ sessionId: session.id, role: "user", content: turn.content, status: "complete" })

      return streamSSE(
        c,
        // Hono appends its own `event: error` block carrying the raw error message once the callback
        // throws, so the body catches its own failures instead: that keeps the wire inside the union.
        async (stream) => {
          try {
            await streamTurn(stream, { store, session, body, selectModel }, c.req.raw.signal)
          } catch (error) {
            await reportStreamFailure(error, stream)
          }
        },
        // Hono's `onError` hook never runs once a stream body has started, so the route also reports its
        // own failures here.
        (error, stream) => reportStreamFailure(error, stream),
      )
    },
  )
}

export const chat = createChatRoute()
