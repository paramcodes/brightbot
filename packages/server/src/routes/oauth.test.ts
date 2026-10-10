import { describe, expect, test } from "bun:test"
import type { AuthUser } from "@nightcode/shared"
import { Hono } from "hono"
import { createPkce, createState } from "../../../shared/src/pkce.js"
import { type AuthProvider, localAuthProvider } from "../auth/local.js"
import { AuthError } from "../auth/token.js"
import { onApiError } from "../middleware/error-handler.js"
import { createOAuthRoutes } from "./oauth.js"

const ROUTE = "/oauth"
const REDIRECT_URI = "http://127.0.0.1:54321/callback"

function appWith(provider: AuthProvider = localAuthProvider({ secret: "the-test-secret" })): Hono {
  return new Hono().route(ROUTE, createOAuthRoutes(provider)).onError((error) => {
    if (error instanceof AuthError) {
      return Response.json({ error: { code: "AUTH_FAILED", message: error.message } }, { status: error.status })
    }
    return onApiError(() => {})(error)
  })
}

async function authorize(app: Hono, query: Record<string, string>): Promise<Response> {
  const search = new URLSearchParams(query).toString()
  return await app.request(`${ROUTE}/authorize?${search}`)
}

async function token(app: Hono, body: Record<string, string>): Promise<Response> {
  return await app.request(`${ROUTE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

interface SessionBody {
  token: string
  user: AuthUser
  expiresAt: string | null
}

/** Follows the redirect by hand, so the code and the state come back off the URL rather than off a mock. */
function follow(response: Response): { code: string; state: string } {
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get("location") ?? "")
  return { code: location.searchParams.get("code") ?? "", state: location.searchParams.get("state") ?? "" }
}

async function message(response: Response): Promise<string> {
  return ((await response.json()) as { error: { message: string } }).error.message
}

describe("POST /oauth/token, over a real authorize round trip", () => {
  test("a code answers only to the verifier that produced its challenge", async () => {
    const provider = localAuthProvider({ secret: "the-test-secret" })
    const app = appWith(provider)
    const pkce = createPkce()
    const state = createState()

    const issued = follow(
      await authorize(app, { redirect_uri: REDIRECT_URI, state, code_challenge: pkce.challenge, code_challenge_method: "S256" }),
    )
    expect(issued.code.length).toBeGreaterThan(0)
    expect(issued.state).toBe(state)

    const response = await token(app, { code: issued.code, code_verifier: pkce.verifier, redirect_uri: REDIRECT_URI })
    expect(response.status).toBe(200)
    const session = (await response.json()) as SessionBody
    expect(session.user).toEqual({ id: "local", email: "local@nightcode.dev" })
    // No expiry, because there is no refresh flow to renew one and a session that dies mid-turn with
    // no way back is worse than a session the user signs out of.
    expect(session.expiresAt).toBeNull()

    // The token the exchange handed back is the token the provider recognises, which is the only
    // thing that makes the token a session rather than a string.
    expect(provider.verify(session.token)).toEqual({ id: "local", email: "local@nightcode.dev" })
  })

  test("the same code cannot be spent twice", async () => {
    const app = appWith()
    const pkce = createPkce()
    const state = createState()
    const issued = follow(
      await authorize(app, { redirect_uri: REDIRECT_URI, state, code_challenge: pkce.challenge, code_challenge_method: "S256" }),
    )

    expect((await token(app, { code: issued.code, code_verifier: pkce.verifier, redirect_uri: REDIRECT_URI })).status).toBe(200)
    const again = await token(app, { code: issued.code, code_verifier: pkce.verifier, redirect_uri: REDIRECT_URI })
    expect(again.status).toBe(400)
    expect(await message(again)).toContain("not one this server issued")
  })

  test("a verifier that does not answer the challenge is refused", async () => {
    const app = appWith()
    const pkce = createPkce()
    const state = createState()
    const issued = follow(
      await authorize(app, { redirect_uri: REDIRECT_URI, state, code_challenge: pkce.challenge, code_challenge_method: "S256" }),
    )

    const other = createPkce()
    const response = await token(app, { code: issued.code, code_verifier: other.verifier, redirect_uri: REDIRECT_URI })
    expect(response.status).toBe(400)
    expect(await message(response)).toContain("does not answer the challenge")
  })

  test("a code issued for one redirect cannot be spent against another", async () => {
    const app = appWith()
    const pkce = createPkce()
    const state = createState()
    const issued = follow(
      await authorize(app, { redirect_uri: REDIRECT_URI, state, code_challenge: pkce.challenge, code_challenge_method: "S256" }),
    )

    const response = await token(app, { code: issued.code, code_verifier: pkce.verifier, redirect_uri: "http://127.0.0.1:65432/callback" })
    expect(response.status).toBe(400)
    expect(await message(response)).toContain("different redirect")
  })

  test("a body that is missing a field is a 400 rather than a crash", async () => {
    const app = appWith()
    const response = await token(app, { code: "a-code" })
    expect(response.status).toBe(400)
    expect(await message(response)).toContain("missing a field")
  })

  test("a body that is not JSON is a 400", async () => {
    const app = appWith()
    const response = await app.request(`${ROUTE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })
    expect(response.status).toBe(400)
    expect(await message(response)).toContain("not JSON")
  })
})

