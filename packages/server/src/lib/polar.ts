import { randomUUID } from "node:crypto"
import type { CreditCharge, CreditEntry, CreditLedger, TopUpResult } from "@nightcode/shared"
import { creditsFor, MODELS } from "@nightcode/shared"
import { z } from "zod"

/**
 * The Polar adapter: the credit ledger against a hosted organization.
 *
 * Selected by `POLAR_ACCESS_TOKEN`, exactly the way `DATABASE_URL` selects the Prisma store. It is
 * three REST calls over `fetch`, because `@polar-sh/sdk` would be a dependency that never runs on a
 * machine with no key. The request and response shapes below are Polar's own, read from the OpenAPI
 * schema for API version `2026-10`.
 */

/** The meter the operator creates in Polar. Its unit is a cent of model spend, which is a credit. */
export const USAGE_METER_NAME = "nightcode_usage"

const BASE_URLS = {
  production: "https://api.polar.sh",
  sandbox: "https://sandbox-api.polar.sh",
} as const

type PolarFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface PolarLedgerOptions {
  readonly accessToken: string
  readonly baseUrl?: string
  /** The product a top-up buys. Operator configuration, because product ids are per organization. */
  readonly productId?: string
  readonly request?: PolarFetch
}

const meterBalanceSchema = z.object({
  items: z.array(z.object({ balance: z.number() })),
})

const ingestResponseSchema = z.object({ inserted: z.number() })

const eventMetadataSchema = z.object({
  _llm: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
  sessionId: z.string().optional(),
  model: z.string().optional(),
  credits: z.number().optional(),
})

const eventListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      timestamp: z.string(),
      metadata: eventMetadataSchema.optional(),
    }),
  ),
})

const checkoutSchema = z.object({ url: z.string().min(1) })

/** A credit is a cent, which is the unit Polar quotes an event's cost in. */
function centsOf(credits: number): number {
  return Math.round(credits)
}

/**
 * A ledger whose answers come from someone else's servers.
 *
 * A call that fails throws rather than answering a zero, because the gate has to refuse a turn it
 * cannot price. A Polar outage therefore stops turns instead of handing them out for free.
 */
export function polarLedger(options: PolarLedgerOptions): CreditLedger {
  const base = options.baseUrl ?? BASE_URLS.production
  const request = options.request ?? fetch

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const response = await request(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
    })
    if (!response.ok) throw new Error(`Polar answered ${response.status} for ${path}`)
    return response.json()
  }

  return {
    async balance(userId: string): Promise<number> {
      const body = meterBalanceSchema.parse(await call(`/v1/customer-meters/?external_customer_id=${encodeURIComponent(userId)}`))
      return body.items[0]?.balance ?? 0
    },

    async record(charge: CreditCharge): Promise<CreditEntry> {
      const credits = creditsFor(charge.model, charge.usage)
      const entryId = randomUUID()
      const vendor = MODELS.find((option) => option.id === charge.model)?.provider ?? "unknown"
      const ingested = ingestResponseSchema.parse(
        await call("/v1/events/ingest", {
          method: "POST",
          body: JSON.stringify({
            events: [
              {
                name: USAGE_METER_NAME,
                external_customer_id: charge.userId,
                // The ledger's own id, so a retry of the same turn is a duplicate Polar drops rather
                // than a second charge.
                external_id: entryId,
                timestamp: new Date().toISOString(),
                metadata: {
                  _llm: {
                    vendor,
                    model: charge.model,
                    input_tokens: charge.usage.promptTokens,
                    output_tokens: charge.usage.completionTokens,
                    total_tokens: charge.usage.promptTokens + charge.usage.completionTokens,
                  },
                  _cost: { amount: centsOf(credits), currency: "usd" },
                  sessionId: charge.sessionId,
                  model: charge.model,
                  credits,
                },
              },
            ],
          }),
        }),
      )
      if (ingested.inserted === 0) throw new Error(`Polar dropped the charge for session ${charge.sessionId}`)
      return {
        id: entryId,
        userId: charge.userId,
        sessionId: charge.sessionId,
        model: charge.model,
        promptTokens: charge.usage.promptTokens,
        completionTokens: charge.usage.completionTokens,
        credits,
        createdAt: new Date().toISOString(),
      }
    },

    async recent(userId: string, limit: number): Promise<CreditEntry[]> {
      const query = new URLSearchParams({
        name: USAGE_METER_NAME,
        external_customer_id: userId,
        limit: String(limit),
        sorting: "-timestamp",
      })
      const body = eventListSchema.parse(await call(`/v1/events/?${query.toString()}`))
      return body.items.map((event) => ({
        id: event.id,
        userId,
        sessionId: event.metadata?.sessionId ?? "",
        model: event.metadata?.model ?? "unknown",
        promptTokens: event.metadata?._llm?.input_tokens ?? 0,
        completionTokens: event.metadata?._llm?.output_tokens ?? 0,
        credits: event.metadata?.credits ?? 0,
        createdAt: event.timestamp,
      }))
    },

    async topUp(userId: string): Promise<TopUpResult> {
      if (!options.productId) throw new Error("The Polar ledger needs POLAR_CHECKOUT_PRODUCT_ID to top up")
      const body = checkoutSchema.parse(
        await call("/v1/checkouts/", {
          method: "POST",
          body: JSON.stringify({ products: [options.productId], external_customer_id: userId }),
        }),
      )
      return { kind: "checkout", url: body.url }
    },
  }
}

export function polarLedgerFrom(environment: Record<string, string | undefined>, request?: PolarFetch): CreditLedger {
  const accessToken = environment.POLAR_ACCESS_TOKEN
  if (!accessToken) throw new Error("The Polar ledger needs POLAR_ACCESS_TOKEN")
  const server = environment.POLAR_SERVER === "sandbox" ? "sandbox" : "production"
  return polarLedger({
    accessToken,
    baseUrl: BASE_URLS[server],
    productId: environment.POLAR_CHECKOUT_PRODUCT_ID,
    request,
  })
}
