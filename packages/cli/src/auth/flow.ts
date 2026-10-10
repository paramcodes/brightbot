import type { AuthSession } from "@nightcode/shared"
import {
  type AuthProviderKind,
  authorizeUrl,
  createPkce,
  createState,
  resolveAuthKind,
  tokenResponseSchema,
  tokenUrl,
} from "@nightcode/shared"
import { type LoopbackServer, startLoopbackServer } from "./loopback-server.js"
import type { TokenStore } from "./token-storage.js"

/**
 * What a login needs from the world around it.
 *
 * The browser opener is injected because the flow must run where there is no browser to open, which
 * is every test and every CI machine. Everything else is a real object.
 */
export interface LoginDependencies {
  readonly store: TokenStore
  /** Opens the authorize URL. Returns the URL, so a caller with no browser can print it instead. */
  readonly openBrowser: (url: string) => Promise<void> | void
  readonly environment?: Record<string, string | undefined>
}

export interface LoginOptions {
  /** Aborts the wait, which is how a login the user walked away from is given up. */
  readonly signal?: AbortSignal
  /** How long the login waits for the browser to come back. Defaults to five minutes. */
  readonly timeoutMs?: number
}

export type LoginOutcome = { readonly ok: true; readonly email: string } | { readonly ok: false; readonly reason: string }

/**
 * Signs the user in through the browser and keeps the token on disk.
 *
 * The order is what makes it safe. The PKCE pair and the state are made first, the loopback is started
 * second, and only then is the browser sent, so a redirect can never arrive at a port that is not
 * listening and a code can never be exchanged against a verifier that was not the one it was issued
 * for.
 */
export async function login(dependencies: LoginDependencies, options: LoginOptions = {}): Promise<LoginOutcome> {
  const environment = dependencies.environment ?? process.env
  const kind: AuthProviderKind = resolveAuthKind(environment)
  const pkce = createPkce()
  const state = createState()
  let loopback: LoopbackServer | undefined
  try {
    loopback = startLoopbackServer(state, { timeoutMs: options.timeoutMs })
    const url = authorizeUrl(kind, environment, {
      redirectUri: loopback.redirectUri,
      state,
      challenge: pkce.challenge,
    })
    await dependencies.openBrowser(url)

    const callback = await loopback.waitForCallback({ signal: options.signal })
    const session = await exchangeCode(kind, environment, {
      code: callback.code,
      verifier: pkce.verifier,
      redirectUri: loopback.redirectUri,
    })
    dependencies.store.write(session)
    return { ok: true, email: session.user.email }
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.message.length > 0 ? error.message : "The login could not be completed" }
  } finally {
    // Closed after the response has been written, which is why this is a `finally` and not part of
    // `waitForCallback`. See `loopback-server.ts`.
    loopback?.stop()
  }
}

async function exchangeCode(
  kind: AuthProviderKind,
  environment: Record<string, string | undefined>,
  input: { code: string; verifier: string; redirectUri: string },
): Promise<AuthSession> {
  const response = await fetch(tokenUrl(kind, environment), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: input.code, code_verifier: input.verifier, redirect_uri: input.redirectUri }),
  })
  if (!response.ok) throw new Error(`The server refused the token exchange (${response.status})`)
  const parsed = tokenResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error("The server's token response was not a session")
  return parsed.data
}
