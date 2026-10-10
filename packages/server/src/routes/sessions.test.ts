import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ApiErrorBody, Session } from "@nightcode/shared"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { app } from "../app.js"

const originalHome = process.env[NIGHTCODE_HOME_ENV]
const originalProvider = process.env.NIGHTCODE_MODEL_PROVIDER
const originalReply = process.env.NIGHTCODE_SCRIPTED_REPLY

let home = ""

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nightcode-sessions-test-"))
  process.env[NIGHTCODE_HOME_ENV] = home
  // The scripted provider, because the model id the route is handed maps to a real provider in the
  // catalog and a machine with no key would otherwise reach for one on every turn.
  process.env.NIGHTCODE_MODEL_PROVIDER = "scripted"
  process.env.NIGHTCODE_SCRIPTED_REPLY = "the scripted answer"
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env[NIGHTCODE_HOME_ENV]
  else process.env[NIGHTCODE_HOME_ENV] = originalHome
  if (originalProvider === undefined) delete process.env.NIGHTCODE_MODEL_PROVIDER
  else process.env.NIGHTCODE_MODEL_PROVIDER = originalProvider
  if (originalReply === undefined) delete process.env.NIGHTCODE_SCRIPTED_REPLY
  else process.env.NIGHTCODE_SCRIPTED_REPLY = originalReply
})

type StoredRow = { role: string; content: string; status: string; sessionId: string }

async function createSession(title: string): Promise<Session> {
  const response = await app.request("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, model: "claude-sonnet-4-5" }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as Session
}

/** One turn written by the route that owns it, so the rows are in the order the server actually wrote. */
async function ask(sessionId: string, content: string): Promise<void> {
  const response = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      messages: [{ role: "user", content }],
      system: "the system prompt the turn was sent with",
    }),
  })
  expect(response.status).toBe(200)
  // The assistant row is written after the stream ends, and a finished fetch does not guarantee the
  // write has landed, so the body is drained before the rows are read back.
  await new Response(response.body).text()
}

describe("GET /api/sessions", () => {
  test("a store with no sessions lists as empty", async () => {
    const response = await app.request("/api/sessions")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  test("two sessions list newest first", async () => {
    const first = await createSession("First written")
    const second = await createSession("Second written")

    const response = await app.request("/api/sessions")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([second, first])
  })

  test("a corrupt store file lists as empty rather than throwing", async () => {
    // `read()`'s committed behaviour: a store that cannot be parsed reads as empty rather than refusing
    // to boot. Asserted here so the listing cannot quietly become the first request that throws.
    writeFileSync(join(home, "store.json"), "{ this is not json")

    const response = await app.request("/api/sessions")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })
})

describe("GET /api/sessions/:id/messages", () => {
  test("a turn comes back in insertion order", async () => {
    const session = await createSession("Carries a turn")
    await ask(session.id, "what does this repo do")

    const response = await app.request(`/api/sessions/${session.id}/messages`)
    expect(response.status).toBe(200)
    const rows = (await response.json()) as StoredRow[]
    expect(rows.map((row) => [row.role, row.content])).toEqual([
      ["user", "what does this repo do"],
      ["assistant", "the scripted answer"],
    ])
    expect(rows.map((row) => row.sessionId)).toEqual([session.id, session.id])
  })

  test("a second session's turn never leaks into the first one's transcript", async () => {
    const mineSession = await createSession("Mine")
    const theirsSession = await createSession("Theirs")
    await ask(mineSession.id, "my question")
    await ask(theirsSession.id, "their question")

    const mine = (await (await app.request(`/api/sessions/${mineSession.id}/messages`)).json()) as StoredRow[]
    const theirs = (await (await app.request(`/api/sessions/${theirsSession.id}/messages`)).json()) as StoredRow[]

    expect(mine.map((row) => row.content)).toEqual(["my question", "the scripted answer"])
    expect(theirs.map((row) => row.content)).toEqual(["their question", "the scripted answer"])
  })

  test("an unknown session is refused with the 404 envelope, as GET /:id is", async () => {
    const response = await app.request("/api/sessions/missing/messages")
    expect(response.status).toBe(404)
    const body = (await response.json()) as ApiErrorBody
    expect(body.error.code).toBe("NOT_FOUND")
    expect(body.error.message).toContain("missing")
  })
})

describe("caller scoping", () => {
  test("a caller only ever lists their own sessions", async () => {
    // Both sessions are written with no token at all, which under the local default is the local user.
    // The proof that matters is the store's filter, so a row a different owner wrote is in the file
    // and is not in the listing.
    const mine = await createSession("Mine")
    const listed = (await (await app.request("/api/sessions")).json()) as Session[]
    expect(listed.map((session) => session.id)).toEqual([mine.id])
    expect(listed.every((session) => session.userId === "local")).toBe(true)
  })

  test("a session owned by another caller reads as missing", async () => {
    // A row written by someone else. The route answers 404 rather than 403, because a 403 would
    // confirm the id exists and the caller should learn nothing about it.
    writeFileSync(
      join(home, "store.json"),
      `${JSON.stringify({
        version: 1,
        users: [
          {
            id: "someone-else",
            email: "someone@example.com",
            createdAt: "2026-10-10T00:00:00.000Z",
            updatedAt: "2026-10-10T00:00:00.000Z",
          },
        ],
        sessions: [
          {
            id: "theirs",
            userId: "someone-else",
            title: "Not yours",
            model: "claude-sonnet-4-5",
            createdAt: "2026-10-10T00:00:00.000Z",
            updatedAt: "2026-10-10T00:00:00.000Z",
          },
        ],
        messages: [],
      })}\n`,
    )

    const read = await app.request("/api/sessions/theirs")
    expect(read.status).toBe(404)

    const transcript = await app.request("/api/sessions/theirs/messages")
    expect(transcript.status).toBe(404)

    const listed = (await (await app.request("/api/sessions")).json()) as Session[]
    expect(listed).toEqual([])
  })
})
