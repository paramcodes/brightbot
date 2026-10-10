import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { createTokenSigner } from "./token.js"

const SECRET = "the-test-secret"

describe("createTokenSigner", () => {
  test("a signed round trips back to the claims it was built from", () => {
    const signer = createTokenSigner(SECRET)
    const token = signer.sign({ sub: "local", iat: 1_700_000_000_000 })

    const claims = signer.verify(token)
    expect(claims).toEqual({ sub: "local", iat: 1_700_000_000_000 })
  })

  test("a token signed with another secret is refused", () => {
    const mine = createTokenSigner(SECRET)
    const theirs = createTokenSigner("some-other-secret")
    const token = theirs.sign({ sub: "local", iat: 1 })

    expect(mine.verify(token)).toBeNull()
  })

  test("a tampered payload is refused, whatever it was changed to", () => {
    const signer = createTokenSigner(SECRET)
    const token = signer.sign({ sub: "local", iat: 1 })
    const separator = token.indexOf(".")
    const payload = token.slice(0, separator)
    const swapped = Buffer.from(payload, "base64url").toString("utf8").replace("local", "someone-else")
    const forged = `${Buffer.from(swapped, "utf8").toString("base64url")}.${token.slice(separator + 1)}`

    expect(signer.verify(forged)).toBeNull()
  })

  test("a string that is not a token is refused rather than throwing", () => {
    const signer = createTokenSigner(SECRET)
    expect(signer.verify("")).toBeNull()
    expect(signer.verify("nonsense")).toBeNull()
    expect(signer.verify("a.b.c")).toBeNull()
    expect(signer.verify(`${Buffer.from("not json").toString("base64url")}.anything`)).toBeNull()
  })

  test("a payload that is valid JSON but not claims is refused", () => {
    const signer = createTokenSigner(SECRET)
    const payload = Buffer.from(JSON.stringify({ sub: "local" }), "utf8").toString("base64url")
    // A signature over a payload with no `iat`, so the claims reader is what refuses it.
    const signature = createHmac("sha256", SECRET).update(payload).digest("base64url")
    expect(signer.verify(`${payload}.${signature}`)).toBeNull()
  })
})
