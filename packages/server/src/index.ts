import { app } from "./app.js"
import { initSentry } from "./lib/sentry.js"

initSentry()

/**
 * Bun reads this default export as the server. No credential, database, or network is needed to boot,
 * so the file store answers every route until `DATABASE_URL` is set.
 */
export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
}
