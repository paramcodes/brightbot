import type { Session } from "@nightcode/shared"
import { useEffect, useState } from "react"
import type { ChatTransport } from "../core/chat/transport.js"

export interface SessionHistory {
  readonly sessions: readonly Session[]
  readonly loading: boolean
  /** The server's own sentence, or null. Shown by the dialog rather than swallowed. */
  readonly error: string | null
  readonly reload: () => void
}

/**
 * The saved sessions, read through the transport on mount and again whenever `reload` is called.
 *
 * The transport is the only dependency: a hook that reached the api client directly would need a server
 * in every test that mounts the shell. One read over the list, and no per-session read, because the file
 * store parses the whole document on every call and a count beside each title would cost one parse per
 * session. The count is not something `Session` carries, and a turn's content is read on resume instead.
 */
export function useSessionHistory(transport: ChatTransport): SessionHistory {
  const [sessions, setSessions] = useState<readonly Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true)
    transport.listSessions().then(
      (listed) => {
        if (!live) return
        setSessions(listed)
        setError(null)
        setLoading(false)
      },
      (cause: unknown) => {
        if (!live) return
        setSessions([])
        setError(cause instanceof Error && cause.message.length > 0 ? cause.message : "The saved sessions could not be read")
        setLoading(false)
      },
    )
    return () => {
      live = false
    }
  }, [transport, attempt])

  return { sessions, loading, error, reload: () => setAttempt((count) => count + 1) }
}
