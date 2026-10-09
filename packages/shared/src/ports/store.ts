/**
 * The domain shapes Night Code persists and the port that moves them.
 *
 * The shapes live here because every store implementation, the Prisma schema, and the HTTP wire
 * contract all speak the same records. `types/api.ts` re-exports these and adds only what is about
 * transport.
 *
 * Every timestamp is an ISO string. The file store writes what it is given; the Prisma store converts
 * `DateTime` columns at its own edge. A caller cannot tell which backend answered.
 */
export interface User {
  id: string
  email: string
  createdAt: string
  updatedAt: string
}

export interface Session {
  id: string
  /** Owner of the session. The store allocates this until Phase 6 adds an authenticated caller. */
  userId: string
  title: string
  model: string
  createdAt: string
  updatedAt: string
}

/**
 * Every role a transcript carries. The wire schema derives its enum from this tuple, so a role added
 * here is a role the request schema accepts on the same edit.
 */
export const ROLES = ["user", "assistant", "system"] as const
export type Role = (typeof ROLES)[number]

export interface Message {
  id: string
  sessionId: string
  role: Role
  content: string
  status: MessageStatus
  createdAt: string
}

/**
 * How a turn ended. There is no `"streaming"` value because a row is written once, when the turn is
 * over, so an unfinished message is unrepresentable.
 */
export const MESSAGE_STATUSES = ["complete", "interrupted"] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

export interface TokenUsage {
  id: string
  sessionId: string
  model: string
  promptTokens: number
  completionTokens: number
  createdAt: string
}

/**
 * What a caller hands the store to open a session.
 *
 * Identity stays inside the store on purpose: no route signature grows a `userId` only to have
 * Phase 6 take it away again when real auth lands.
 */
export type NewSession = Pick<Session, "title" | "model">

/** What a caller hands the store to record one finished turn. */
export type NewMessage = Pick<Message, "sessionId" | "role" | "content" | "status">

/**
 * The persistence port. Only the operations the Phase 3 routes call, so widening it is a deliberate
 * edit rather than an unused method that rots.
 */
export interface Store {
  createSession(input: NewSession): Promise<Session>
  getSession(id: string): Promise<Session | null>
  appendMessage(input: NewMessage): Promise<Message>
}
