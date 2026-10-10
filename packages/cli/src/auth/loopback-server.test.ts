import { describe, expect, test } from "bun:test"
import { startLoopbackServer } from "./loopback-server.js"
import { createPkce, createState, PKCE_METHOD, sha256Base64url, verifierMatches } from "./pkce.js"

describe("createPkce", () => {
  test("the challenge is the verifier's own SHA-256, base64url encoded", () => {
    const pair = createPkce()
    expect(pair.method).toBe(PKCE_METHOD)
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43)
    // Unpadded base64url: no `+`, no `/`, and no `=` anywhere in either value.
    expect(pair.verifier).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(pair.challenge).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(pair.challenge).toBe(sha256Base64url(pair.verifier))
  })

  test("each pair is fresh, so a captured challenge does not answer to an old verifier", () => {
    const first = createPkce()
    const second = createPkce()
    expect(first.verifier).not.toBe(second.verifier)
    expect(first.challenge).not.toBe(second.challenge)
    expect(verifierMatches(first.challenge, second.verifier)).toBe(false)
  })

  test("a verifier matches its own challenge and nothing else", () => {
    const pair = createPkce()
    expect(verifierMatches(pair.challenge, pair.verifier)).toBe(true)
    expect(verifierMatches(pair.challenge, "not the verifier")).toBe(false)
    expect(verifierMatches("not a challenge", pair.verifier)).toBe(false)
  })

  test("the state is fresh and unguessable in the same shape", () => {
    expect(createState()).not.toBe(createState())
    expect(createState()).toMatch(/^[A-Za-z0-9\-_]+$/)
  })
})

async function get(port: number, path: string): Promise<Response> {
  return await fetch(`http://127.0.0.1:${port}${path}`)
}

describe("startLoopbackServer", () => {
  test("the callback resolves with the code and the state", async () => {
    const state = createState()
    const loopback = startLoopbackServer(state, { timeoutMs: 2000 })

    const response = await get(loopback.port, `/callback?code=the-code&state=${state}`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("close this tab")

    await expect(loopback.waitForCallback()).resolves.toEqual({ code: "the-code", state })
    loopback.stop()
  })

  test("one code per login, so a refreshed tab cannot start a second exchange", async () => {
    const state = createState()
    const loopback = startLoopbackServer(state, { timeoutMs: 2000 })
    const settled = loopback.waitForCallback()

    await get(loopback.port, `/callback?code=the-code&state=${state}`)
    await expect(settled).resolves.toEqual({ code: "the-code", state })

    const again = await get(loopback.port, `/callback?code=a-second-code&state=${state}`)
    expect(again.status).toBe(200)
    expect(await again.text()).toContain("already been completed")
    // The code the second callback carried was never handed to the login.
    await expect(Promise.race([settled, new Promise((resolve) => setTimeout(() => resolve("still settled"), 20))])).resolves.toEqual({
      code: "the-code",
      state,
    })
    loopback.stop()
  })

  test("the server is given a port of its own, so two logins do not collide", () => {
    const first = startLoopbackServer("one", { timeoutMs: 2000 })
    const second = startLoopbackServer("two", { timeoutMs: 2000 })
    expect(first.port).not.toBe(second.port)
    first.stop()
    second.stop()
  })

  test("stop closes the port, so nothing is answered once the login is over", async () => {
    const loopback = startLoopbackServer("the-real-state", { timeoutMs: 2000 })
    loopback.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(get(loopback.port, "/callback?code=x&state=the-real-state")).rejects.toThrow()
  })

  test("a callback with the wrong state is rejected, and the login fails", async () => {
    const loopback = startLoopbackServer("the-real-state", { timeoutMs: 2000 })
    const settled = loopback.waitForCallback()

    const response = await get(loopback.port, "/callback?code=the-code&state=someone-elses")
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("not for this login")

    await expect(settled).rejects.toThrow("The callback did not come from this login")
    loopback.stop()
  })

  test("a callback with no code is a 400 and leaves the login waiting", async () => {
    const loopback = startLoopbackServer("the-real-state", { timeoutMs: 2000 })
    const settled = loopback.waitForCallback()

    const response = await get(loopback.port, "/callback?state=the-real-state")
    expect(response.status).toBe(400)

    const code = await get(loopback.port, "/callback?code=late&state=the-real-state")
    expect(code.status).toBe(200)
    await expect(settled).resolves.toEqual({ code: "late", state: "the-real-state" })
    loopback.stop()
  })

  test("a path that is not the callback is a 404", async () => {
    const loopback = startLoopbackServer("the-real-state", { timeoutMs: 2000 })
    const response = await get(loopback.port, "/")
    expect(response.status).toBe(404)
    loopback.stop()
  })

  test("an abort cancels the login and the pending wait", async () => {
    const loopback = startLoopbackServer("the-real-state", { timeoutMs: 60_000 })
    const controller = new AbortController()
    const settled = loopback.waitForCallback({ signal: controller.signal })

    controller.abort()
    await expect(settled).rejects.toThrow("The login was cancelled")
  })

  test("the timeout cancels the login rather than hanging forever", async () => {
    const loopback = startLoopbackServer("the-real-state", { timeoutMs: 20 })
    await expect(loopback.waitForCallback()).rejects.toThrow("The login was cancelled")
  })
})
