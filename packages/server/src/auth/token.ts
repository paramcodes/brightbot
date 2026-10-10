import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { AuthUser, ExchangeInput } from "@nightcode/shared"
import { ApiError } from "../middleware/error-handler.js"

/**
 * Who says a token belongs to whom, and how that claim is made unforgeable.
 *
 * The token is an HMAC over a JSON payload rather than an opaque random string, because a random
 * string is only a key into a session table and this server has no table to keep. The signature is
 * what makes the claim the caller's own, and a constant-time compare is what stops a timing probe
 * from recovering it a byte at a time.
 */
export interface TokenClaims {
  readonly sub: string
  readonly iat: number
}

export interface TokenSigner {
  sign(claims: TokenClaims): string
  verify(token: string): TokenClaims | null
}

export function createTokenSigner(secret: string): TokenSigner {
  return {
    sign(claims: TokenClaims): string {
      const payload = encodePayload(claims)
      return `${payload}.${signature(payload, secret)}`
    },
    verify(token: string): TokenClaims | null {
      const separator = token.indexOf(".")
      // A token is exactly two parts. Anything else, including a payload that itself holds a dot, is
      // not a token this signer produced.
      if (separator < 0) return null
      const payload = token.slice(0, separator)
      const presented = token.slice(separator + 1)
      // Compared before parsing, so a payload that is not JSON never reaches the claims reader.
      if (!equal(signature(payload, secret), presented)) return null
      return decodePayload(payload)
    },
  }
}

function encodePayload(claims: TokenClaims): string {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")
}

function decodePayload(payload: string): TokenClaims | null {
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<TokenClaims>
    if (typeof claims.sub !== "string" || typeof claims.iat !== "number") return null
    return { sub: claims.sub, iat: claims.iat }
  } catch {
    return null
  }
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url")
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * A single-use authorization code, remembered only until it is exchanged.
 *
 * The code is the one value that crosses the browser, so it is spendable exactly once and it dies
 * with the process. A server restart therefore invalidates a login that is halfway through the
 * browser round trip, and the user runs login again.
 */
export interface AuthorizationCode {
  readonly code: string
  readonly challenge: string
  readonly redirectUri: string
  readonly expiresAt: number
}

const CODE_TTL_MS = 300_000

export function issueAuthorizationCode(input: { challenge: string; redirectUri: string }, now = Date.now()): AuthorizationCode {
  return {
    code: base64url(randomBytes(32)),
    challenge: input.challenge,
    redirectUri: input.redirectUri,
    expiresAt: now + CODE_TTL_MS,
  }
}

export function isExpired(code: AuthorizationCode, now = Date.now()): boolean {
  return code.expiresAt <= now
}

/** The in-memory code store. One writer per process, so this needs no queue. */
export class AuthorizationCodes {
  private readonly codes = new Map<string, AuthorizationCode>()

  add(code: AuthorizationCode): void {
    this.codes.set(code.code, code)
  }

  take(code: string): AuthorizationCode | null {
    const found = this.codes.get(code)
    if (!found) return null
    this.codes.delete(code)
    return found
  }
}

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url")
}

/** The user every local token belongs to: one operator, one identity, no credentials to check. */
export const LOCAL_USER: AuthUser = { id: "local", email: "local@nightcode.dev" }

/**
 * A refusal an auth route raises, so it lands in the API's own envelope like every other one.
 *
 * It extends `ApiError` rather than standing beside it, because two error classes that both mean
 * "the caller is refused" would be two shapes for a client to branch on, and `ApiError` already
 * carries exactly the status and the sentence this needs.
 */
export class AuthError extends ApiError {
  constructor(status: number, message: string) {
    super(status, message)
    this.name = "AuthError"
  }
}

/**
 * The token request, read from an untrusted body.
 *
 * The field name is `redirect_uri`, because that is what an OAuth token endpoint carries and a client
 * posting camelCase would be posting to something that is not this endpoint. A missing field is a
 * 400, not a crash.
 */
export function exchangeInput(body: unknown): ExchangeInput {
  const record = body as Record<string, unknown>
  const code = record.code
  const verifier = record.verifier
  const redirectUri = record.redirect_uri
  if (typeof code !== "string" || typeof verifier !== "string" || typeof redirectUri !== "string") {
    throw new AuthError(400, "The token request is missing a field it needs")
  }
  return { code, verifier, redirectUri }
}
