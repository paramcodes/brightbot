import { useCallback, useRef } from "react"

/**
 * Returns a stable callback that always runs the newest handler. Keeps responder effects from
 * re-registering on every render while still closing over fresh props.
 */
export function useLatest<T extends (...args: never[]) => unknown>(handler: T) {
  const latest = useRef(handler)
  latest.current = handler
  return useCallback((...args: Parameters<T>): ReturnType<T> => latest.current(...args) as ReturnType<T>, [])
}
