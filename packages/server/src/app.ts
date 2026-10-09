import { Hono } from "hono"
import { cors } from "hono/cors"
import { reportError } from "./lib/sentry.js"
import { apiNotFound, onApiError } from "./middleware/error-handler.js"
import { chat } from "./routes/chat.js"
import { health } from "./routes/health.js"
import { sessions } from "./routes/sessions.js"

/**
 * The whole HTTP surface. Routes never import a concrete store: they call `createStore()`, and the
 * choice lives in `store/index.ts`.
 */
export const app = new Hono()
  .use("*", cors())
  .route("/health", health)
  .route("/api/sessions", sessions)
  .route("/api/chat", chat)
  .notFound(apiNotFound)
  .onError(onApiError(reportError))

/** Hand this to `hc<AppType>` and the client's URLs and payloads are checked at compile time. */
export type AppType = typeof app
