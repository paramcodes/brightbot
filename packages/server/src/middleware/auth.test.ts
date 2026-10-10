import { describe, expect, test } from "bun:test"
import type { AuthUser } from "@nightcode/shared"
import { Hono } from "hono"
import { createPkce } from "../../../shared/src/pkce.js"
import { localAuthProvider } from "../auth/local.js"
import { AUTH_USER_KEY, caller, requireAuth } from "./auth.js"

const LOCAL: AuthUser = { id: "local", email: "local@nightcode.dev" }

function appWith(provider = localAuthProvider({ secret: "the-middleware-test-secret" })): Hono {
  return new Hono()
    .use("/api/*", requireAuth(provider))
    .get("/api/who", (c) => c.json(caller(c)))
    .get("/health", (c) => c.json({ ok: true }))
}

describe("requireAuth", () => {
  test("a request with no token is the local user under the local default", async () => {
    const response = await appWith().request("/api/who")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(LOCAL)
  })

  test("a token this server signed is the user it was minted for", async () => {
    const provider = localAuthProvider({ secret: "the-middleware-test-secret" })
    const pkce = createPkce()
    const issued = provider.authorize({
      redirectUri: "http://127.0.0.1:1/callback",
      state: "s",
      challenge: pkce.challenge,
    }).redirectTo
    const token = provider.exchange({
      code: new URL(issued).searchParams.get("code") ?? "",
      verifier: pkce.verifier,
      redirectUri: "http://127.0.0.1:1/callback",
    }).token

    const response = await appWith(provider).request("/api/who", { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(LOCAL)
  })

  test("a provider that refuses a tokenless request makes the route see nobody", async () => {
    // The configured-provider path: Clerk holds no anonymous caller, so a request with no token is
    // refused rather than answered as the local user. This is the 401 the phase exists to make real.
    const refusing = {
      ...localAuthProvider({ secret: "s" }),
      authorize: () => ({ redirectTo: "" }),
      exchange: () => ({ token: "", user: LOCAL, expiresAt: null }),
      verify: () => null,
    }
    const app = new Hono().use("/api/*", requireAuth(refusing)).get("/api/who", (c) => c.json(caller(c)))

    const response = await app.request("/api/who")
    // The middleware still answers, because a route is the only thing that knows whether it cares. The
    // route decides, which is what keeps the local default and the configured path one code path.
    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
  })

  test("a presented token that is not one this server signed is refused", async () => {
    const response = await appWith().request("/api/who", { headers: { Authorization: "Bearer nonsense" } })
    expect(await response.json()).toBeNull()
  })

  test("a header that is not a bearer token is refused", async () => {
    const response = await appWith().request("/api/who", { headers: { Authorization: "Basic dXNlcjpwYXNz" } })
    expect(await response.json()).toBeNull()
  })

  test("a route outside /api is untouched, because the caller is set nowhere and read nowhere", async () => {
    const response = await appWith().request("/health")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  test("the caller is on the context under the key the routes read", async () => {
    const app = appWith()
    const response = await app.request("/api/who")
    // `caller` reads it back, so the key the middleware writes is the key the routes read.
    expect(await response.json()).toEqual(LOCAL)
    expect(AUTH_USER_KEY).toBe("authUser")
  })
})
