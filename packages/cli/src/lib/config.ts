import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { type AgentMode, isAgentMode, PREFERENCES_PATH } from "@nightcode/shared"
import { DEFAULT_THEME, isThemeName, type ThemeName } from "../styles/themes/index.js"

export type { ThemeName }

export interface Preferences {
  theme: ThemeName
  mode: AgentMode
  model: string
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: DEFAULT_THEME,
  mode: "plan",
  // Matches the Anthropic adapter's own default and a row of the shared model catalog, so the header's
  // model cell always names a model the picker can show and the provider can actually call.
  model: "claude-sonnet-4-5",
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
  // Guarded for the same reason as the theme: an unreadable file must not put a mode on screen that
  // no prompt and no switch branch knows about.
  if (typeof record.mode === "string" && isAgentMode(record.mode)) parsed.mode = record.mode
  if (typeof record.model === "string") parsed.model = record.model
  return parsed
}
