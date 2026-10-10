import { Hono } from "hono"
import { cors } from "hono/cors"
import { reportError } from "./lib/sentry.js"
import { requireAuth } from "./middleware/auth.js"
import { apiNotFound, onApiError } from "./middleware/error-handler.js"
import { chat } from "./routes/chat.js"
import { credits } from "./routes/credits.js"
import { health } from "./routes/health.js"
import { oauth, oauthAuthProvider } from "./routes/oauth.js"
import { sessions } from "./routes/sessions.js"

/**
 * The whole HTTP surface. Routes never import a concrete store: they call `createStore()`, and the
 * choice lives in `store/index.ts`.
 *
 * Auth sits on `/api` and not on `/oauth`, because a caller that has no token yet cannot be asked for
 * one on the endpoint that issues it. The one place a middleware order matters is that this runs before
 * any route reads the context.
 */
export const app = new Hono()
  .use("*", cors())
  .route("/health", health)
  .route("/oauth", oauth)
  .use("/api/*", requireAuth(oauthAuthProvider))
  .route("/api/sessions", sessions)
  .route("/api/chat", chat)
  .route("/api/credits", credits)
  .notFound(apiNotFound)
  .onError(onApiError(reportError))

/** Hand this to `hc<AppType>` and the client's URLs and payloads are checked at compile time. */
export type AppType = typeof app
