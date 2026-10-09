import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { openConfigStore, type Preferences } from "../lib/config.js"
import type { Theme } from "../styles/theme.js"
import { DEFAULT_THEME, THEMES, type ThemeName } from "../styles/themes/index.js"

export interface ThemeApi {
  theme: Theme
  themeName: ThemeName
  setTheme: (name: ThemeName) => void
}

const ThemeContext = createContext<ThemeApi | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const store = useMemo(() => openConfigStore(), [])
  const [preferences, setPreferences] = useState<Preferences>(() => store.read())

  const setTheme = useCallback<ThemeApi["setTheme"]>(
    (themeName) => {
      setPreferences((current) => {
        try {
          return store.update({ ...current, theme: themeName })
        } catch {
          // A read-only home must not take the app down; the choice still applies to this run.
          return { ...current, theme: themeName }
        }
      })
    },
    [store],
  )

  const api = useMemo<ThemeApi>(
    () => ({ theme: THEMES[preferences.theme] ?? THEMES[DEFAULT_THEME], themeName: preferences.theme, setTheme }),
    [preferences.theme, setTheme],
  )

  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeApi {
  const api = useContext(ThemeContext)
  if (!api) throw new Error("useTheme must be used inside ThemeProvider")
  return api
}
