import type { MessageStatus, Role } from "@nightcode/shared"

/** A transcript renders a user turn and an assistant turn. The server's `system` role never reaches a view. */
export type ChatRole = Extract<Role, "user" | "assistant">

/**
 * A view vocabulary of four values against the persisted vocabulary of two.
 *
 * `streaming` and `failed` exist only in the client, because a row is written once the turn is over
 * and reasoning is not persisted at all. `complete` and `interrupted` are shared on purpose: they are
 * the same fact on both sides, and a second spelling of either would need a translation nobody can
 * justify. Unifying the two unions is the wrong fix. Widening `MESSAGE_STATUSES` is.
 */
export type ChatMessageStatus = MessageStatus | "streaming" | "failed"

/** What one rendered turn holds. Reasoning rides along here rather than on the wire. */
export interface ChatMessage {
  readonly id: string
  readonly role: ChatRole
  readonly content: string
  readonly reasoning: string
  readonly status: ChatMessageStatus
  /** Set only when `status` is `failed`, and null otherwise, so a reader never has to ask which it is. */
  readonly error: string | null
}
