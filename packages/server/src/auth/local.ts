import type { AuthSession, AuthUser, ExchangeInput } from "@nightcode/shared"
import { verifierMatches } from "@nightcode/shared"
import {
  AuthError,
  AuthorizationCodes,
  createTokenSigner,
  isExpired,
  issueAuthorizationCode,
  LOCAL_USER,
  type TokenClaims,
} from "./token.js"

/**
 * The local identity provider: the default, and the one that runs with no credentials at all.
 *
 * It speaks the same OAuth round trip as any hosted provider, so the CLI's login flow is identical
 * whichever kind is configured. What is different is that the authorize endpoint issues a code
 * immediately and the token endpoint spends it, with no account, no password, and no network beyond
 * the loopback the user's own browser opened.
 */
export interface AuthorizeDecision {
  readonly redirectTo: string
}

export interface AuthProvider {
  /** Decides where the browser goes next. */
  authorize(input: { redirectUri: string; state: string; challenge: string }): AuthorizeDecision
  /** Spends a code and a verifier, and hands back the session the CLI keeps. */
  exchange(input: ExchangeInput): AuthSession
  /** Who a bearer token belongs to, or null when it is not a token this server issued. */
  verify(token: string): AuthUser | null
}

export interface LocalAuthOptions {
  /** Signs the tokens. Without one the server accepts a token anyone can forge, which is documented. */
  readonly secret?: string
  readonly now?: () => number
}

/**
 * The only redirect a login is allowed to come back to.
 *
 * The authorize endpoint would otherwise be an open redirector: a link that sends the browser to an
 * attacker's host with a fresh code attached. A loopback address is the one place a code can be
 * handed to the process that asked for it, so anything else is refused before a code exists.
 */
export function isLoopbackRedirect(redirectUri: string): boolean {
  let url: URL
  try {
    url = new URL(redirectUri)
  } catch {
    return false
  }
  if (url.protocol !== "http:") return false
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false
  return url.port.length > 0
}

export function localAuthProvider(options: LocalAuthOptions = {}): AuthProvider {
  const signer = createTokenSigner(options.secret ?? DEVELOPMENT_SECRET)
  const codes = new AuthorizationCodes()
  const now = options.now ?? Date.now

  return {
    authorize({ redirectUri, state, challenge }) {
      if (!isLoopbackRedirect(redirectUri)) throw new AuthError(400, "The redirect URI must be a loopback address")
      const code = issueAuthorizationCode({ challenge, redirectUri }, now())
      codes.add(code)
      const target = new URL(redirectUri)
      target.searchParams.set("code", code.code)
      target.searchParams.set("state", state)
      return { redirectTo: target.toString() }
    },
    exchange({ code, verifier, redirectUri }) {
      const issued = codes.take(code)
      if (!issued) throw new AuthError(400, "That code is not one this server issued")
      if (isExpired(issued, now())) throw new AuthError(400, "That code has expired. Run nightcode login again")
      // The code is bound to the redirect it was issued for, so a code captured in transit cannot be
      // spent against a different client.
      if (issued.redirectUri !== redirectUri) throw new AuthError(400, "That code was issued for a different redirect")
      if (!verifierMatches(issued.challenge, verifier)) throw new AuthError(400, "That verifier does not answer the challenge")
      const issuedAt = now()
      const token = signer.sign({ sub: LOCAL_USER.id, iat: issuedAt })
      return { token, user: LOCAL_USER, expiresAt: null }
    },
    verify(token) {
      const claims: TokenClaims | null = signer.verify(token)
      if (!claims) return null
      if (claims.sub !== LOCAL_USER.id) return null
      return LOCAL_USER
    },
  }
}

/**
 * The signing key used when none is configured.
 *
 * It is a real weakness and it is named as one rather than hidden: a server that is reachable by
 * anyone else and holds no `NIGHTCODE_AUTH_SECRET` accepts a token that anyone can forge. The local
 * default is meant for a machine where the caller is the operator, and Phase 9 refuses to boot in a
 * deployed state without one.
 */
export const DEVELOPMENT_SECRET = "nightcode-development-secret"
