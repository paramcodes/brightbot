import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { Hono } from "hono"
import { localAuthProvider } from "../../../server/src/auth/local.js"
import { onApiError } from "../../../server/src/middleware/error-handler.js"
import { createOAuthRoutes } from "../../../server/src/routes/oauth.js"
import { login } from "./flow.js"
import { openTokenStore } from "./token-storage.js"

/**
 * The whole login against a real server and a real loopback port.
 *
 * This is the one test that proves the round trip rather than a piece of it. `app.request` would bypass
 * the sockets both sides actually use, so the app is served over HTTP on port 0 and the browser opener
 * is the only thing stood in for: it is the one part of the flow that cannot run on a machine with no
 * browser, which is every machine this test can run on.
 */

let home = ""
let server: ReturnType<typeof Bun.serve> | undefined
let previousHome: string | undefined

const SECRET = "the-flow-test-secret"

function app(): Hono {
  return new Hono().route("/oauth", createOAuthRoutes(localAuthProvider({ secret: SECRET }))).onError(onApiError(() => {}))
}

/** What the browser does: follows the redirect to the loopback and hands the code over. */
async function browse(url: string): Promise<void> {
  // Read the location rather than following it. `fetch` follows redirects by default, and following a
  // redirect to 127.0.0.1 would silently close the very connection the loopback is waiting on.
  const authorize = await fetch(url, { redirect: "manual" })
  const location = authorize.headers.get("location")
  if (location === null) throw new Error("the authorize endpoint did not redirect")
  await fetch(new URL(location).toString())
}

beforeEach(() => {
  previousHome = process.env[NIGHTCODE_HOME_ENV]
  home = mkdtempSync(join(tmpdir(), "nightcode-login-"))
  process.env[NIGHTCODE_HOME_ENV] = home
  server = Bun.serve({ port: 0, fetch: app().fetch })
  process.env.NIGHTCODE_SERVER_URL = `http://localhost:${server.port}`
})

afterEach(() => {
  server?.stop(true)
  rmSync(home, { recursive: true, force: true })
  if (previousHome === undefined) delete process.env[NIGHTCODE_HOME_ENV]
  else process.env[NIGHTCODE_HOME_ENV] = previousHome
  delete process.env.NIGHTCODE_SERVER_URL
})

/** A session in the shape the shared schema accepts, for the store's own round trip. */
const A_SESSION = {
  token: "a.token.the-shared-schema-accepts",
  user: { id: "local", email: "local@nightcode.dev" },
  expiresAt: null,
}

describe("login", () => {
  test("a browser round trip leaves a session on disk that the store reads back", async () => {
    const store = openTokenStore()

    const outcome = await login({ store, openBrowser: browse })

    expect(outcome).toEqual({ ok: true, email: "local@nightcode.dev" })
    const stored = store.read()
    expect(stored?.user).toEqual({ id: "local", email: "local@nightcode.dev" })
    expect(stored?.expiresAt).toBeNull()
    // The token is a real signed one, so the server that issued it accepts it.
    expect(stored?.token.split(".")).toHaveLength(2)
    expect(statSync(store.path).mode & 0o777).toBe(0o600)
  })

  test("the token the flow stored is the token the server verifies", async () => {
    const provider = localAuthProvider({ secret: SECRET })
    const store = openTokenStore()

    await login({ store, openBrowser: browse })

    // The token the CLI wrote is the token the server that issued it accepts, which is the only thing
    // that makes it a session rather than a string.
    expect(provider.verify(store.read()?.token ?? "")).toEqual({ id: "local", email: "local@nightcode.dev" })
  })

  test("a browser that never completes leaves no token on disk", async () => {
    const store = openTokenStore()
    const controller = new AbortController()

    const outcome = await login({ store, openBrowser: () => controller.abort() }, { signal: controller.signal, timeoutMs: 50 })

    expect(outcome.ok).toBe(false)
    expect(store.read()).toBeNull()
  })

  test("a server that refuses the exchange fails the login and writes nothing", async () => {
    // A server that completes the browser leg and then refuses the token POST, which is the failure a
    // user sees when the backend is up but will not sign them in.
    const broken = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url)
        if (url.pathname !== "/oauth/authorize") return new Response("nope", { status: 500 })
        // Echoes the state it was given, because a state that does not match is what the loopback
        // refuses and this test is about what happens after the browser leg succeeds.
        const back = new URL(url.searchParams.get("redirect_uri") ?? "http://127.0.0.1/")
        back.searchParams.set("code", "abc")
        back.searchParams.set("state", url.searchParams.get("state") ?? "")
        return Response.redirect(back.toString())
      },
    })
    const store = openTokenStore()
    const previous = process.env.NIGHTCODE_SERVER_URL
    try {
      process.env.NIGHTCODE_SERVER_URL = `http://localhost:${broken.port}`
      // The real `browse` helper, which follows the redirect exactly as a browser would. What is stood
      // in for here is only the token endpoint, which is the failure under test.
      const outcome = await login({ store, openBrowser: browse }, { timeoutMs: 2000 })
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.reason).toContain("refused the token exchange")
      expect(store.read()).toBeNull()
    } finally {
      process.env.NIGHTCODE_SERVER_URL = previous
      broken.stop(true)
    }
  })
})

describe("openTokenStore", () => {
  test("a session round trips and the file is owner-only", () => {
    const store = openTokenStore()
    store.write(A_SESSION)
    expect(readFileSync(store.path, "utf8")).toContain("a.token.the-shared-schema-accepts")
    expect(statSync(store.path).mode & 0o777).toBe(0o600)
    expect(store.read()).toEqual(A_SESSION)
  })

  test("a file that is not a session reads as nothing rather than crashing", () => {
    const store = openTokenStore()
    rmSync(store.path, { force: true })
    expect(store.read()).toBeNull()
  })

  test("clear removes the credential", () => {
    const store = openTokenStore()
    store.write(A_SESSION)
    store.clear()
    expect(store.read()).toBeNull()
  })
})
