import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { apiClient } from "./api-client.js"

/**
 * The RPC contract is enforced by the compiler, and the type error below is the proof. It must keep
 * failing: if it ever stops, `tsc` reports an unused `@ts-expect-error` and the build breaks.
 */

type Client = typeof apiClient
type SessionPostArgs = Parameters<NonNullable<NonNullable<Client["api"]["sessions"]>["$post"]>>[0]

// @ts-expect-error the create-session payload needs a string title, not a number
const _wrongTitle: SessionPostArgs = { json: { title: 12 } }

let server: ReturnType<typeof Bun.serve>
let client: typeof apiClient

beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), "nightcode-rpc-test-"))
  process.env.NIGHTCODE_HOME = home
  const { app } = await import("../../../server/src/app.js")
  server = Bun.serve({ port: 0, fetch: app.fetch })
  process.env.NIGHTCODE_SERVER_URL = `http://localhost:${server.port}`
  ;({ apiClient: client } = await import("./api-client.js"))
})

afterAll(() => {
  server?.stop(true)
  delete process.env.NIGHTCODE_SERVER_URL
  delete process.env.NIGHTCODE_HOME
})

describe("api client", () => {
  test("a session created through the client reads back from the server", async () => {
    const created = await client.api.sessions.$post({
      json: { title: "Started from the CLI", model: "claude-sonnet-5" },
    })
    expect(created.status).toBe(201)
    const session = await created.json()

    const read = await client.api.sessions[":id"].$get({ param: { id: session.id } })
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual(session)
  })

  test("the health call returns the server's own health body", async () => {
    const health = await client.health.$get()
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: "ok" })
  })

  test("an unknown session is a 404 the client can see", async () => {
    const missing = await client.api.sessions[":id"].$get({ param: { id: "does-not-exist" } })
    expect(missing.status).toBe(404)
  })
})
