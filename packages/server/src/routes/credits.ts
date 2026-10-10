import type { CreditLedger, CreditUsage, TopUpResult } from "@nightcode/shared"
import { topUpResultSchema } from "@nightcode/shared"
import { Hono } from "hono"
import { caller } from "../middleware/auth.js"
import { ApiError } from "../middleware/error-handler.js"
import { createCreditLedger } from "../services/credits.js"

/** How many recent charges `/usage` shows. Enough to fill the dialog and no more. */
const RECENT_LIMIT = 20

/**
 * The two routes that keep a caller out of the gate: read the balance, and add to it.
 *
 * They are deliberately not gated. A caller at zero credits has to be able to see the balance and top
 * up, or the hard stop before an unpaid bill becomes a lockout from the thing that fixes it.
 */
export function createCreditRoutes(select: () => CreditLedger = () => createCreditLedger()) {
  return new Hono()
    .get("/usage", async (c) => {
      const user = caller(c)
      if (user === null) throw new ApiError(401, "The request carries no session that this server issued")
      const credits = select()
      const usage: CreditUsage = { balance: await credits.balance(user.id), entries: await credits.recent(user.id, RECENT_LIMIT) }
      return c.json(usage)
    })
    .post("/top-up", async (c) => {
      const user = caller(c)
      if (user === null) throw new ApiError(401, "The request carries no session that this server issued")
      const result: TopUpResult = await select().topUp(user.id)
      // Parsed rather than trusted, because the local ledger and the Polar adapter both answer this
      // route and a shape neither side validated is a shape the CLI has to guess at.
      return c.json(topUpResultSchema.parse(result))
    })
}

export const credits = createCreditRoutes()
