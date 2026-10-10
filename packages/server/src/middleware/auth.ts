import type { AuthUser } from "@nightcode/shared"
import { createMiddleware } from "hono/factory"
import type { AuthProvider } from "../auth/local.js"

/**
 * Reads the bearer token and puts the caller on the request context.
 *
 * The middleware is where a token becomes an identity, and nowhere else. A route never parses an
 * `Authorization` header, which is what keeps "who is calling" a question with one answer in the
 * codebase and one place to change when the provider changes.
 */
export const AUTH_USER_KEY = "authUser"

export function requireAuth(auth: AuthProvider) {
  return createMiddleware(async (c, next) => {
    const user = auth.verify(bearerToken(c.req.header("Authorization")))
    c.set(AUTH_USER_KEY, user)
    await next()
  })
}

/**
 * The token the request carries, or null when it carries none.
 *
 * A header that is present but is not a bearer token is refused rather than read as "no token",
 * because a client that sends `Basic` has named some credential and the answer to it is not the local
 * default's anonymous caller.
 */
function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null
  const [scheme, value] = header.split(" ")
  if (scheme !== "Bearer" || value === undefined || value.length === 0) return malformed
  return value
}

/**
 * A value that no token check can pass, which is how a refused credential is represented.
 *
 * It is a string rather than null so the distinction survives the trip to the provider, and it is
 * unguessable so it can never collide with a token a real signer produced.
 */
const malformed = "\u0000not-a-token"

/** The caller this request was authenticated as, or null when it was not. */
export function caller(c: { get: (key: string) => unknown }): AuthUser | null {
  const user = c.get(AUTH_USER_KEY)
  return user === null || user === undefined ? null : (user as AuthUser)
}
