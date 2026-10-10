import type { AuthUser, CreditLedger, Session, TokenUsage } from "@nightcode/shared"
import { reportError } from "../lib/sentry.js"

/**
 * Turns a finished turn's tokens into a charge.
 *
 * It sits between the provider's usage report and the ledger, and it owns one decision: whether the
 * turn is charged at all. The ledger owns the balance.
 */

export interface TurnUsageReport {
  readonly user: AuthUser
  readonly session: Session
  readonly model: string
  readonly usage: TokenUsage
}

/**
 * Charges one finished turn.
 *
 * It never throws into the turn. A live answer that already happened is not made untrue by a ledger
 * that failed to write, so a failure is reported and the turn still finishes. The alternative is a
 * user watching a good answer turn into an error because the meter was slow.
 */
export async function recordTurnUsage(credits: CreditLedger, report: TurnUsageReport): Promise<void> {
  try {
    await credits.record({
      userId: report.user.id,
      sessionId: report.session.id,
      model: report.model,
      usage: report.usage,
    })
  } catch (error) {
    reportError(error)
  }
}
