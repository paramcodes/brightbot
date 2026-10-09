import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatMessageStatus } from "../core/chat/types.js"

/** A turn is over the moment the run resolves, so its terminal status is the run's own answer. */
export type StreamRun = (signal: AbortSignal) => Promise<ChatMessageStatus>

export interface StreamHandlers {
  /**
   * The status the run ended as, delivered once. `submit` is synchronous and returns before the run
   * settles, so the detached caller cannot await the promise `start` hands back and needs this.
   */
  readonly onSettled: (status: ChatMessageStatus) => void
}

export interface ChatStream {
  readonly active: boolean
  readonly start: (run: StreamRun, handlers: StreamHandlers) => Promise<ChatMessageStatus>
  readonly abort: () => void
}

/**
 * Owns the abort of a running turn and nothing else.
 *
 * It never sees a `ChatFrame` and holds no messages, so the question "what does the server say" has
 * exactly one answer in the codebase and that answer is the session hook's.
 */
export function useChatStream(): ChatStream {
  const controllerRef = useRef<AbortController | null>(null)
  const [, rerender] = useState(0)

  useEffect(
    () => () => {
      controllerRef.current?.abort()
    },
    [],
  )

  const start = useCallback(async (run: StreamRun, handlers: StreamHandlers): Promise<ChatMessageStatus> => {
    // The controller is created here, in the caller's own tick, rather than after the first await. If it
    // only appeared once the session id had been fetched then `Esc` during that window would have nothing
    // to abort and the turn would hang on `streaming` with no way out.
    const controller = new AbortController()
    controllerRef.current = controller
    rerender((turns) => turns + 1)
    try {
      const status = await run(controller.signal)
      handlers.onSettled(status)
      return status
    } finally {
      // An earlier turn's tail must not clear a later turn's controller, so the identity decides.
      if (controllerRef.current === controller) {
        controllerRef.current = null
        rerender((turns) => turns + 1)
      }
    }
  }, [])

  const abort = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  return {
    get active() {
      // Read the controller rather than a render's snapshot of it. A snapshot is one tick stale, and
      // `submit` refuses on this, so two Enters landing in one batch would both be accepted.
      return controllerRef.current !== null
    },
    start,
    abort,
  }
}
