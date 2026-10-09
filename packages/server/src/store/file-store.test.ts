import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

  test("an appended message is written with its status and survives a fresh instance", async () => {
    const store = new FileStore()
    const session = await store.createSession({ title: "Chat", model: "m" })

    const message = await store.appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: "a partial answer",
      status: "interrupted",
    })

    expect(message).toEqual({
      id: expect.any(String),
      sessionId: session.id,
      role: "assistant",
      content: "a partial answer",
      status: "interrupted",
      createdAt: expect.any(String),
    })
    expect((await new FileStore().getSession(session.id))?.id).toBe(session.id)

    const document = JSON.parse(readFileSync(join(home, "store.json"), "utf8")) as { messages: unknown[] }
    expect(document.messages).toEqual([message])
  })

  test("two overlapping appends both land", async () => {
    const store = new FileStore()
    const session = await store.createSession({ title: "Chat", model: "m" })

    const first = store.appendMessage({ sessionId: session.id, role: "user", content: "one", status: "complete" })
    const second = store.appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: "two",
      status: "complete",
    })
    const [one, two] = await Promise.all([first, second])

    expect([one.content, two.content]).toEqual(["one", "two"])
    expect(one.id).not.toBe(two.id)

    const document = JSON.parse(readFileSync(join(home, "store.json"), "utf8")) as {
      messages: { content: string }[]
      sessions: { id: string }[]
    }
    expect(document.messages.map((message) => message.content)).toEqual(["one", "two"])
    expect(document.sessions.map((sessionRow) => sessionRow.id)).toEqual([session.id])
  })

  test("a rejected write leaves the queue draining instead of wedging it", async () => {
    const store = new FileStore()
    const session = await store.createSession({ title: "Chat", model: "m" })
    // A file where the store's directory belongs makes the write's `mkdirSync` throw.
    rmSync(home, { recursive: true, force: true })
    writeFileSync(home, "not a directory")

    const first = store.appendMessage({
      sessionId: session.id,
      role: "user",
      content: "lost",
      status: "complete",
    })
    const second = store.appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: "also lost",
      status: "interrupted",
    })

    // A chain that only advances on success would leave the second call pending forever.
    const settled = await Promise.allSettled([first, second])
    expect(settled.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"])
  })
})
