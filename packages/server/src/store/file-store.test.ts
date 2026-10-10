import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthUser } from "@nightcode/shared"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { FileStore } from "./file-store.js"

const originalHome = process.env[NIGHTCODE_HOME_ENV]
let home = ""

/** Who the store sees as its caller. Every session is written for one of these two. */
const OWNER: AuthUser = { id: "local", email: "local@nightcode.dev" }
const SOMEBODY_ELSE: AuthUser = { id: "someone-else", email: "someone@example.com" }

function createAs(user: AuthUser, title: string, model = "m") {
  return new FileStore().createSession({ title, model, userId: user.id })
}

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
    const created = await first.createSession({ title: "Restart me", model: "claude-sonnet-5", userId: OWNER.id })

    const second = new FileStore()
    const readBack = await second.getSession(created.id)

    expect(readBack).toEqual(created)
    expect(readBack?.title).toBe("Restart me")
  })

  test("the store file holds both the session and its owner", async () => {
    const store = new FileStore()
    await store.createSession({ title: "Inspect me", model: "claude-sonnet-5", userId: OWNER.id })
    await store.ensureUser(OWNER)

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
    const one = await createAs(OWNER, "One")
    const two = await createAs(OWNER, "Two")

    const fresh = new FileStore()
    expect(await fresh.getSession(one.id)).toEqual(one)
    expect(await fresh.getSession(two.id)).toEqual(two)
  })

  test("an appended message is written with its status and survives a fresh instance", async () => {
    const store = new FileStore()
    const session = await createAs(OWNER, "Chat")

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

  test("listSessions on a store that holds nothing lists empty", async () => {
    expect(await new FileStore().listSessions(OWNER.id)).toEqual([])
  })

  test("listSessions is newest first, which is the file's own order reversed", async () => {
    const store = new FileStore()
    const one = await createAs(OWNER, "Written first")
    const two = await createAs(OWNER, "Written second")
    const three = await createAs(OWNER, "Written third")

    expect(await store.listSessions(OWNER.id)).toEqual([three, two, one])
  })

  test("listSessions is newest first even when every timestamp is the same value", async () => {
    // `createdAt` is a millisecond ISO string, so two overlapping calls can share one value and a sort on
    // it would swap two rows written in a known order. The file is written here rather than created, so
    // the collision is a fact of the fixture instead of a timing accident of this run.
    const written = [
      {
        id: "a",
        userId: "local",
        title: "Written first",
        model: "m",
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
      },
      {
        id: "b",
        userId: "local",
        title: "Written second",
        model: "m",
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
      },
    ]
    writeFileSync(
      join(home, "store.json"),
      `${JSON.stringify({ version: 1, users: [], sessions: written, messages: [], tokenUsage: [] })}\n`,
    )

    expect((await new FileStore().listSessions(OWNER.id)).map((session) => session.title)).toEqual(["Written second", "Written first"])
  })

  test("a read is not queued behind a write still in the chain", async () => {
    const store = new FileStore()
    const first = await createAs(OWNER, "First")

    // `createSession` defers its own read-modify-write to a microtask, and an async function body runs
    // synchronously to its first await, so this read strictly precedes that write. A `listSessions` that
    // took `serialize` would queue behind it and see the second session.
    const writing = createAs(OWNER, "Second")
    const listed = await store.listSessions(OWNER.id)
    await writing

    expect(listed).toEqual([first])
    expect(await store.listSessions(OWNER.id)).toEqual([await writing, first])
  })

  test("listMessages returns one session's transcript in arrival order", async () => {
    const store = new FileStore()
    const asked = await createAs(OWNER, "Asked")
    const other = await createAs(SOMEBODY_ELSE, "Other")
    const first = await store.appendMessage({ sessionId: asked.id, role: "user", content: "first", status: "complete" })
    await store.appendMessage({ sessionId: other.id, role: "user", content: "never leaked", status: "complete" })
    const second = await store.appendMessage({
      sessionId: asked.id,
      role: "assistant",
      content: "second",
      status: "interrupted",
    })

    expect(await store.listMessages(asked.id)).toEqual([first, second])
    expect(await store.listMessages(other.id)).toHaveLength(1)
    expect(await store.listMessages("never asked about")).toEqual([])
  })

  test("two overlapping appends both land", async () => {
    const store = new FileStore()
    const session = await createAs(OWNER, "Chat")

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
    const session = await createAs(OWNER, "Chat")
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
