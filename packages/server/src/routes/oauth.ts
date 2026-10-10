import type { AuthSession } from "@nightcode/shared"
import { Hono } from "hono"
import { type AuthProvider, localAuthProvider } from "../auth/local.js"
import { exchangeInput } from "../auth/token.js"
import { ApiError } from "../middleware/error-handler.js"

/**
 * The two endpoints a browser login needs.
 *
 * `authorize` is the URL the browser is opened on, and it answers with a redirect because that is the
 * only response a page navigation can carry. `token` is the POST that spends the code and answers with
 * the session the CLI keeps on disk. Both live on this server rather than on a hosted provider, so the
 * flow is identical whichever kind is configured and only the provider object changes.
 */
export function createOAuthRoutes(auth: AuthProvider) {
  return new Hono()
    .get("/authorize", (c) => {
      const redirectUri = c.req.query("redirect_uri")
      const state = c.req.query("state")
      const challenge = c.req.query("code_challenge")
      if (!redirectUri || !state || !challenge) {
        throw new ApiError(400, "The authorize request is missing a parameter it needs")
      }
      const method = c.req.query("code_challenge_method")
      if (method !== "S256") throw new ApiError(400, "Only the S256 challenge method is supported")
      return c.redirect(auth.authorize({ redirectUri, state, challenge }).redirectTo)
    })
    .post("/token", async (c) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        throw new ApiError(400, "The token request body is not JSON")
      }
      const session: AuthSession = auth.exchange(exchangeInput(body))
      return c.json(session, 200)
    })
}

/**
 * The provider every route shares, chosen from the environment the way the store and the model are.
 *
 * `NIGHTCODE_AUTH_SECRET` is read at construction rather than per request, because a secret that
 * changed mid-process would invalidate the tokens it had already handed out.
 */
export const oauthAuthProvider: AuthProvider = localAuthProvider({ secret: process.env.NIGHTCODE_AUTH_SECRET })

export const oauth = createOAuthRoutes(oauthAuthProvider)
