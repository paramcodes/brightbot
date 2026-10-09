import { Hono } from "hono"

/**
 * Liveness, not readiness. It reports that the process can answer HTTP, which is all it can know
 * without reaching a database.
 */
export const health = new Hono().get("/", (c) => c.json({ status: "ok" }))
