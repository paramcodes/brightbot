/**
 * The one HTTP request a login is completed by.
 *
 * The callback is the only part of a browser OAuth flow a terminal can receive, so it gets a server of
 * its own that answers exactly one code. Binding port `0` is what makes a second login on the same
 * machine work, and binding the loopback interface is what makes a request from anywhere else
 * impossible. `Bun.serve` is used rather than `node:http` because it reports the port it was given
 * synchronously, and the redirect URI has to be known before the browser is opened.
 */
export interface LoopbackCallback {
  readonly code: string
  readonly state: string
}

export interface LoopbackServer {
  /** The port the OS assigned. The redirect URI is built from it, so it is read before the browser goes. */
  readonly port: number
  readonly redirectUri: string
  /**
   * Resolves on the first callback whose `state` matches. Rejects when the state does not match, when
   * the request is aborted, or when the timeout elapses.
   *
   * It never closes the server. Closing it while the browser's page is still being written resets the
   * connection and the user sees a dead tab, so the caller closes the port once it has the code.
   */
  waitForCallback(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<LoopbackCallback>
  /** Idempotent. Frees the port and fails any wait still outstanding. */
  stop(): void
}

/**
 * What the browser is shown once the code has been taken.
 *
 * It is a page rather than a redirect because the user is holding a browser tab open and has to be
 * told the terminal has what it needs. Closing it is their own action, so nothing here is load-bearing.
 */
const PAGES = {
  done: `<!doctype html>
<title>nightcode</title>
<p>Signed in. You can close this tab and go back to the terminal.`,
  finished: `<!doctype html>
<title>nightcode</title>
<p>This login has already been completed. Run nightcode login again.`,
  notMine: `<!doctype html>
<title>nightcode</title>
<p>That link was not for this login. Run nightcode login again.`,
} as const

const HTML = { "content-type": "text/html" }
const TEXT = { "content-type": "text/plain" }
const DEFAULT_TIMEOUT_MS = 300_000

export function startLoopbackServer(expectedState: string, options: { timeoutMs?: number } = {}): LoopbackServer {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let resolveCallback: ((callback: LoopbackCallback) => void) | null = null
  let rejectCallback: ((reason: Error) => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let used = false

  const pending = new Promise<LoopbackCallback>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })
  // The login is allowed to be abandoned, and an abandoned login must not take the process down with
  // an unhandled rejection. `stop` always closes the server, so swallowing the failure here is safe.
  pending.catch(() => {})

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname !== "/callback") {
        return new Response("No route matches this request", { status: 404, headers: TEXT })
      }
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      if (code === null || state === null) {
        return new Response("The callback carried no code or no state", { status: 400, headers: TEXT })
      }
      if (state !== expectedState) {
        // Answered as a page rather than closed, so a user who followed a stale link is told why nothing
        // happened. The login itself still fails, because a mismatched state is a request from somewhere
        // else and the code it carries is not this login's. The failure is raised after the response is
        // on the wire: rejecting from inside the handler surfaces as a broken request in the browser.
        const wrongState = new Error("The callback did not come from this login")
        setTimeout(() => rejectCallback?.(wrongState), 0)
        return new Response(PAGES.notMine, { status: 200, headers: HTML })
      }
      // One code per login. A second callback is answered with a page that says so rather than being
      // handed a code again, which is what stops a refreshed tab from starting a second exchange.
      if (used) return new Response(PAGES.finished, { status: 200, headers: HTML })
      used = true
      resolveCallback?.({ code, state })
      return new Response(PAGES.done, { status: 200, headers: HTML })
    },
  })

  function stop(): void {
    if (stopped) return
    stopped = true
    if (timer !== null) clearTimeout(timer)
    server.stop(true)
    rejectCallback?.(new Error("The login was cancelled"))
  }

  return {
    port: server.port ?? 0,
    redirectUri: `http://127.0.0.1:${server.port ?? 0}/callback`,
    waitForCallback({ signal, timeoutMs = defaultTimeoutMs } = {}) {
      const onAbort = () => stop()
      signal?.addEventListener("abort", onAbort, { once: true })
      timer = setTimeout(stop, timeoutMs)
      return pending.finally(() => {
        if (timer !== null) clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
      })
    },
    stop,
  }
}
