import type { ChatFrame, ChatRequest, CreditUsage, Message, NewSession, Session, TopUpResult } from "@nightcode/shared"

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
 *
 * The shapes are the port's own, so the client sends exactly what the store reads. `NewSession` carries
 * the caller's id because the store records who opened a session rather than allocating an owner, and
 * the CLI reads that id from its own token at the boundary.
 */
export interface ChatTransport {
  createSession(input: NewSession): Promise<Session>
  /** Newest first, as the store answers. */
  listSessions(): Promise<Session[]>
  /** One session's transcript in arrival order. */
  listMessages(sessionId: string): Promise<Message[]>
  stream(request: ChatRequest, signal: AbortSignal): Promise<AsyncIterable<ChatFrame>>
  /** The balance and the recent charges, which is what the `/usage` dialog renders. */
  usage(): Promise<CreditUsage>
  /** Adds credits, or hands back a checkout URL to open. */
  topUp(): Promise<TopUpResult>
}
