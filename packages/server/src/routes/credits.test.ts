import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { Hono } from "hono"
import { localAuthProvider } from "../auth/local.js"
import { requireAuth } from "../middleware/auth.js"
import { onApiError } from "../middleware/error-handler.js"
import { LocalCreditLedger } from "../services/credits.js"
import { createCreditRoutes } from "./credits.js"

const SECRET = "the-credits-test-secret"

const originalHome = process.env[NIGHTCODE_HOME_ENV]

let home = ""

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nightcode-credits-route-"))
  process.env[NIGHTCODE_HOME_ENV] = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env[NIGHTCODE_HOME_ENV]
  else process.env[NIGHTCODE_HOME_ENV] = originalHome
})

/** The real app's shape, so the routes are proved with the caller on the context the way it arrives. */
function appWith(ledger: LocalCreditLedger): Hono {
  return new Hono()
    .use("/api/*", requireAuth(localAuthProvider({ secret: SECRET })))
    .route(
      "/api/credits",
      createCreditRoutes(() => ledger),
    )
    .onError(onApiError(() => {}))
}

describe("GET /api/credits/usage", () => {
  test("a first-time caller reads the development grant and no charges", async () => {
    const response = await appWith(new LocalCreditLedger(join(home, "credits.json"))).request("/api/credits/usage")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ balance: 500, entries: [] })
  })

  test("the charges this caller paid for are listed newest first", async () => {
    const ledger = new LocalCreditLedger(join(home, "credits.json"))
    await ledger.record({
      userId: "local",
      sessionId: "one",
      model: "gpt-5-pro",
      usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 },
    })
    await ledger.record({
      userId: "local",
      sessionId: "two",
      model: "gpt-5-pro",
      usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 },
    })

    const response = await appWith(ledger).request("/api/credits/usage")

    const body = (await response.json()) as { balance: number; entries: { sessionId: string; credits: number }[] }
    expect(body.balance).toBe(0)
    expect(body.entries.map((entry) => entry.sessionId)).toEqual(["two", "one"])
    expect(body.entries.every((entry) => entry.credits === 13500)).toBe(true)
  })
})

describe("POST /api/credits/top-up", () => {
  test("the local ledger grants and the new balance shows it", async () => {
    const ledger = new LocalCreditLedger(join(home, "credits.json"))
    await ledger.record({
      userId: "local",
      sessionId: "one",
      model: "gpt-5-pro",
      usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 },
    })
    const app = appWith(ledger)

    const response = await app.request("/api/credits/top-up", { method: "POST" })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kind: "granted", credits: 500 })
    const usage = await (await app.request("/api/credits/usage")).json()
    expect((usage as { balance: number }).balance).toBe(500)
  })

  test("an anonymous caller is refused, because a grant needs a caller to grant to", async () => {
    const refusing = new Hono()
      .use(
        "/api/*",
        requireAuth({
          authorize: () => ({ redirectTo: "" }),
          exchange: () => ({ token: "", user: { id: "x", email: "x@y.z" }, expiresAt: null }),
          verify: () => null,
        }),
      )
      .route(
        "/api/credits",
        createCreditRoutes(() => new LocalCreditLedger(join(home, "credits.json"))),
      )
      .onError(onApiError(() => {}))

    expect((await refusing.request("/api/credits/top-up", { method: "POST" })).status).toBe(401)
  })
})
