import type { Message, NewMessage, NewSession, Session, Store } from "@nightcode/shared"
import { createPrismaClient } from "../lib/db.js"
import { LOCAL_USER_EMAIL, LOCAL_USER_ID, type MessageRow, type PrismaDatabase, type SessionRow } from "./types.js"

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

  async listSessions(): Promise<Session[]> {
    const rows = await this.db.session.findMany({ orderBy: { createdAt: "desc" } })
    return rows.map(toSession)
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    const rows = await this.db.message.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } })
    return rows.map(toMessage)
  }

  async appendMessage(input: NewMessage): Promise<Message> {
    const row = await this.db.message.create({
      data: {
        id: crypto.randomUUID(),
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        status: input.status,
      },
    })
    return toMessage(row)
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

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }
}
