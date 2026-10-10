import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { CreditCharge, CreditEntry, CreditLedger, CreditProviderKind, TopUpResult } from "@nightcode/shared"
import { CREDITS_PATH, creditEntrySchema, creditsFor, resolveCreditProviderKind } from "@nightcode/shared"
import { z } from "zod"
import { polarLedgerFrom } from "../lib/polar.js"

/**
 * The credit ledger: what a caller has left, what they spent, and how they add more.
 *
 * The default is a JSON document under `NIGHTCODE_HOME` with its own serialized write chain, so a
 * fresh checkout meters turns with no credentials and no network. The Polar adapter sits behind the
 * same port and is chosen by `POLAR_ACCESS_TOKEN` the way the store is chosen by `DATABASE_URL`.
 */

export const DEVELOPMENT_GRANT_CREDITS = 500

export const TOP_UP_CREDITS = 500

const timestamp = z.string().datetime()

const balanceSchema = z.object({
  userId: z.string().min(1),
  credits: z.number().nonnegative(),
  updatedAt: timestamp,
})

const creditsDocumentSchema = z.object({
  version: z.literal(1),
  balances: z.array(balanceSchema),
  entries: z.array(creditEntrySchema),
})

interface CreditsDocument {
  version: 1
  balances: { userId: string; credits: number; updatedAt: string }[]
  entries: CreditEntry[]
}

const EMPTY_CREDITS: CreditsDocument = { version: 1, balances: [], entries: [] }

/**
 * JSON on disk under `NIGHTCODE_HOME`. The default ledger, and the one that runs with no credentials.
 *
 * It keeps its own document rather than a table on `Store` because a deduction and a session write
 * would otherwise be two writers on one file, and because the remote implementation has no rows at
 * all. The serialize chain is the same shape the file store uses, so two overlapping charges cannot
 * clobber each other.
 */
export class LocalCreditLedger implements CreditLedger {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly path?: string) {}

  private get creditsPath(): string {
    return this.path ?? CREDITS_PATH()
  }

  private serialize<T>(operation: () => T): Promise<T> {
    const run = this.tail.then(operation)
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * A caller with no row yet gets the development grant, because a balance of zero would refuse the
   * first prompt of a fresh checkout and standing order 5 forbids that.
   */
  async balance(userId: string): Promise<number> {
    return this.read().balances.find((row) => row.userId === userId)?.credits ?? DEVELOPMENT_GRANT_CREDITS
  }

  async record(charge: CreditCharge): Promise<CreditEntry> {
    return this.serialize(() => {
      const document = this.read()
      const credits = creditsFor(charge.model, charge.usage)
      const entry: CreditEntry = {
        id: randomUUID(),
        userId: charge.userId,
        sessionId: charge.sessionId,
        model: charge.model,
        promptTokens: charge.usage.promptTokens,
        completionTokens: charge.usage.completionTokens,
        credits,
        createdAt: new Date().toISOString(),
      }
      document.entries.push(entry)
      const row = document.balances.find((candidate) => candidate.userId === charge.userId)
      if (row) {
        // Clamped at zero rather than allowed to go negative, so a caller who overspends one turn
        // reads as empty rather than as a debt the meter would have to explain.
        row.credits = Math.max(0, row.credits - credits)
        row.updatedAt = entry.createdAt
      } else {
        document.balances.push({
          userId: charge.userId,
          credits: Math.max(0, DEVELOPMENT_GRANT_CREDITS - credits),
          updatedAt: entry.createdAt,
        })
      }
      this.write(document)
      return entry
    })
  }

  async recent(userId: string, limit: number): Promise<CreditEntry[]> {
    return this.read()
      .entries.filter((entry) => entry.userId === userId)
      .reverse()
      .slice(0, limit)
  }

  async topUp(userId: string): Promise<TopUpResult> {
    return this.serialize(() => {
      const document = this.read()
      this.grant(document, userId, TOP_UP_CREDITS)
      this.write(document)
      return { kind: "granted", credits: TOP_UP_CREDITS }
    })
  }

  private grant(document: CreditsDocument, userId: string, credits: number): void {
    const now = new Date().toISOString()
    const row = document.balances.find((candidate) => candidate.userId === userId)
    if (row) {
      row.credits += credits
      row.updatedAt = now
    } else {
      document.balances.push({ userId, credits, updatedAt: now })
    }
  }

  private read(): CreditsDocument {
    try {
      return creditsDocumentSchema.parse(JSON.parse(readFileSync(this.creditsPath, "utf8")))
    } catch {
      return structuredClone(EMPTY_CREDITS)
    }
  }

  private write(document: CreditsDocument): void {
    const path = this.creditsPath
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`)
    renameSync(temporary, path)
  }
}

let cached: { kind: CreditProviderKind; ledger: CreditLedger } | null = null

/**
 * One ledger per process.
 *
 * Memoized the way `createStore` is, and keyed on the kind so pointing `POLAR_ACCESS_TOKEN` at a
 * different organization rebuilds the ledger instead of answering with the previous one's balances.
 * A `LocalCreditLedger` holds no state of its own beyond its path, so sharing one is free.
 */
export function createCreditLedger(environment: Record<string, string | undefined> = process.env): CreditLedger {
  const kind = resolveCreditProviderKind(environment)
  if (!cached || cached.kind !== kind) {
    cached = { kind, ledger: kind === "polar" ? polarLedgerFrom(environment) : new LocalCreditLedger() }
  }
  return cached.ledger
}
