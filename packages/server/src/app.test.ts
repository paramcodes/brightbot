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

describe("the OAuth surface, as the app mounts it", () => {
  test("an authorize request with a non-loopback redirect is refused with the API envelope", async () => {
    const query = new URLSearchParams({
      redirect_uri: "https://example.com/callback",
      state: "a-state",
      code_challenge: "a-challenge",
      code_challenge_method: "S256",
    }).toString()

    const response = await app.request(`/oauth/authorize?${query}`)
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe("BAD_REQUEST")
    expect(body.error.message).toContain("loopback")
  })

  test("a token request with a body that is not JSON never reaches the provider", async () => {
    const response = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { message: string } }
    expect(body.error.message).toContain("not JSON")
  })
})
