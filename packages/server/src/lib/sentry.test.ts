import { afterEach, describe, expect, test } from "bun:test"

const originalDsn = process.env.SENTRY_DSN
const { initSentry, reportError } = await import("./sentry.js")

afterEach(() => {
  if (originalDsn === undefined) delete process.env.SENTRY_DSN
  else process.env.SENTRY_DSN = originalDsn
})

describe("sentry", () => {
  test("with no DSN the module makes no network call at all", async () => {
    const realFetch = globalThis.fetch
    const requests: string[] = []
    globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
      requests.push(String(input))
      return realFetch(input)
    }) as typeof fetch

    try {
      delete process.env.SENTRY_DSN
      initSentry()
      reportError(new Error("this must go nowhere"))
      await new Promise((resolve) => setTimeout(resolve, 250))
    } finally {
      globalThis.fetch = realFetch
    }

    expect(requests).toEqual([])
  })

  test("with a DSN the failure reaches the configured endpoint", async () => {
    const received: string[] = []
    const sink = Bun.serve({
      port: 0,
      fetch: (request) => {
        received.push(request.url)
        return new Response("ok")
      },
    })
    const port = sink.port
    process.env.SENTRY_DSN = `http://publickey@127.0.0.1:${port}/42`

    try {
      initSentry()
      reportError(new Error("reported to a local sink"))
      await new Promise((resolve) => setTimeout(resolve, 500))
    } finally {
      sink.stop(true)
      delete process.env.SENTRY_DSN
    }

    expect(received).toEqual([`http://127.0.0.1:${port}/api/42/envelope/?sentry_version=7&sentry_key=publickey`])
  })
})
