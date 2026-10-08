import { describe, expect, test } from "bun:test"
import type { KeyEvent } from "@opentui/core"
import { isTextEntryKey, keyToken } from "./keys.js"

function key(name: string, overrides: Partial<KeyEvent> = {}): KeyEvent {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: name,
    number: false,
    raw: name,
    eventType: "press",
    source: "raw",
    ...overrides,
  } as KeyEvent
}

describe("keyToken", () => {
  test("names plain characters", () => {
    expect(keyToken(key("a"))).toBe("a")
    expect(keyToken(key("/"))).toBe("/")
  })

  test("names shift without a modifier prefix", () => {
    expect(keyToken(key("a", { shift: true }))).toBe("a")
  })

  test("names ctrl with the ctrl prefix", () => {
    expect(keyToken(key("c", { ctrl: true }))).toBe("ctrl+c")
  })

  test("collapses the legacy ESC+ETX ctrl+c form", () => {
    expect(keyToken(key("c", { ctrl: true, meta: true }))).toBe("ctrl+c")
  })

  test("names meta and option", () => {
    expect(keyToken(key("s", { meta: true }))).toBe("meta+s")
    expect(keyToken(key("left", { option: true }))).toBe("alt+left")
  })

  test("names control keys without a prefix", () => {
    expect(keyToken(key("escape"))).toBe("escape")
    expect(keyToken(key("return"))).toBe("return")
    expect(keyToken(key("up"))).toBe("up")
  })
})

describe("isTextEntryKey", () => {
  test("treats single characters and space as text", () => {
    expect(isTextEntryKey("a")).toBe(true)
    expect(isTextEntryKey("space")).toBe(true)
  })

  test("treats control keys as not text", () => {
    expect(isTextEntryKey("escape")).toBe(false)
    expect(isTextEntryKey("ctrl+c")).toBe(false)
    expect(isTextEntryKey("return")).toBe(false)
  })
})
