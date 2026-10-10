import { type AuthUser, LOCAL_USER } from "@nightcode/shared"
import type { TokenStore } from "./token-storage.js"

/**
 * Who the CLI is acting as, read from the credential on disk.
 *
 * A CLI that holds no token is the local user rather than nobody, which is what keeps `nightcode`
 * answering a prompt with no credentials at all, exactly as the server's local default does. The
 * store is the only source beyond that, so a sign-out in another terminal is reflected on the next
 * read rather than surviving until restart.
 */
export function currentUser(store: TokenStore): AuthUser {
  return store.read()?.user ?? LOCAL_USER
}

/** The bearer header for the current caller, or none when there is no caller to name. */
export function authorizationHeader(store: TokenStore): Record<string, string> {
  const token = store.read()?.token
  return token === undefined ? {} : { Authorization: `Bearer ${token}` }
}
