import { z } from "zod"
import type { ModelOption } from "../constants/models.js"
import { MODELS } from "../constants/models.js"

/**
 * Credits: what a turn costs, who is charged for it, and how a balance is held.
 *
 * Standing order 5 puts every external dependency behind a port in shared with a local default that
 * runs with no credentials. This is that port for billing: the shapes live here, the local ledger and
 * the Polar adapter live in the server, and `resolveCreditProviderKind` picks between them from the
 * environment the same way `resolveAuthKind` does.
 */

/**
 * What a turn billed, exactly as the provider reported it.
 *
 * Only two counts, because those are the two the published per-million rates are quoted against. A
 * provider that also reports cached tokens reports them into these two, which is a small
 * over-charge on a cache hit and is recorded rather than modelled.
 */
export interface TokenUsage {
  readonly promptTokens: number
  readonly completionTokens: number
}

/** What a turn costs in credits, decided by the model that answered it. */
export interface TokenRate {
  readonly inputPerMillion: number
  readonly outputPerMillion: number
}

/**
 * What a turn cost, in credits.
 *
 * Pure, so a shared test asserts it against a literal and no server is involved. The model id
 * decides the rate, and the two counts decide the amount.
 *
 * A million tokens at `inputPerMillion` dollars is `inputPerMillion` dollars, which is
 * `inputPerMillion` hundredths of a dollar, so the token price scaled per million converts to credits
 * with one division by ten thousand. The result is rounded to a whole credit, because a credit is the
 * unit a user is charged in and a fraction of one is a balance nobody can read.
 */
export function creditsFor(model: string, usage: TokenUsage): number {
  const rate = rateFor(model)
  const dollarsScaled = usage.promptTokens * rate.inputPerMillion + usage.completionTokens * rate.outputPerMillion
  return Math.round(dollarsScaled / 10_000)
}

/**
 * The rate for a model, or the most expensive row in the catalog when the model is not in it.
 *
 * An unknown price is a price the meter must not under-report, so a session that named a model this
 * catalog does not recognise is charged at the top of the table. That over-charges an operator who
 * configured a custom id, and it is the direction a meter is allowed to be wrong in.
 */
export function rateFor(model: string): TokenRate {
  const known = MODELS.find((option) => option.id === model)
  if (known) return known
  const dearest = MODELS.reduce((widest: ModelOption, option) =>
    option.inputPerMillion + option.outputPerMillion > widest.inputPerMillion + widest.outputPerMillion ? option : widest,
  )
  return dearest
}

/** One finished turn's charge, as the ledger stores it. */
export interface CreditEntry {
  readonly id: string
  /** Who is charged. The local ledger has exactly one of these, and a hosted identity has many. */
  readonly userId: string
  readonly sessionId: string
  readonly model: string
  readonly promptTokens: number
  readonly completionTokens: number
  readonly credits: number
  readonly createdAt: string
}

/** What a finished turn hands the ledger. */
export interface CreditCharge {
  readonly userId: string
  readonly sessionId: string
  readonly model: string
  readonly usage: TokenUsage
}

/**
 * What asking for more credits answers.
 *
 * A union rather than a record with a nullable field, because "the ledger already granted you
 * credits" and "go and pay for them somewhere else" are different instructions to a user and only
 * one of them leaves the terminal.
 */
export type TopUpResult = { readonly kind: "granted"; readonly credits: number } | { readonly kind: "checkout"; readonly url: string }

/**
 * The persistence port for spend.
 *
 * Every read takes the caller's id, because "how many credits are left" has only one honest answer
 * per caller. `topUp` is on the port rather than on a route because what topping up *means* is the
 * part that differs between a local ledger and a hosted one.
 */
export interface CreditLedger {
  /** What the caller has left. */
  balance(userId: string): Promise<number>
  /** Charges one finished turn and answers with what it charged. */
  record(charge: CreditCharge): Promise<CreditEntry>
  recent(userId: string, limit: number): Promise<CreditEntry[]>
  topUp(userId: string): Promise<TopUpResult>
}

/** What the `/usage` route answers. */
export interface CreditUsage {
  readonly balance: number
  readonly entries: readonly CreditEntry[]
}

export const CREDIT_PROVIDER_KINDS = ["local", "polar"] as const
export type CreditProviderKind = (typeof CREDIT_PROVIDER_KINDS)[number]

/**
 * Which ledger answers.
 *
 * A Polar organization access token is the only thing that selects the adapter, so a machine without
 * one runs the local ledger and `bun run dev` answers a prompt. The same rule `resolveAuthKind`
 * follows.
 */
export function resolveCreditProviderKind(environment: Record<string, string | undefined>): CreditProviderKind {
  return environment.POLAR_ACCESS_TOKEN ? "polar" : "local"
}

const tokenCount = z.number().int().nonnegative()

export const creditEntrySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  model: z.string().min(1),
  promptTokens: tokenCount,
  completionTokens: tokenCount,
  credits: z.number().nonnegative(),
  createdAt: z.string().datetime(),
})

export const topUpResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("granted"), credits: z.number().nonnegative() }),
  z.object({ kind: z.literal("checkout"), url: z.string().min(1) }),
])
