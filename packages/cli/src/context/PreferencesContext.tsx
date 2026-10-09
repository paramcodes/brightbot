import type { AgentMode } from "@nightcode/shared"
import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { openConfigStore, type Preferences } from "../lib/config.js"
import type { Theme } from "../styles/theme.js"
import { DEFAULT_THEME, THEMES, type ThemeName } from "../styles/themes/index.js"

export interface PreferencesApi {
  readonly theme: Theme
  readonly themeName: ThemeName
  readonly mode: AgentMode
  readonly model: string
  setTheme(name: ThemeName): void
  setMode(mode: AgentMode): void
  setModel(model: string): void
}

const PreferencesContext = createContext<PreferencesApi | null>(null)

/**
 * The one owner of every preference.
 *
 * The store instance is opened once, in a `useMemo`, because a second provider opening its own would
 * hold a second instance over the one file and a whole-file rewrite from each is two writers with no
 * ordering. One owner removes the sharing instead of serializing it.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const store = useMemo(() => openConfigStore(), [])
  const [preferences, setPreferences] = useState<Preferences>(() => store.read())

  const write = useCallback(
    (patch: Partial<Preferences>): void => {
      setPreferences((current) => {
        try {
          return store.update({ ...current, ...patch })
        } catch {
          // A read-only home must not take the app down; the choice still applies to this run.
          return { ...current, ...patch }
        }
      })
    },
    [store],
  )

  const setTheme = useCallback((name: ThemeName): void => write({ theme: name }), [write])
  const setMode = useCallback((mode: AgentMode): void => write({ mode }), [write])
  const setModel = useCallback((model: string): void => write({ model }), [write])

  const api = useMemo<PreferencesApi>(
    () => ({
      theme: THEMES[preferences.theme] ?? THEMES[DEFAULT_THEME],
      themeName: preferences.theme,
      mode: preferences.mode,
      model: preferences.model,
      setTheme,
      setMode,
      setModel,
    }),
    [preferences, setTheme, setMode, setModel],
  )

  return <PreferencesContext.Provider value={api}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesApi {
  const api = useContext(PreferencesContext)
  if (!api) throw new Error("usePreferences must be used inside PreferencesProvider")
  return api
}

/**
 * The render components read only the theme, so this is the same context read under the name they
 * already import. It returns the whole api rather than the `Theme` alone, because a `Theme` has no
 * `themeName` or `setTheme` to hand back.
 */
export function useTheme(): PreferencesApi {
  return usePreferences()
}
