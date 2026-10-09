import { describe, expect, test } from "bun:test"
import { app } from "./app.js"

describe("health", () => {
  test("reports ok without needing a database, a secret, or a network", async () => {
    const response = await app.request("/health")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  test("the server answers on the port Bun would bind it to", async () => {
    const server = Bun.serve({ port: 0, fetch: app.fetch })
    try {
      const response = await fetch(`http://localhost:${server.port}/health`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: "ok" })
    } finally {
      server.stop(true)
    }
  })
})
