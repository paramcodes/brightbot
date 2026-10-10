import type { CreditLedger } from "@nightcode/shared"
import { createMiddleware } from "hono/factory"
import { createCreditLedger } from "../services/credits.js"
import { caller } from "./auth.js"
import { ApiError } from "./error-handler.js"

/**
 * Refuses a turn from a caller with no credits, before any token is spent.
 *
 * It runs inside the chat route rather than on the whole `/api` tree, because it is the one route
 * that costs money. Mounted anywhere else it would also refuse a session listing, which would lock a
 * caller out of the `/usage` and top-up routes that exist to fix the refusal.
 */

const OUT_OF_CREDITS = "You have no credits left. Run /upgrade to add more."

/**
 * The gate. It runs inside the chat route, so it reads the caller the route would have read and
 * refuses before the route opens a stream.
 */
export function requireCredits(select: () => CreditLedger = () => createCreditLedger()) {
  return createMiddleware(async (c, next) => {
    const user = caller(c)
    if (user === null) throw new ApiError(401, "The request carries no session that this server issued")
    if ((await select().balance(user.id)) <= 0) throw new ApiError(402, OUT_OF_CREDITS)
    await next()
  })
}
