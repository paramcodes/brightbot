import type { AuthUser, Message, NewMessage, NewSession, Session, Store, User } from "@nightcode/shared"
import { createPrismaClient } from "../lib/db.js"
import type { MessageRow, PrismaDatabase, SessionRow, UserRow } from "./types.js"

/**
 * The same port, backed by Postgres. Constructed only when `DATABASE_URL` is present, so nothing
 * reaches this module while the file store is selected.
 *
 * The client is injected rather than loaded here, so the store can be exercised against a stand-in
 * with no database and no network.
 */
export class PrismaStore implements Store {
  constructor(private readonly db: PrismaDatabase) {}

  async ensureUser(user: AuthUser): Promise<User> {
    const now = new Date()
    const row = await this.db.user.upsert({
      where: { id: user.id },
      update: {},
      create: { id: user.id, email: user.email, createdAt: now, updatedAt: now },
    })
    return toUser(row)
  }

  async createSession(input: NewSession): Promise<Session> {
    // `ensureUser` is the route's job, because a session for a caller who has never been seen is a
    // foreign key waiting to fail. This writes the row it was given and nothing else.
    const row = await this.db.session.create({
      data: { id: crypto.randomUUID(), userId: input.userId, title: input.title, model: input.model },
    })
    return toSession(row)
  }

  async getSession(id: string): Promise<Session | null> {
    const row = await this.db.session.findUnique({ where: { id } })
    return row === null ? null : toSession(row)
  }

  async listSessions(userId: string): Promise<Session[]> {
    const rows = await this.db.session.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })
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

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
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
