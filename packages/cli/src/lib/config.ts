import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { PREFERENCES_PATH } from "@nightcode/shared"
import { DEFAULT_THEME, isThemeName, type ThemeName } from "../styles/themes/index.js"

export type { ThemeName }

export interface Preferences {
  theme: ThemeName
  mode: string
  model: string
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: DEFAULT_THEME,
  mode: "plan",
  model: "claude-3-5-sonnet",
}

export interface ConfigStore {
  read(): Preferences
  update(patch: Partial<Preferences>): Preferences
  readonly path: string
}

export function openConfigStore(path: string = PREFERENCES_PATH()): ConfigStore {
  return {
    path,
    read: () => ({ ...DEFAULT_PREFERENCES, ...parsePreferences(readJson(path)) }),
    update(patch: Partial<Preferences>): Preferences {
      const next = { ...{ ...DEFAULT_PREFERENCES, ...parsePreferences(readJson(path)) }, ...parsePreferences(patch) }
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8")
      return next
    },
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

/**
 * The file is the only untrusted input in the app, so every field is type-checked here and an unknown
 * key is dropped rather than propagated.
 */
function parsePreferences(value: unknown): Partial<Preferences> {
  if (typeof value !== "object" || value === null) return {}
  const record = value as Record<string, unknown>
  const parsed: Partial<Preferences> = {}
  if (typeof record.theme === "string" && isThemeName(record.theme)) parsed.theme = record.theme
  if (typeof record.mode === "string") parsed.mode = record.mode
  if (typeof record.model === "string") parsed.model = record.model
  return parsed
}
