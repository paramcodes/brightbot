import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ApiErrorBody, ChatFrame, Session } from "@nightcode/shared"
import { chatFrameSchema, NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { Hono } from "hono"
import { app } from "../app.js"
import { localAuthProvider } from "../auth/local.js"
import type { Model, ModelEvent } from "../lib/ai.js"
import { requireAuth } from "../middleware/auth.js"
import { createChatRoute } from "./chat.js"

type StoreRow = { id: string; sessionId: string; role: string; content: string; status: string; createdAt: string }

const SECRET = "the-chat-test-secret"

const originalHome = process.env[NIGHTCODE_HOME_ENV]
const originalProvider = process.env.NIGHTCODE_MODEL_PROVIDER
const originalReply = process.env.NIGHTCODE_SCRIPTED_REPLY
const originalReasoning = process.env.NIGHTCODE_SCRIPTED_REASONING
const originalDelay = process.env.NIGHTCODE_SCRIPTED_DELAY_MS

let home = ""

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nightcode-chat-test-"))
  process.env[NIGHTCODE_HOME_ENV] = home
  process.env.NIGHTCODE_MODEL_PROVIDER = "scripted"
  process.env.NIGHTCODE_SCRIPTED_REPLY = "hello world"
  process.env.NIGHTCODE_SCRIPTED_REASONING = "thinking hard"
  process.env.NIGHTCODE_SCRIPTED_DELAY_MS = "1"
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  restore(NIGHTCODE_HOME_ENV, originalHome)
  restore("NIGHTCODE_MODEL_PROVIDER", originalProvider)
  restore("NIGHTCODE_SCRIPTED_REPLY", originalReply)
  restore("NIGHTCODE_SCRIPTED_REASONING", originalReasoning)
  restore("NIGHTCODE_SCRIPTED_DELAY_MS", originalDelay)
})

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

async function createSession(): Promise<Session> {
  const response = await app.request("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Chat", model: "scripted" }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as Session
}

async function withServer(handler: typeof app.fetch, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = Bun.serve({ port: 0, fetch: handler })
  try {
    await run(`http://localhost:${server.port}`)
  } finally {
    server.stop(true)
  }
}

function post(baseUrl: string, sessionId: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      messages: [{ role: "user", content: "hi there" }],
      system: "the system prompt the client chose",
    }),
    signal,
  })
}

async function collect(response: Response, onFrame?: (frame: ChatFrame) => void): Promise<ChatFrame[]> {
  const frames: ChatFrame[] = []
  const reader = response.body?.getReader()
  if (!reader) return frames
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const line = block.split("\n").find((entry) => entry.startsWith("data: "))
        if (line !== undefined) {
          const payload = line.slice("data: ".length)
          let frame: ChatFrame
          try {
            frame = chatFrameSchema.parse(JSON.parse(payload))
          } catch {
            throw new Error(`The wire carried a frame the shared schema does not describe: ${payload}`)
          }
          frames.push(frame)
          onFrame?.(frame)
        }
        boundary = buffer.indexOf("\n\n")
      }
    }
  } catch (error) {
    // The client aborted the fetch, which is what the abort tests do on purpose. Anything else, such as
    // a frame the shared schema rejects, is a failure this test is meant to see.
    if (!(error instanceof Error) || error.name !== "AbortError") throw error
  }
  return frames
}

function readRows(): StoreRow[] {
  const path = join(home, "store.json")
  if (!existsSync(path)) return []
  const document = JSON.parse(readFileSync(path, "utf8")) as { messages: StoreRow[] }
  return document.messages
}

/** The assistant row is written after the stream ends, so a finished fetch does not guarantee it landed. */
async function assistantRow(): Promise<StoreRow> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const row = readRows().find((candidate) => candidate.role === "assistant")
    if (row) return row
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("The assistant row was never persisted")
}

