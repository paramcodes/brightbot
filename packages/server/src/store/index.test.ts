import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { FileStore } from "./file-store.js"
import { createStore, resolveStoreKind } from "./index.js"
import { PrismaStore } from "./prisma-store.js"
import type { PrismaDatabase, SessionRow } from "./types.js"

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
  function fakeDatabase(): PrismaDatabase & { rows: SessionRow[] } {
    const rows: SessionRow[] = []
    return {
      rows,
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
            createdAt: new Date("2026-10-09T00:00:00.000Z"),
            updatedAt: new Date("2026-10-09T00:00:00.000Z"),
          }
          rows.push(row)
          return row
        },
        findUnique: async (input) => rows.find((row) => row.id === input.where.id) ?? null,
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
})
