import { describe, expect, test } from "bun:test"
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
