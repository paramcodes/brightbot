import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV, PREFERENCES_PATH } from "@nightcode/shared"
import { DEFAULT_PREFERENCES, openConfigStore, type Preferences } from "./config.js"

let home: string
let previousHome: string | undefined

function seed(raw: string): string {
  const path = PREFERENCES_PATH()
  mkdirSync(home, { recursive: true })
  writeFileSync(path, raw, "utf8")
  return path
}

beforeEach(() => {
  previousHome = process.env[NIGHTCODE_HOME_ENV]
  home = mkdtempSync(join(tmpdir(), "nightcode-config-"))
  process.env[NIGHTCODE_HOME_ENV] = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  if (previousHome === undefined) delete process.env[NIGHTCODE_HOME_ENV]
  else process.env[NIGHTCODE_HOME_ENV] = previousHome
})

describe("config store", () => {
  test("preferences.json defaults to ~/.nightcode/preferences.json", () => {
    delete process.env[NIGHTCODE_HOME_ENV]
    expect(PREFERENCES_PATH()).toBe(join(homedir(), ".nightcode", "preferences.json"))
  })

  test("a missing file yields the defaults", () => {
    expect(openConfigStore().read()).toEqual(DEFAULT_PREFERENCES)
  })

  test("a written value survives a fresh store instance", () => {
    const written = openConfigStore().update({ theme: "monokai" })
    expect(written.theme).toBe("monokai")
    expect(openConfigStore().read()).toEqual({ ...DEFAULT_PREFERENCES, theme: "monokai" })
  })

  test("a partial file merges over the defaults", () => {
    seed(JSON.stringify({ model: "gpt-4o" }))
    expect(openConfigStore().read()).toEqual({ ...DEFAULT_PREFERENCES, model: "gpt-4o" })
  })

  test("an unknown key is dropped and nothing crashes", () => {
    seed(JSON.stringify({ theme: "nightfox", somethingElse: [1, 2, 3] }))
    expect(openConfigStore().read()).toEqual({ ...DEFAULT_PREFERENCES, theme: "nightfox" })
  })

  test("a corrupt file yields the defaults", () => {
    seed("{ not json")
    expect(openConfigStore().read()).toEqual(DEFAULT_PREFERENCES)
  })

  test("an unknown theme value falls back to the default theme and still merges the rest", () => {
    seed(JSON.stringify({ theme: "solarized", mode: "build" }))
    expect(openConfigStore().read()).toEqual({ ...DEFAULT_PREFERENCES, mode: "build" })
  })

  test("update rewrites the whole file so an earlier write is never lost", () => {
    const store = openConfigStore()
    store.update({ theme: "nightfox" })
    store.update({ model: "claude-3-7-sonnet" })
    const raw: unknown = JSON.parse(readFileSync(store.path, "utf8"))
    expect(raw).toEqual({ theme: "nightfox", mode: "plan", model: "claude-3-7-sonnet" } satisfies Preferences)
  })
})
