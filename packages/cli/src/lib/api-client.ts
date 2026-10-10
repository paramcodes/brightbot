import type { ApiErrorBody, ChatFrame, ChatRequest, Message, NewSession, Session } from "@nightcode/shared"
import { chatFrameSchema } from "@nightcode/shared"
import { hc } from "hono/client"
import type { AppType } from "../../../server/src/app.js"
import type { ChatTransport } from "../core/chat/transport.js"

/**
 * The typed client for Night Code's own API.
 *
 * `hc<AppType>` reads the route table straight off the server's app, so a URL that does not exist or
 * a payload the route rejects fails `bun run typecheck` instead of failing in front of a user.
 *
 * The base is the empty string on purpose: it is the prefix every route path is resolved against, and
 * the host comes from `fetch` below. The host is therefore resolved per request rather than baked in
 * at construction. A module registry is process-wide, so a client that froze its host at import would
 * hand the first importer's port to every later importer, and a test that boots its own server could
 * not point the shared module at it.
 */
export const apiClient = hc<AppType>("", {
  fetch: ((path: string | URL, init?: RequestInit) => fetch(`${baseUrl()}${path}`, init)) as unknown as typeof fetch,
})

function baseUrl(): string {
  return process.env.NIGHTCODE_SERVER_URL ?? "http://localhost:3000"
}

/**
 * A refusal the server described in its own envelope.
 *
 * Carrying the status and the code is what keeps a client mistake (`400`, `404`) distinguishable from a
 * server bug (`500`) without the caller reading prose to decide which happened.
 */
export class ChatRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ChatRequestError"
  }
}

/** The one chat boundary the CLI owns. Injected everywhere else, so a test never opens a socket. */
export const httpChatTransport: ChatTransport = {
  async createSession(input: NewSession): Promise<Session> {
    const response = await apiClient.api.sessions.$post({ json: input })
    if (!response.ok) throw await requestError(response)
    return await response.json()
  },
  async listSessions(): Promise<Session[]> {
    const response = await apiClient.api.sessions.$get()
    if (!response.ok) throw await requestError(response)
    return await response.json()
  },
  async listMessages(sessionId: string): Promise<Message[]> {
    const response = await apiClient.api.sessions[":id"].messages.$get({ param: { id: sessionId } })
    if (!response.ok) throw await requestError(response)
    return await response.json()
  },
  stream: streamChat,
}

/**
 * Posts a turn and hands back the frames as they arrive.
 *
 * The response is validated before the stream opens, so a `404` on a session that no longer exists
 * surfaces as an error the caller can name rather than as an empty stream that looks like a model that
 * had nothing to say.
 */
export async function streamChat(request: ChatRequest, signal: AbortSignal): Promise<AsyncIterable<ChatFrame>> {
  const response = await apiClient.api.chat.$post({ json: request }, { init: { signal } })
  if (!response.ok) throw await requestError(response)
  if (!response.body) throw new ChatRequestError(500, "NO_STREAM", "The server accepted the turn and returned no stream")
  return decodeFrames(response.body, signal)
}

/**
 * Splits the SSE body into blocks and validates each one against the shared schema.
 *
 * Blocks are read by their `data:` line and the `event:` name is ignored, because Hono writes an
 * `event: error` block of its own once a stream callback throws and the CLI must survive meeting a
 * name it did not expect. A payload that does not parse ends the stream as a failure rather than being
 * skipped: it means the two sides disagree about the wire, and silence would hide that until the answer
 * came out wrong.
 */
async function* decodeFrames(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<ChatFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const payload = dataPayload(block)
        if (payload !== null) yield decodeFrame(payload)
        boundary = buffer.indexOf("\n\n")
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function dataPayload(block: string): string | null {
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) return line.slice("data:".length).trim()
  }
  return null
}

function decodeFrame(payload: string): ChatFrame {
  const parsed = chatFrameSchema.safeParse(parseJson(payload))
  if (!parsed.success) throw new Error(`The stream carried a frame the shared schema does not describe: ${payload}`)
  return parsed.data
}

function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

/** What the error reader takes. Hono's `ClientResponse` is not a `Response`, and the reader needs two fields. */
interface FailedRequest {
  readonly status: number
  json(): Promise<unknown>
}

/**
 * Reads the server's own error envelope. A body that is not that envelope, such as a proxy's HTML
 * error page, becomes a generic sentence rather than a message written by something else.
 */
async function requestError(response: FailedRequest): Promise<ChatRequestError> {
  const fallback = new ChatRequestError(response.status, "REQUEST_FAILED", "The server refused the request")
  const error = errorBody(await response.json().catch(() => null))
  return error === null ? fallback : new ChatRequestError(response.status, error.code, error.message)
}

function errorBody(value: unknown): ApiErrorBody["error"] | null {
  if (typeof value !== "object" || value === null) return null
  const error = (value as { error?: unknown }).error
  if (typeof error !== "object" || error === null) return null
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (typeof code !== "string" || typeof message !== "string") return null
  return { code, message }
}
