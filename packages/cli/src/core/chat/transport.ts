import type { ChatFrame, ChatRequest, NewSession, Session } from "@nightcode/shared"

/**
 * The chat boundary the CLI depends on, and the only reason the hooks know a server exists.
 *
 * A test hands `useChatSession` a scripted one and no socket opens, which is what keeps the full-stack
 * test the single test that talks to a real server instead of every hook test needing one.
 *
 * `createSession` lives here beside `stream` rather than beside the transport that needs it because a
 * turn cannot be answered without a session, so a transport that could not open one would be a
 * half-truth about what the CLI can do.
 */
export interface ChatTransport {
  createSession(input: NewSession): Promise<Session>
  stream(request: ChatRequest, signal: AbortSignal): Promise<AsyncIterable<ChatFrame>>
}
