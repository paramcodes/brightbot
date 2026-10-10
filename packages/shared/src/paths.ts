import { homedir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV } from "./branding.js"

/**
 * Directory that holds every Night Code file the user owns: preferences, credentials, and the local
 * store. Overridable so tests and demo recordings never touch the real home directory.
 */
export function nightcodeHome(): string {
  return process.env[NIGHTCODE_HOME_ENV] ?? join(homedir(), ".nightcode")
}

export function pathInNightcodeHome(...segments: string[]): string {
  return join(nightcodeHome(), ...segments)
}

export const PREFERENCES_PATH = () => pathInNightcodeHome("preferences.json")
export const AUTH_PATH = () => pathInNightcodeHome("auth.json")
export const STORE_PATH = () => pathInNightcodeHome("store.json")
export const CREDITS_PATH = () => pathInNightcodeHome("credits.json")
