import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useLatest } from "../useLatest.js"
import type { KeyInput, Responder, ResponderActions } from "./types.js"

const ActionsContext = createContext<ResponderActions | null>(null)
const StackContext = createContext<readonly Responder[]>([])

export function ResponderProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<readonly Responder[]>([])
  const stackRef = useRef(stack)
  stackRef.current = stack

  const register = useCallback((responder: Responder) => {
    setStack((current) => [...current.filter((entry) => entry.id !== responder.id), responder])
  }, [])

  const unregister = useCallback((id: string) => {
    setStack((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const dispatch = useCallback((input: KeyInput) => {
    for (let index = stackRef.current.length - 1; index >= 0; index -= 1) {
      const responder = stackRef.current[index]
      if (responder?.handleKey(input)) return true
    }
    return false
  }, [])

  return (
    <ActionsContext.Provider value={{ register, unregister, dispatch }}>
      <StackContext.Provider value={stack}>{children}</StackContext.Provider>
    </ActionsContext.Provider>
  )
}

export function useResponderActions(): ResponderActions {
  const actions = useContext(ActionsContext)
  if (!actions) throw new Error("useResponderActions must be used inside ResponderProvider")
  return actions
}

/** The live layer stack, top last. */
export function useResponderStack(): readonly Responder[] {
  return useContext(StackContext)
}

interface UseResponderOptions {
  enabled?: boolean
}

/**
 * Pushes a keyboard layer for as long as the calling component is mounted. `isTopLayer` tells the
 * caller whether it owns the keyboard right now, which is how a modal refuses input behind it.
 */
export function useResponder(id: string, handleKey: Responder["handleKey"], options: UseResponderOptions = {}) {
  const { enabled = true } = options
  const { register, unregister } = useResponderActions()
  const stack = useResponderStack()
  const handle = useLatest(handleKey)

  useEffect(() => {
    if (!enabled) return
    register({ id, handleKey: handle })
    return () => unregister(id)
  }, [id, enabled, register, unregister, handle])

  return { isTopLayer: stack[stack.length - 1]?.id === id }
}
