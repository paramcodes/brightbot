import type { CreditUsage } from "@nightcode/shared"
import { useEffect, useState } from "react"
import type { ChatTransport } from "../core/chat/transport.js"

export interface CreditBalance {
  readonly balance: number
  readonly usage: CreditUsage | null
  readonly loading: boolean
  /** The server's own sentence, or null. Shown by the dialog rather than swallowed. */
  readonly error: string | null
  readonly reload: () => void
}

/**
 * The balance and the recent charges, read through the transport on mount and again on `reload`.
 *
 * The transport is the only dependency, for the same reason `useSessionHistory` has no other one: a
 * hook that reached the api client directly would need a server in every test that mounts the shell.
 */
export function useCreditBalance(transport: ChatTransport): CreditBalance {
  const [usage, setUsage] = useState<CreditUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true)
    transport.usage().then(
      (read) => {
        if (!live) return
        setUsage(read)
        setError(null)
        setLoading(false)
      },
      (cause: unknown) => {
        if (!live) return
        setUsage(null)
        setError(cause instanceof Error && cause.message.length > 0 ? cause.message : "The credit balance could not be read")
        setLoading(false)
      },
    )
    return () => {
      live = false
    }
  }, [transport, attempt])

  return { balance: usage?.balance ?? 0, usage, loading, error, reload: () => setAttempt((count) => count + 1) }
}