describe("POST /api/chat", () => {
  test("a turn streams every frame in order and persists both rows", async () => {
    const session = await createSession()

    await withServer(app.fetch, async (baseUrl) => {
      const response = await post(baseUrl, session.id)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/event-stream")

      expect(await collect(response)).toEqual([
        { type: "reasoning", text: "thinking " },
        { type: "reasoning", text: "hard" },
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
        { type: "finish" },
      ])
    })

    expect(readRows()).toEqual([
      {
        id: expect.any(String),
        sessionId: session.id,
        role: "user",
        content: "hi there",
        status: "complete",
        createdAt: expect.any(String),
      },
      {
        id: expect.any(String),
        sessionId: session.id,
        role: "assistant",
        content: "hello world",
        status: "complete",
        createdAt: expect.any(String),
      },
    ])
  })

  test("an abort mid-stream persists exactly the text that arrived, as interrupted", async () => {
    process.env.NIGHTCODE_SCRIPTED_DELAY_MS = "150"
    const session = await createSession()

    await withServer(app.fetch, async (baseUrl) => {
      const controller = new AbortController()
      const response = await post(baseUrl, session.id, controller.signal)
      const frames = await collect(response, (frame) => {
        if (frame.type === "text") controller.abort()
      })

      expect(frames).toEqual([
        { type: "reasoning", text: "thinking " },
        { type: "reasoning", text: "hard" },
        { type: "text", text: "hello " },
      ])
    })

    expect(await assistantRow()).toEqual({
      id: expect.any(String),
      sessionId: session.id,
      role: "assistant",
      content: "hello ",
      status: "interrupted",
      createdAt: expect.any(String),
    })
  })

  test("a provider failure writes the error frame and persists no assistant row", async () => {
    const session = await createSession()
    const failing: Model = {
      name: "failing",
      async *stream(): AsyncGenerator<ModelEvent> {
        yield { type: "text", text: "partial" }
        throw new Error("the provider exploded")
      },
    }
    // Mounted with the same auth middleware the real app uses, because the route now reads the
    // caller off the request context and a route mounted bare would answer as nobody.
    const failingApp = new Hono().use("/api/*", requireAuth(localAuthProvider({ secret: SECRET }))).route(
      "/api/chat",
      createChatRoute(() => failing),
    )

    await withServer(failingApp.fetch, async (baseUrl) => {
      const response = await post(baseUrl, session.id)
      expect(response.status).toBe(200)

      expect(await collect(response)).toEqual([
        { type: "text", text: "partial" },
        { type: "error", code: "MODEL_FAILED", message: "The model failed to answer this turn" },
      ])
    })

    expect(readRows()).toEqual([
      {
        id: expect.any(String),
        sessionId: session.id,
        role: "user",
        content: "hi there",
        status: "complete",
        createdAt: expect.any(String),
      },
    ])
  })

  test("a failure after the stream opened writes one chat frame, never a raw error block", async () => {
    const session = await createSession()
    // A model that breaks the store's path mid-turn, so writing the assistant row is what fails.
    const sabotaging: Model = {
      name: "sabotage",
      async *stream(): AsyncGenerator<ModelEvent> {
        rmSync(home, { recursive: true, force: true })
        writeFileSync(home, "not a directory")
        yield { type: "text", text: "partial" }
      },
    }
    const sabotagedApp = new Hono().use("/api/*", requireAuth(localAuthProvider({ secret: SECRET }))).route(
      "/api/chat",
      createChatRoute(() => sabotaging),
    )

    await withServer(sabotagedApp.fetch, async (baseUrl) => {
      const response = await post(baseUrl, session.id)
      expect(response.status).toBe(200)

      expect(await collect(response)).toEqual([
        { type: "text", text: "partial" },
        { type: "error", code: "STREAM_FAILED", message: "The stream failed" },
      ])
    })

    rmSync(home, { force: true })
  })

  test("a request with no system prompt is refused with the 400 envelope", async () => {
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "any", messages: [{ role: "user", content: "hi there" }] }),
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ApiErrorBody
    expect(body.error.code).toBe("BAD_REQUEST")
    expect(body.error.message).toContain("system")
  })

  test("the model is handed the system prompt the turn was sent with", async () => {
    const seen: string[] = []
    const capturing: Model = {
      name: "capturing",
      async *stream(request): AsyncGenerator<ModelEvent> {
        seen.push(request.system)
        yield { type: "text", text: "ok" }
      },
    }
    const session = await createSession()

    await withServer(
      new Hono().use("/api/*", requireAuth(localAuthProvider({ secret: SECRET }))).route(
        "/api/chat",
        createChatRoute(() => capturing),
      ).fetch,
      async (baseUrl) => {
        const response = await post(baseUrl, session.id)
        expect(response.status).toBe(200)
        await collect(response)
      },
    )

    expect(seen).toEqual(["the system prompt the client chose"])
  })

  test("a request whose last message is not the user's is refused with the 400 envelope", async () => {
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "any",
        messages: [{ role: "assistant", content: "not a turn" }],
        system: "the system prompt the client chose",
      }),
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ApiErrorBody
    expect(body.error.code).toBe("BAD_REQUEST")
    expect(body.error.message).toContain("The last message must come from the user")
  })

  test("an unknown session is refused with the 404 envelope", async () => {
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "missing",
        messages: [{ role: "user", content: "hi there" }],
        system: "the system prompt the client chose",
      }),
    })

    expect(response.status).toBe(404)
    const body = (await response.json()) as ApiErrorBody
    expect(body.error.code).toBe("NOT_FOUND")
    expect(body.error.message).toContain("missing")
  })

  test("an abort before any text still leaves the ask on the record", async () => {
    process.env.NIGHTCODE_SCRIPTED_REPLY = ""
    process.env.NIGHTCODE_SCRIPTED_DELAY_MS = "150"
    const session = await createSession()

    await withServer(app.fetch, async (baseUrl) => {
      const controller = new AbortController()
      const response = await post(baseUrl, session.id, controller.signal)
      const frames = await collect(response, (frame) => {
        if (frame.type === "reasoning") controller.abort()
      })

      expect(frames).toEqual([{ type: "reasoning", text: "thinking " }])
    })

    expect(readRows()).toEqual([
      {
        id: expect.any(String),
        sessionId: session.id,
        role: "user",
        content: "hi there",
        status: "complete",
        createdAt: expect.any(String),
      },
    ])
  })
})