describe("GET /oauth/authorize", () => {
  test("the redirect URI must be a loopback address", async () => {
    const app = appWith()
    const pkce = createPkce()
    const state = createState()
    const query = { state, code_challenge: pkce.challenge, code_challenge_method: "S256" }

    // A non-loopback host would make this endpoint an open redirector with a fresh code attached. The
    // third case is a loopback host with no port, which is not an address the loopback server holds.
    for (const redirectUri of ["https://example.com/callback", "http://example.com:1234/callback", "http://127.0.0.1/callback"]) {
      const response = await authorize(app, { ...query, redirect_uri: redirectUri })
      expect(response.status).toBe(400)
      expect(await message(response)).toContain("loopback")
    }

    expect((await authorize(app, { ...query, redirect_uri: "http://localhost:54321/callback" })).status).toBe(302)
  })

  test("a missing parameter is a 400 rather than a redirect to nowhere", async () => {
    const app = appWith()
    const response = await authorize(app, { state: "a-state", code_challenge: "a-challenge" })
    expect(response.status).toBe(400)
    expect(await message(response)).toContain("missing a parameter")
  })

  test("a plain challenge method is refused, because it is the downgrade PKCE exists to stop", async () => {
    const app = appWith()
    const pkce = createPkce()
    const response = await authorize(app, {
      redirect_uri: REDIRECT_URI,
      state: createState(),
      code_challenge: pkce.challenge,
      code_challenge_method: "plain",
    })
    expect(response.status).toBe(400)
    expect(await message(response)).toContain("S256")
  })
})

describe("token verification", () => {
  test("a request with no token is the local user, because the local default runs with no credentials", () => {
    const provider = localAuthProvider({ secret: "the-test-secret" })
    expect(provider.verify(null)).toEqual({ id: "local", email: "local@nightcode.dev" })
    expect(provider.verify("")).toEqual({ id: "local", email: "local@nightcode.dev" })
  })

  test("a token signed with another secret is not one this server issued", () => {
    const mine = localAuthProvider({ secret: "the-test-secret" })
    const theirs = localAuthProvider({ secret: "some-other-secret" })
    const pkce = createPkce()
    const state = createState()
    const issued = theirs.authorize({ redirectUri: REDIRECT_URI, state, challenge: pkce.challenge }).redirectTo
    const token = theirs.exchange({
      code: new URL(issued).searchParams.get("code") ?? "",
      verifier: pkce.verifier,
      redirectUri: REDIRECT_URI,
    }).token

    expect(mine.verify(token)).toBeNull()
  })

  test("a token that is presented but is not a token at all is refused", () => {
    const provider = localAuthProvider({ secret: "the-test-secret" })
    // The distinction that matters: no token is the local caller, and a token that is not one this
    // server signed is refused. An empty header and a malformed one are not the same thing.
    expect(provider.verify("nonsense")).toBeNull()
    expect(provider.verify("a.b.c")).toBeNull()
  })
})
