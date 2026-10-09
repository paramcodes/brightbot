import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { FileStore } from "./file-store.js"

const originalHome = process.env[NIGHTCODE_HOME_ENV]
let home = ""

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nightcode-store-test-"))
  process.env[NIGHTCODE_HOME_ENV] = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env[NIGHTCODE_HOME_ENV]
  else process.env[NIGHTCODE_HOME_ENV] = originalHome
})

describe("file store", () => {
  test("a session written by one instance is readable by a fresh one", async () => {
    const first = new FileStore()
    const created = await first.createSession({ title: "Restart me", model: "claude-sonnet-5" })

    const second = new FileStore()
    const readBack = await second.getSession(created.id)

    expect(readBack).toEqual(created)
    expect(readBack?.title).toBe("Restart me")
  })

  test("the store file holds both the session and its owner", async () => {
    const store = new FileStore()
    await store.createSession({ title: "Inspect me", model: "claude-sonnet-5" })

    const document = JSON.parse(readFileSync(join(home, "store.json"), "utf8")) as Record<string, unknown>

    expect(document.version).toBe(1)
    expect(document.users).toEqual([
      {
        id: "local",
        email: "local@nightcode.dev",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ])
    expect(document.sessions).toEqual([
      {
        id: expect.any(String),
        userId: "local",
        title: "Inspect me",
        model: "claude-sonnet-5",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ])
    expect(document.messages).toEqual([])
    expect(document.tokenUsage).toEqual([])
  })

  test("a corrupt store file reads as empty instead of crashing", async () => {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(join(home, "store.json"), "{ this is not json")

    const store = new FileStore()
    expect(await store.getSession("anything")).toBe(null)
  })

  test("two sessions written in sequence both survive a fresh instance", async () => {
    const first = new FileStore()
    const one = await first.createSession({ title: "One", model: "m" })
    const two = await first.createSession({ title: "Two", model: "m" })

    const fresh = new FileStore()
    expect(await fresh.getSession(one.id)).toEqual(one)
    expect(await fresh.getSession(two.id)).toEqual(two)
  })
})
