import { Hono } from "hono"
import { cors } from "hono/cors"
import { health } from "./routes/health.js"

/** The whole HTTP surface. Later phases add routes here; nothing else may construct the app. */
export const app = new Hono().use("*", cors()).route("/health", health)

/** Hand this to `hc<AppType>` and the client's URLs and payloads are checked at compile time. */
export type AppType = typeof app
