import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CREDITS_PATH } from "@nightcode/shared"
import { DEVELOPMENT_GRANT_CREDITS, LocalCreditLedger, TOP_UP_CREDITS } from "./credits.js"

let home: string
let originalHome: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nightcode-credits-"))
  originalHome = process.env.NIGHTCODE_HOME
  process.env.NIGHTCODE_HOME = home
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.NIGHTCODE_HOME
  else process.env.NIGHTCODE_HOME = originalHome
})

function document(): { balances: { userId: string; credits: number }[]; entries: { id: string; credits: number }[] } {
  return JSON.parse(readFileSync(CREDITS_PATH(), "utf8"))
}

const CHARGE = {
  userId: "local",
  sessionId: "session-1",
  model: "claude-sonnet-4-5",
  usage: { promptTokens: 100_000, completionTokens: 50_000 },
}

describe("LocalCreditLedger", () => {
  test("a first-time caller starts with the development grant", async () => {
    expect(await new LocalCreditLedger().balance("local")).toBe(DEVELOPMENT_GRANT_CREDITS)
  })

  test("a charge is the credit rate for the model, and it comes off the balance", async () => {
    const ledger = new LocalCreditLedger()
    const entry = await ledger.record(CHARGE)

    expect(entry.credits).toBe(105)
    expect(await ledger.balance("local")).toBe(DEVELOPMENT_GRANT_CREDITS - 105)
  })

  test("the ledger document survives a restart and a fresh instance reads it back", async () => {
    await new LocalCreditLedger().record(CHARGE)
    expect(document().balances[0]?.credits).toBe(DEVELOPMENT_GRANT_CREDITS - 105)

    expect(await new LocalCreditLedger().balance("local")).toBe(DEVELOPMENT_GRANT_CREDITS - 105)
  })

  test("a balance clamps at zero rather than becoming a debt", async () => {
    const ledger = new LocalCreditLedger()
    await ledger.record({ ...CHARGE, model: "gpt-5-pro", usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 } })

    expect(await ledger.balance("local")).toBe(0)
  })

  test("recent answers newest first and only this caller's rows", async () => {
    const ledger = new LocalCreditLedger()
    await ledger.record(CHARGE)
    await ledger.record({ ...CHARGE, sessionId: "session-2" })
    await ledger.record({ ...CHARGE, userId: "someone-else" })

    const recent = await ledger.recent("local", 10)
    expect(recent.map((entry) => entry.sessionId)).toEqual(["session-2", "session-1"])
  })

  test("a top-up grants and the new balance shows it", async () => {
    const ledger = new LocalCreditLedger()
    await ledger.record(CHARGE)

    expect(await ledger.topUp("local")).toEqual({ kind: "granted", credits: TOP_UP_CREDITS })
    expect(await ledger.balance("local")).toBe(DEVELOPMENT_GRANT_CREDITS - 105 + TOP_UP_CREDITS)
  })

  test("a corrupt ledger reads as empty rather than refusing to boot", async () => {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(CREDITS_PATH(), "{ not a ledger")

    expect(await new LocalCreditLedger().balance("local")).toBe(DEVELOPMENT_GRANT_CREDITS)
    expect(await new LocalCreditLedger().recent("local", 10)).toEqual([])
  })

  test("two overlapping charges both land, because the write chain serializes them", async () => {
    const ledger = new LocalCreditLedger()
    await Promise.all([ledger.record({ ...CHARGE, sessionId: "a" }), ledger.record({ ...CHARGE, sessionId: "b" })])

    expect(document().entries).toHaveLength(2)
    expect(await ledger.balance("local")).toBe(DEVELOPMENT_GRANT_CREDITS - 210)
  })
})
