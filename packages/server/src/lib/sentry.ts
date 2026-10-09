import { BRAND } from "@nightcode/shared"
import {
  type BaseTransportOptions,
  Client,
  type ClientOptions,
  captureException,
  createTransport,
  dsnFromString,
  type Event,
  type EventHint,
  getEnvelopeEndpointWithUrlEncodedAuth,
  type ParameterizedString,
  type SeverityLevel,
  setCurrentClient,
  type TransportRequest,
} from "@sentry/core"

/**
 * `@sentry/core` ships no `init()` and no transport, and Night Code wants neither `@sentry/node` nor
 * `@sentry/bun`. So this file supplies the two missing pieces a server runtime needs and nothing else.
 *
 * Without `SENTRY_DSN` nothing here is constructed and `reportError` returns before it can reach a
 * network call, which is what keeps a default boot free of transport code.
 */
class ReportingClient extends Client {
  constructor(options: ClientOptions<BaseTransportOptions>) {
    super(options)
  }

  eventFromException(exception: unknown, _hint?: EventHint): PromiseLike<Event> {
    const isError = exception instanceof Error
    return Promise.resolve({
      exception: {
        values: [{ type: isError ? exception.name : "Error", value: isError ? exception.message : String(exception) }],
      },
    })
  }

  eventFromMessage(message: ParameterizedString, level?: SeverityLevel, _hint?: EventHint): PromiseLike<Event> {
    return Promise.resolve({ level, message })
  }
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  const parsed = dsnFromString(dsn)
  if (!parsed) throw new Error(`SENTRY_DSN could not be parsed: ${dsn}`)
  const endpoint = getEnvelopeEndpointWithUrlEncodedAuth(parsed)
  const client = new ReportingClient({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: `${BRAND.name}@${process.env.NIGHTCODE_VERSION ?? BRAND.version}`,
    integrations: [],
    stackParser: () => [],
    transport: () => createTransport({ recordDroppedEvent: () => {} }, (request) => sendEnvelope(endpoint, request)),
  })
  client.init()
  setCurrentClient(client)
}

/**
 * Sends a failure to Sentry when a DSN is configured. The caller passes the original error, never a
 * message, so the stack survives.
 */
export function reportError(cause: unknown): void {
  if (!process.env.SENTRY_DSN) return
  captureException(cause)
}

async function sendEnvelope(endpoint: string, request: TransportRequest) {
  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope" },
    body: request.body,
  })
  return { statusCode: 200 }
}
