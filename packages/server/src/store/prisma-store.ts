import type { NewSession, Session, Store } from "@nightcode/shared"
import { createPrismaClient } from "../lib/db.js"
import { LOCAL_USER_EMAIL, LOCAL_USER_ID, type PrismaDatabase, type SessionRow } from "./types.js"

/**
 * The same port, backed by Postgres. Constructed only when `DATABASE_URL` is present, so nothing
 * reaches this module while the file store is selected.
 *
 * The client is injected rather than loaded here, so the store can be exercised against a stand-in
 * with no database and no network.
 */
export class PrismaStore implements Store {
  constructor(private readonly db: PrismaDatabase) {}

  async createSession(input: NewSession): Promise<Session> {
    const now = new Date()
    await this.db.user.upsert({
      where: { id: LOCAL_USER_ID },
      update: {},
      create: { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL, createdAt: now, updatedAt: now },
    })
    const row = await this.db.session.create({
      data: { id: crypto.randomUUID(), userId: LOCAL_USER_ID, title: input.title, model: input.model },
    })
    return toSession(row)
  }

  async getSession(id: string): Promise<Session | null> {
    const row = await this.db.session.findUnique({ where: { id } })
    return row === null ? null : toSession(row)
  }
}

export async function prismaStore(): Promise<Store> {
  return new PrismaStore(await createPrismaClient())
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
