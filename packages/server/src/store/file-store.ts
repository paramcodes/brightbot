import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { AuthUser, Message, NewMessage, NewSession, Session, Store, User } from "@nightcode/shared"
import { MESSAGE_STATUSES, ROLES, STORE_PATH } from "@nightcode/shared"
import { z } from "zod"
import { EMPTY_DOCUMENT, type StoreDocument } from "./types.js"

const timestamp = z.string().datetime()

const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

const sessionSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  title: z.string(),
  model: z.string().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
})

const messageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: z.enum(ROLES),
  content: z.string(),
  status: z.enum(MESSAGE_STATUSES).default("complete"),
  createdAt: timestamp,
})

const documentSchema = z.object({
  version: z.literal(1),
  users: z.array(userSchema),
  sessions: z.array(sessionSchema),
  messages: z.array(messageSchema),
})

/**
 * JSON on disk under `NIGHTCODE_HOME`. The default store: no credentials, no database, no network.
 *
 * Every operation re-reads the file, so a second instance over the same path sees the first one's
 * writes. That is what makes "survives a restart" true by construction instead of depending on a
 * cache invalidation rule.
 */
export class FileStore implements Store {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly path?: string) {}

  private get storePath(): string {
    return this.path ?? STORE_PATH()
  }

  /**
   * One read-modify-write at a time. Two overlapping turns otherwise read the same snapshot and the
   * second `renameSync` clobbers the first, losing a row. The next link runs even when the previous
   * one failed, so a single bad write does not stall every request behind it.
   */
  private serialize<T>(operation: () => T): Promise<T> {
    const run = this.tail.then(operation)
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async ensureUser(user: AuthUser): Promise<User> {
    return this.serialize(() => {
      const document = this.read()
      const now = new Date().toISOString()
      const existing = document.users.find((candidate) => candidate.id === user.id)
      if (existing) return existing
      const row: User = { id: user.id, email: user.email, createdAt: now, updatedAt: now }
      document.users.push(row)
      this.write(document)
      return row
    })
  }

  async createSession(input: NewSession): Promise<Session> {
    return this.serialize(() => {
      const document = this.read()
      const now = new Date().toISOString()
      // The caller's own id, not a value this store allocates. A session belongs to whoever asked for
      // it, and `ensureUser` has already put their row in the document so the reference holds.
      const session: Session = {
        id: randomUUID(),
        userId: input.userId,
        title: input.title,
        model: input.model,
        createdAt: now,
        updatedAt: now,
      }
      document.sessions.push(session)
      this.write(document)
      return session
    })
  }

  async getSession(id: string): Promise<Session | null> {
    return this.read().sessions.find((session) => session.id === id) ?? null
  }

  /**
   * The file's own array order, reversed, scoped to one caller.
   *
   * Nothing here sorts, and the next reader must not "fix" it into one. `updatedAt` is written once at
   * create and never updated anywhere in the tree, so ordering by it is ordering by creation time under
   * a name that promises recency. `createdAt` is not unique either, because it is a millisecond ISO
   * string and two overlapping calls land on the same value, so a sort on it can swap two rows. The
   * array order is what the writes actually did, and its reverse is the truth.
   *
   * The filter is the same truth for the caller: a listing answers with this caller's rows and nothing
   * else, so a row that belongs to someone else is not in the answer rather than being hidden later.
   */
  async listSessions(userId: string): Promise<Session[]> {
    return [...this.read().sessions].reverse().filter((session) => session.userId === userId)
  }

  /**
   * Arrival order, because that is the order the transcript was written in.
   *
   * Filtering the one array keeps the order and scopes the rows to one session, which is the whole of a
   * read: it needs no queue. `serialize` exists so two read-modify-writes cannot clobber each other, and
   * a read that took the chain would queue behind a slow write for no correctness it could gain.
   */
  async listMessages(sessionId: string): Promise<Message[]> {
    return this.read().messages.filter((message) => message.sessionId === sessionId)
  }

  async appendMessage(input: NewMessage): Promise<Message> {
    return this.serialize(() => {
      const document = this.read()
      const message: Message = {
        id: randomUUID(),
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        status: input.status,
        createdAt: new Date().toISOString(),
      }
      document.messages.push(message)
      this.write(document)
      return message
    })
  }

  private read(): StoreDocument {
    let raw: string
    try {
      raw = readFileSync(this.storePath, "utf8")
      return documentSchema.parse(JSON.parse(raw))
    } catch {
      // A store that is missing, unparseable, or written by a newer shape reads as empty rather than
      // refusing to boot. Cloning matters because callers mutate the document they get back.
      return structuredClone(EMPTY_DOCUMENT)
    }
  }

  private write(document: StoreDocument): void {
    const path = this.storePath
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`)
    renameSync(temporary, path)
  }
}
