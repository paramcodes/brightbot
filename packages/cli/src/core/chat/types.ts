import type { MessageStatus, Role, ToolCall } from "@nightcode/shared"

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

/**
 * How one tool call went, from the model asking for it to the result being on screen.
 *
 * The values are a sequence rather than flags, because the confirmation sits between asking and
 * running and a caller has to be able to tell "waiting on the user" from "waiting on the command".
 */
export type ToolRunStatus =
  /** Asked for. The confirmation, if any, has not been answered yet. */
  | "pending"
  /** Waiting on the user's confirmation. */
  | "awaiting-confirmation"
  | "running"
  /** Finished. `ok` on the result says whether it worked. */
  | "complete"
  /** Refused by the user before it ran. */
  | "denied"

/** One call and everything that came of it. This is what a turn renders and what the loop carries. */
export interface ToolRun {
  readonly call: ToolCall
  readonly status: ToolRunStatus
  /** What the command said. Empty while it has not answered. */
  readonly output: string
  /** Null until the run has finished, then the elapsed milliseconds. */
  readonly durationMs: number | null
}

/** What the user said about a call they were shown. */
export type ToolDecision = "once" | "always" | "deny"

export interface ToolConfirmation {
  readonly call: ToolCall
  readonly decide: (decision: ToolDecision) => void
}

/** What one rendered turn holds. Reasoning rides along here rather than on the wire. */
export interface ChatMessage {
  readonly id: string
  readonly role: ChatRole
  readonly content: string
  readonly reasoning: string
  readonly status: ChatMessageStatus
  /** Set only when `status` is `failed`, and null otherwise, so a reader never has to ask which it is. */
  readonly error: string | null
  /**
   * The tools this turn asked for, in the order they were asked.
   *
   * They ride on the assistant turn rather than as sibling rows, because the model asked for them in
   * the middle of saying something and the render has to keep that adjacency to stay readable.
   */
  readonly toolRuns: readonly ToolRun[]
}
