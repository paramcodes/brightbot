import { describe, expect, test } from "bun:test"
import { AUTH_PATH, NIGHTCODE_HOME_ENV, nightcodeHome, PREFERENCES_PATH, pathInNightcodeHome, STORE_PATH } from "../src/index.js"

describe("nightcode home", () => {
  test("defaults to ~/.nightcode", () => {
    delete process.env[NIGHTCODE_HOME_ENV]
    expect(nightcodeHome().endsWith("/.nightcode")).toBe(true)
  })

  test("honors NIGHTCODE_HOME so tests and demos stay out of the real home", () => {
    process.env[NIGHTCODE_HOME_ENV] = "/tmp/nightcode-test-home"
    expect(pathInNightcodeHome("preferences.json")).toBe("/tmp/nightcode-test-home/preferences.json")
    expect(PREFERENCES_PATH()).toBe("/tmp/nightcode-test-home/preferences.json")
    expect(AUTH_PATH()).toBe("/tmp/nightcode-test-home/auth.json")
    expect(STORE_PATH()).toBe("/tmp/nightcode-test-home/store.json")
    delete process.env[NIGHTCODE_HOME_ENV]
  })
})
