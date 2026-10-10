import { describe, expect, test } from "bun:test"
import { polarLedger, USAGE_METER_NAME } from "./polar.js"

interface Recorded {
  url: string
  init?: RequestInit
  body: unknown
}

function stubFetch(answer: unknown): { calls: Recorded[]; request: (input: string, init?: RequestInit) => Promise<Response> } {
  const calls: Recorded[] = []
  return {
    calls,
    request: (input, init) => {
      calls.push({ url: input, init, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return Promise.resolve(Response.json(answer))
    },
  }
}

const CHARGE = {
  userId: "user-42",
  sessionId: "session-7",
  model: "claude-sonnet-4-5",
  usage: { promptTokens: 100_000, completionTokens: 50_000 },
}

describe("polarLedger", () => {
  test("a charge is ingested as a nightcode_usage event carrying the tokens and the cost in cents", async () => {
    const polar = stubFetch({ inserted: 1 })
    const ledger = polarLedger({ accessToken: "polar_oat_x", baseUrl: "https://polar.test", request: polar.request })

    const entry = await ledger.record(CHARGE)

    const [call] = polar.calls
    expect(call?.url).toBe("https://polar.test/v1/events/ingest")
    expect(call?.init?.method).toBe("POST")
    const headers = call?.init?.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer polar_oat_x")

    if (!call?.body) throw new Error("the ingest carried no body")
    const event = (call.body as { events: Record<string, unknown>[] }).events[0]
    expect(event).toMatchObject({
      name: USAGE_METER_NAME,
      external_customer_id: "user-42",
      external_id: entry.id,
      metadata: {
        _cost: { amount: 105, currency: "usd" },
        sessionId: "session-7",
        model: "claude-sonnet-4-5",
        credits: 105,
      },
    })
    expect(entry.credits).toBe(105)
  })
  test("a balance is the first customer meter's balance", async () => {
    const polar = stubFetch({ items: [{ balance: 4200 }] })
    const ledger = polarLedger({ accessToken: "polar_oat_x", baseUrl: "https://polar.test", request: polar.request })

    expect(await ledger.balance("user-42")).toBe(4200)
    expect(polar.calls[0]?.url).toBe("https://polar.test/v1/customer-meters/?external_customer_id=user-42")
  })

  test("a caller with no meter has no balance", async () => {
    const polar = stubFetch({ items: [] })
    const ledger = polarLedger({ accessToken: "polar_oat_x", baseUrl: "https://polar.test", request: polar.request })

    expect(await ledger.balance("user-42")).toBe(0)
  })

  test("a top-up creates a checkout session and hands back its url", async () => {
    const polar = stubFetch({ url: "https://polar.sh/checkout/abc" })
    const ledger = polarLedger({
      accessToken: "polar_oat_x",
      baseUrl: "https://polar.test",
      productId: "product-1",
      request: polar.request,
    })

    expect(await ledger.topUp("user-42")).toEqual({ kind: "checkout", url: "https://polar.sh/checkout/abc" })
    expect(polar.calls[0]?.body).toMatchObject({ products: ["product-1"], external_customer_id: "user-42" })
  })

  test("recent reads the ingested events back with the fields the dialog renders", async () => {
    const polar = stubFetch({
      items: [
        {
          id: "event-1",
          timestamp: "2026-10-10T00:00:00.000Z",
          metadata: {
            sessionId: "session-7",
            model: "claude-sonnet-4-5",
            credits: 105,
            _llm: { input_tokens: 100000, output_tokens: 50000 },
          },
        },
      ],
    })
    const ledger = polarLedger({ accessToken: "polar_oat_x", baseUrl: "https://polar.test", request: polar.request })

    expect(await ledger.recent("user-42", 10)).toEqual([
      {
        id: "event-1",
        userId: "user-42",
        sessionId: "session-7",
        model: "claude-sonnet-4-5",
        promptTokens: 100000,
        completionTokens: 50000,
        credits: 105,
        createdAt: "2026-10-10T00:00:00.000Z",
      },
    ])
    expect(polar.calls[0]?.url).toContain("/v1/events/?name=nightcode_usage")
  })

  test("an answer Polar refuses throws rather than reading as zero credits", async () => {
    const ledger = polarLedger({
      accessToken: "polar_oat_x",
      baseUrl: "https://polar.test",
      request: () => Promise.resolve(new Response("nope", { status: 503 })),
    })

    await expect(ledger.balance("user-42")).rejects.toThrow("Polar answered 503")
  })

  test("an ingest Polar accepted but dropped is a failed charge", async () => {
    const ledger = polarLedger({
      accessToken: "polar_oat_x",
      baseUrl: "https://polar.test",
      request: () => Promise.resolve(Response.json({ inserted: 0 })),
    })

    await expect(ledger.record(CHARGE)).rejects.toThrow("Polar dropped the charge")
  })
})
