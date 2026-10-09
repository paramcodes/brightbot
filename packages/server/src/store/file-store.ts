import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Message, NewMessage, NewSession, Session, Store } from "@nightcode/shared"
import { MESSAGE_STATUSES, ROLES, STORE_PATH } from "@nightcode/shared"
import { z } from "zod"
import { EMPTY_DOCUMENT, LOCAL_USER_EMAIL, LOCAL_USER_ID, type StoreDocument } from "./types.js"

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

const tokenUsageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  model: z.string().min(1),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  createdAt: timestamp,
})

const documentSchema = z.object({
  version: z.literal(1),
  users: z.array(userSchema),
  sessions: z.array(sessionSchema),
  messages: z.array(messageSchema),
  tokenUsage: z.array(tokenUsageSchema),
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

  async createSession(input: NewSession): Promise<Session> {
    return this.serialize(() => {
      const document = this.read()
      const now = new Date().toISOString()
      this.ensureLocalUser(document, now)
      const session: Session = {
        id: randomUUID(),
        userId: LOCAL_USER_ID,
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

  private ensureLocalUser(document: StoreDocument, now: string): void {
    if (document.users.some((user) => user.id === LOCAL_USER_ID)) return
    document.users.push({
      id: LOCAL_USER_ID,
      email: LOCAL_USER_EMAIL,
      createdAt: now,
      updatedAt: now,
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
