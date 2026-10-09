import { Hono } from "hono"
import { cors } from "hono/cors"
import { apiNotFound, onApiError } from "./middleware/error-handler.js"
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
  .notFound(apiNotFound)
  .onError(onApiError(() => {}))

/** Hand this to `hc<AppType>` and the client's URLs and payloads are checked at compile time. */
export type AppType = typeof app
