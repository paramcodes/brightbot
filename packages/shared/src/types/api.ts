/**
 * The wire contract Night Code's own HTTP surface exposes.
 *
 * The entity shapes live in `ports/store.ts` because they are the same records on both sides of the
 * port, and the RPC types come from the server's own route table. This file holds only what has no
 * other home: the shared error envelope.
 */

/** Every failure the API returns, whatever produced it. */
export type ApiErrorBody = {
  error: {
    /** Stable machine-readable code, safe to branch on. */
    code: string
    /** Human-readable summary. Never a stack trace, never a connection string. */
    message: string
  }
}
