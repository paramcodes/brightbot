import { z } from "zod"

/**
 * The two ends of Night Code's login, and the shapes that travel between them.
 *
 * A CLI cannot keep a secret and cannot render a login form, so the browser is sent straight to an
 * authorize endpoint and comes back to a loopback port with a code the CLI exchanges for a token.
 * The records below are the same on both sides of that round trip, which is why they live in `shared`
 * rather than in the package that happens to send them first.
 */

/**
 * Which identity provider answers a login.
 *
 * `local` is the default and runs with no credentials at all. `clerk` is selected by the presence of a
 * publishable key, the same way `resolveStoreKind` and `resolveModelKind` read the environment, so the
 * choice is a pure function a test can assert without a key.
 */
export const AUTH_PROVIDER_KINDS = ["local", "clerk"] as const

export type AuthProviderKind = (typeof AUTH_PROVIDER_KINDS)[number]

export function resolveAuthKind(environment: Record<string, string | undefined>): AuthProviderKind {
  return environment.CLERK_PUBLISHABLE_KEY ? "clerk" : "local"
}

/** Who a token says the caller is. `id` is what the store keys its rows by. */
export const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
})
export type AuthUser = z.infer<typeof authUserSchema>

/**
 * What the CLI keeps on disk and sends on every request.
 *
 * `expiresAt` is null rather than omitted because a token with no expiry and a token with an unknown
 * expiry are different things, and only one of them is representable.
 */
export const authSessionSchema = z.object({
  token: z.string().min(1),
  user: authUserSchema,
  expiresAt: z.string().datetime().nullable(),
})
export type AuthSession = z.infer<typeof authSessionSchema>

/** What the authorize URL carries. The challenge is the verifier's S256 digest, never the verifier. */
export interface AuthorizeInput {
  readonly redirectUri: string
  readonly state: string
  readonly challenge: string
}

/** What the token endpoint takes: the code from the loopback and the verifier that answers it. */
export interface ExchangeInput {
  readonly code: string
  readonly verifier: string
  readonly redirectUri: string
}

/** The token endpoint's own response, parsed before anything is written to disk. */
export const tokenResponseSchema = authSessionSchema
export type TokenResponse = z.infer<typeof tokenResponseSchema>

/**
 * The query both authorize URLs are built from. Shared so a parameter added to one is added to both,
 * rather than being the reason a Clerk login carries a field the local one never saw.
 */
export function authorizeQuery(input: AuthorizeInput): string {
  const query = new URLSearchParams({
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  })
  return query.toString()
}

/** Where the browser is sent, for the provider the environment selects. */
export function authorizeUrl(kind: AuthProviderKind, environment: Record<string, string | undefined>, input: AuthorizeInput): string {
  if (kind === "clerk") {
    const frontendApi = environment.CLERK_FRONTEND_API
    if (!frontendApi) throw new Error("CLERK_FRONTEND_API is required when Clerk signs a login in")
    return `https://${frontendApi}/oauth/authorize?${authorizeQuery(input)}`
  }
  return `${serverBaseUrl(environment)}/oauth/authorize?${authorizeQuery(input)}`
}

/** Where the code is exchanged. The CLI resolves this once per login, like every other base URL. */
export function tokenUrl(kind: AuthProviderKind, environment: Record<string, string | undefined>): string {
  if (kind === "clerk") {
    const frontendApi = environment.CLERK_FRONTEND_API
    if (!frontendApi) throw new Error("CLERK_FRONTEND_API is required when Clerk signs a login in")
    return `https://${frontendApi}/oauth/token`
  }
  return `${serverBaseUrl(environment)}/oauth/token`
}

function serverBaseUrl(environment: Record<string, string | undefined>): string {
  return environment.NIGHTCODE_SERVER_URL ?? "http://localhost:3000"
}
