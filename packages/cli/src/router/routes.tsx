import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react"

export type RoutePath = "/" | "/session"

export const ROUTES: Record<"home" | "session", RoutePath> = {
  home: "/",
  session: "/session",
}

export interface RouterApi {
  path: RoutePath
  navigate: (path: RoutePath) => void
}

const RouterContext = createContext<RouterApi | null>(null)

/**
 * A two-route memory router. react-router is not a dependency of this workspace and adding one is
 * outside this phase's scope, so the path type, the provider, and the route switch live here instead.
 * Migrating is one file: the consumers only see `path` and `navigate`.
 */
export function MemoryRouterProvider({ children, initial = ROUTES.home }: { children: ReactNode; initial?: RoutePath }) {
  const [path, setPath] = useState<RoutePath>(initial)
  const navigate = useCallback((next: RoutePath) => setPath(next), [])
  const api = useMemo<RouterApi>(() => ({ path, navigate }), [path, navigate])
  return <RouterContext.Provider value={api}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterApi {
  const api = useContext(RouterContext)
  if (!api) throw new Error("useRouter must be used inside MemoryRouterProvider")
  return api
}

/** Picks the view for the active route. */
export function RouteView({ home, session }: { home: ReactNode; session: ReactNode }) {
  const { path } = useRouter()
  return <>{path === ROUTES.home ? home : session}</>
}
