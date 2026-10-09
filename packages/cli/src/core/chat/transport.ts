import type { ChatFrame, ChatRequest, Message, NewSession, Session } from "@nightcode/shared"

/**
 * The chat boundary the CLI depends on, and the only reason the hooks know a server exists.
 *
 * A test hands `useChatSession` a scripted one and no socket opens, which is what keeps the full-stack
 * test the single test that talks to a real server instead of every hook test needing one.
 *
 * `createSession` lives here beside `stream` rather than beside the transport that needs it because a
 * turn cannot be answered without a session, so a transport that could not open one would be a
 * half-truth about what the CLI can do. The two reads are here for the same reason: a hook that
 * imported the api client directly would drag a server into every hook test.
 */
export interface ChatTransport {
  createSession(input: NewSession): Promise<Session>
  /** Newest first, as the store answers. */
  listSessions(): Promise<Session[]>
  /** One session's transcript in arrival order. */
  listMessages(sessionId: string): Promise<Message[]>
  stream(request: ChatRequest, signal: AbortSignal): Promise<AsyncIterable<ChatFrame>>
}
