import type { Message, Session, TokenUsage, User } from "@nightcode/shared"

/** Which implementation `createStore` picked, decided purely from the environment. */
export type StoreKind = "file" | "prisma"

/**
 * The on-disk document the file store reads and rewrites.
 *
 * It holds every table the Prisma schema defines so the two implementations stay swappable, even
 * though Phase 3 only writes sessions.
 */
export interface StoreDocument {
  version: 1
  users: User[]
  sessions: Session[]
  messages: Message[]
  tokenUsage: TokenUsage[]
}

/**
 * Rows as Postgres returns them, with Prisma's `Date` objects intact. Converting to the port's ISO
 * strings is the store's job, so a caller cannot tell which backend answered.
 */
export interface SessionRow {
  id: string
  userId: string
  title: string
  model: string
  createdAt: Date
  updatedAt: Date
}

export interface UserRow {
  id: string
  email: string
  createdAt: Date
  updatedAt: Date
}

/**
 * The slice of the generated Prisma client this package calls.
 *
 * The generated client is a build artifact under `packages/server/generated`, produced by the
 * package's own postinstall. It is never imported statically: `lib/db.ts` loads it lazily and adapts
 * it to this shape, so `bun run typecheck` and `bun test` pass in a tree that has never run
 * `bun install`, which is what `tools/verify-commits.sh` does to every commit.
 */
export interface PrismaDatabase {
  user: {
    upsert(input: { where: { id: string }; update: Record<string, never>; create: UserRow }): Promise<UserRow>
  }
  session: {
    create(input: { data: { id: string; userId: string; title: string; model: string } }): Promise<SessionRow>
    findUnique(input: { where: { id: string } }): Promise<SessionRow | null>
  }
}

export const EMPTY_DOCUMENT: StoreDocument = {
  version: 1,
  users: [],
  sessions: [],
  messages: [],
  tokenUsage: [],
}

/**
 * Identity the store allocates while there is no authenticated caller. Phase 6 replaces this, and
 * both stores need the same value so a row is reachable whichever backend answers.
 */
export const LOCAL_USER_ID = "local"
export const LOCAL_USER_EMAIL = "local@nightcode.dev"
