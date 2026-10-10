import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { FileStore } from "./file-store.js"
import { createStore, resolveStoreKind } from "./index.js"
import { PrismaStore } from "./prisma-store.js"
import type { MessageRow, PrismaDatabase, SessionRow } from "./types.js"

describe("store selection", () => {
  test("no DATABASE_URL selects the file store", () => {
    expect(resolveStoreKind({})).toBe("file")
    expect(resolveStoreKind({ DATABASE_URL: "" })).toBe("file")
  })

  test("a DATABASE_URL selects the prisma store", () => {
    expect(resolveStoreKind({ DATABASE_URL: "postgresql://localhost:5432/nightcode" })).toBe("prisma")
  })
})

describe("the process store", () => {
  test("without DATABASE_URL it is a file store that writes under NIGHTCODE_HOME", async () => {
    const originalUrl = process.env.DATABASE_URL
    const originalHome = process.env[NIGHTCODE_HOME_ENV]
    const home = mkdtempSync(join(tmpdir(), "nightcode-kind-test-"))
    delete process.env.DATABASE_URL
    process.env[NIGHTCODE_HOME_ENV] = home

    try {
      const store = await createStore()
      expect(store).toBeInstanceOf(FileStore)
      expect(store).not.toBeInstanceOf(PrismaStore)
      const session = await store.createSession({ title: "Selected by the environment", model: "m" })
      expect(session.userId).toBe("local")
      expect(await Bun.file(join(home, "store.json")).exists()).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
      if (originalUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = originalUrl
      if (originalHome === undefined) delete process.env[NIGHTCODE_HOME_ENV]
      else process.env[NIGHTCODE_HOME_ENV] = originalHome
    }
  })
})

describe("the prisma store", () => {
  /** What the store handed the database, so a test reads the listing's own contract and not a guess. */
  type FindManyCall = { orderBy?: { createdAt: "asc" | "desc" }; where?: { sessionId: string } }

  function fakeDatabase(): PrismaDatabase & {
    rows: SessionRow[]
    messages: MessageRow[]
    sessionFindMany: FindManyCall[]
    messageFindMany: FindManyCall[]
  } {
    const rows: SessionRow[] = []
    const messages: MessageRow[] = []
    const sessionFindMany: FindManyCall[] = []
    const messageFindMany: FindManyCall[] = []
    // The clock the database owns, one second per row in its own table. Rows sharing one timestamp would
    // make a sort on `createdAt` a stable-sort artefact rather than an ordering, and row zero in either
    // table stays at the epoch the tests below assert literally.
    const sessionClock = (): Date => new Date(Date.UTC(2026, 9, 9) + 1000 * rows.length)
    const messageClock = (): Date => new Date(Date.UTC(2026, 9, 9) + 1000 * messages.length)
    return {
      rows,
      messages,
      sessionFindMany,
      messageFindMany,
      user: {
        upsert: async (input) => input.create,
      },
      session: {
        create: async (input) => {
          const row: SessionRow = {
            id: input.data.id,
            userId: input.data.userId,
            title: input.data.title,
            model: input.data.model,
            createdAt: sessionClock(),
            updatedAt: sessionClock(),
          }
          rows.push(row)
          return row
        },
        findUnique: async (input) => rows.find((row) => row.id === input.where.id) ?? null,
        findMany: async (input) => {
          sessionFindMany.push(input ?? {})
          return [...rows].sort((one, two) => two.createdAt.getTime() - one.createdAt.getTime())
        },
      },
      message: {
        create: async (input) => {
          const row: MessageRow = {
            id: input.data.id,
            sessionId: input.data.sessionId,
            role: input.data.role,
            content: input.data.content,
            status: input.data.status,
            createdAt: messageClock(),
          }
          messages.push(row)
          return row
        },
        findMany: async (input) => {
          messageFindMany.push(input)
          return messages
            .filter((row) => row.sessionId === input.where.sessionId)
            .sort((one, two) => one.createdAt.getTime() - two.createdAt.getTime())
        },
      },
    }
  }

  test("a created session comes back with ISO strings, matching the port's shape", async () => {
    const store = new PrismaStore(fakeDatabase())

    const created = await store.createSession({ title: "Through Postgres", model: "claude-sonnet-5" })
    expect(created).toEqual({
      id: expect.any(String),
      userId: "local",
      title: "Through Postgres",
      model: "claude-sonnet-5",
      createdAt: "2026-10-09T00:00:00.000Z",
      updatedAt: "2026-10-09T00:00:00.000Z",
    })

    expect(await store.getSession(created.id)).toEqual(created)
  })

  test("an unknown id reads back as null rather than throwing", async () => {
    const store = new PrismaStore(fakeDatabase())
    expect(await store.getSession("missing")).toBe(null)
  })

  test("an appended message comes back with ISO strings and its own id", async () => {
    const database = fakeDatabase()
    const store = new PrismaStore(database)
    const session = await store.createSession({ title: "Through Postgres", model: "claude-sonnet-5" })

    const message = await store.appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: "a partial answer",
      status: "interrupted",
    })
    const second = await store.appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: "the rest",
      status: "complete",
    })

    expect(message).toEqual({
      id: expect.any(String),
      sessionId: session.id,
      role: "assistant",
      content: "a partial answer",
      status: "interrupted",
      createdAt: "2026-10-09T00:00:00.000Z",
    })
    expect(second.id).not.toBe(message.id)
    expect(database.messages.map((row) => row.status)).toEqual(["interrupted", "complete"])
  })

  test("listSessions asks for newest first and maps every row through the port's shape", async () => {
    const database = fakeDatabase()
    const store = new PrismaStore(database)
    const first = await store.createSession({ title: "First", model: "claude-sonnet-5" })
    const second = await store.createSession({ title: "Second", model: "gpt-5" })

    expect(await store.listSessions()).toEqual([
      { ...second, createdAt: "2026-10-09T00:00:01.000Z", updatedAt: "2026-10-09T00:00:01.000Z" },
      { ...first, createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" },
    ])
    expect(database.sessionFindMany).toEqual([{ orderBy: { createdAt: "desc" } }])
  })

  test("listMessages asks for one session's rows in arrival order, and returns none for another's", async () => {
    const database = fakeDatabase()
    const store = new PrismaStore(database)
    const one = await store.createSession({ title: "One", model: "claude-sonnet-5" })
    const two = await store.createSession({ title: "Two", model: "claude-sonnet-5" })
    const early = await store.appendMessage({ sessionId: one.id, role: "user", content: "first", status: "complete" })
    await store.appendMessage({ sessionId: two.id, role: "user", content: "not mine", status: "complete" })
    const late = await store.appendMessage({ sessionId: one.id, role: "assistant", content: "second", status: "complete" })

    expect(await store.listMessages(one.id)).toEqual([
      { ...early, createdAt: "2026-10-09T00:00:00.000Z" },
      { ...late, createdAt: "2026-10-09T00:00:02.000Z" },
    ])
    expect(await store.listMessages(two.id)).toHaveLength(1)
    expect(database.messageFindMany).toEqual([
      { where: { sessionId: one.id }, orderBy: { createdAt: "asc" } },
      { where: { sessionId: two.id }, orderBy: { createdAt: "asc" } },
    ])
  })
})
