import { describe, expect, test } from "bun:test"
import { CREDIT_PROVIDER_KINDS, creditsFor, rateFor, resolveCreditProviderKind } from "../index.js"

describe("resolveCreditProviderKind", () => {
  test("an organization token selects Polar, and nothing else does", () => {
    expect(resolveCreditProviderKind({ POLAR_ACCESS_TOKEN: "polar_oat_x" })).toBe("polar")
    expect(resolveCreditProviderKind({})).toBe("local")
  })
})

describe("creditsFor", () => {
  test("a million tokens of each kind is the two published rates summed, expressed in credits", () => {
    // claude-sonnet-4-5 is 3 USD per million in and 15 per million out, and a credit is a cent.
    expect(creditsFor("claude-sonnet-4-5", { promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBe(1800)
  })

  test("a partial million is proportional", () => {
    expect(creditsFor("claude-sonnet-4-5", { promptTokens: 100_000, completionTokens: 0 })).toBe(30)
  })

  test("a model outside the catalog is charged at the most expensive row in it", () => {
    // gpt-5-pro is 15 in and 120 out, the top of the table, so a custom id is never under-billed.
    expect(rateFor("some-model-nobody-priced").outputPerMillion).toBe(120)
    expect(creditsFor("some-model-nobody-priced", { promptTokens: 1_000_000, completionTokens: 0 })).toBe(1500)
  })

  test("a turn that cost nothing is charged nothing", () => {
    expect(creditsFor("claude-haiku-4-5", { promptTokens: 0, completionTokens: 0 })).toBe(0)
  })
})

describe("the credit kinds", () => {
  test("local comes first, because it is the one that runs with no credentials", () => {
    expect(CREDIT_PROVIDER_KINDS[0]).toBe("local")
  })

  test("a credit is one cent", () => {
    // A turn charging the sonnet rate for 100k in and 50k out is 30 plus 75 credits, which is the
    // same 105 cents Polar would invoice, because a credit is a cent.
    expect(creditsFor("claude-sonnet-4-5", { promptTokens: 100_000, completionTokens: 50_000 })).toBe(105)
  })
})
