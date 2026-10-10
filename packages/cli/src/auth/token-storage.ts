import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { AuthSession } from "@nightcode/shared"
import { AUTH_PATH, authSessionSchema } from "@nightcode/shared"

/**
 * The credential on disk, and the permission it is written with.
 *
 * The file is the caller's own access token, so it is written atomically and held owner-only. A token
 * another local process can read is a token another local user can carry, which is the whole reason
 * this is its own module rather than a `writeFileSync` beside the login flow.
 */
export interface TokenStore {
  /** The stored session, or null when there is none or the file is not one we wrote. */
  read(): AuthSession | null
  write(session: AuthSession): AuthSession
  clear(): void
  readonly path: string
}

/** The one permission a credential is allowed to have. */
const OWNER_ONLY = 0o600

export function openTokenStore(path: string = AUTH_PATH()): TokenStore {
  return {
    path,
    read: () => parseSession(readJson(path)),
    write(session: AuthSession): AuthSession {
      // Parsed before it is written, so a session the shared schema does not describe never reaches
      // the disk and is not then read back as though it had.
      const parsed = authSessionSchema.parse(session)
      mkdirSync(dirname(path), { recursive: true })
      // Written to a sibling first, because a credential that is half-written when the process dies is
      // worse than the one it replaced.
      const temporary = `${path}.tmp`
      writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: OWNER_ONLY })
      // `renameSync` overwrites the target and keeps the target's own permissions, so the mode is set
      // again on the file that is actually left behind.
      renameSync(temporary, path)
      chmodSync(path, OWNER_ONLY)
      return parsed
    },
    clear: () => {
      try {
        rmSync(path, { force: true })
      } catch {
        // A credential that cannot be removed is one the user should know about, but refusing to sign
        // out would leave the CLI holding a token the user asked it to drop.
      }
    },
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function parseSession(value: unknown): AuthSession | null {
  const parsed = authSessionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
