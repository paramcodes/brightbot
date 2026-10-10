import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * Proof Key for Code Exchange, as RFC 7636 defines it for a public client.
 *
 * A CLI cannot keep a secret, so the code it receives at the loopback is bound to a verifier only the
 * process that started the login holds. An attacker who reads the code off the wire still cannot
 * exchange it.
 *
 * This lives in `shared` rather than in the CLI because both ends need it: the client builds the
 * challenge and the server checks the verifier that answers it. Two implementations of the same hash
 * would be two chances for them to disagree.
 */
export const PKCE_METHOD = "S256"

export interface PkcePair {
  /** Kept in memory for the length of the login. Never leaves the process. */
  readonly verifier: string
  /** Sent in the authorize URL. Unusable without the verifier. */
  readonly challenge: string
  readonly method: typeof PKCE_METHOD
}

/** RFC 7636 allows 43 to 128 characters from this alphabet. */
const VERIFIER_BYTES = 32

export function base64url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function sha256Base64url(input: string): string {
  return base64url(createHash("sha256").update(input).digest())
}

export function createPkce(): PkcePair {
  const verifier = base64url(randomBytes(VERIFIER_BYTES))
  return { verifier, challenge: sha256Base64url(verifier), method: PKCE_METHOD }
}

/** Whether a verifier answers a challenge. Constant time, because a fast compare leaks the prefix. */
export function verifierMatches(challenge: string, verifier: string): boolean {
  const expected = Buffer.from(sha256Base64url(verifier))
  const presented = Buffer.from(challenge)
  return expected.length === presented.length && timingSafeEqual(expected, presented)
}

/** The CSRF token for the login: a fresh random string the callback must echo back unchanged. */
export function createState(): string {
  return base64url(randomBytes(VERIFIER_BYTES))
}
