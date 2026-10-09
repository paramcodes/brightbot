import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { frame, press, renderTui, type, untilSettled } from "./harness.js"

const REASONING = "weighing the options"
const REPLY = "the scripted answer for the terminal"
const DELAY_MS = "150"
const PROMPT = "hello from the terminal"

const ENV_KEYS = [
  NIGHTCODE_HOME_ENV,
  "NIGHTCODE_SERVER_URL",
  "NIGHTCODE_MODEL_PROVIDER",
  "NIGHTCODE_SCRIPTED_REPLY",
  "NIGHTCODE_SCRIPTED_REASONING",
  "NIGHTCODE_SCRIPTED_DELAY_MS",
]

interface StoreRow {
  role: string
  content: string
  status: string
}

let home = ""
let server: ReturnType<typeof Bun.serve> | undefined
let App: typeof import("../src/app.js").App

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "nightcode-fullstack-"))
  process.env[NIGHTCODE_HOME_ENV] = home
  process.env.NIGHTCODE_MODEL_PROVIDER = "scripted"
  process.env.NIGHTCODE_SCRIPTED_REASONING = REASONING
  process.env.NIGHTCODE_SCRIPTED_REPLY = REPLY
  process.env.NIGHTCODE_SCRIPTED_DELAY_MS = DELAY_MS
  const { app } = await import("../../server/src/app.js")
  server = Bun.serve({ port: 0, fetch: app.fetch })
  process.env.NIGHTCODE_SERVER_URL = `http://localhost:${server.port}`
  // Imported after the environment is set, so the port exists whichever order these two modules happen
  // to resolve their clients in. `apiClient` reads the URL per request now, so this ordering is a
  // convenience rather than the thing that makes the test pass.
  ;({ App } = await import("../src/app.js"))
})

afterAll(() => {
  server?.stop(true)
  rmSync(home, { recursive: true, force: true })
  for (const key of ENV_KEYS) delete process.env[key]
})

/**
 * The last turn the server wrote, waited for: the user row and the assistant row.
 *
 * A turn is two rows and the assistant row lands after its stream ends, so a turn that was stopped still
 * lands. `atLeast` is how many rows the store must hold before the last two belong to the turn under test.
 */
async function persistedRows(atLeast = 2): Promise<StoreRow[]> {
  const deadline = Date.now() + 5000
  let rows: StoreRow[] = []
  while (Date.now() < deadline) {
    rows = (JSON.parse(readFileSync(join(home, "store.json"), "utf8")) as { messages: StoreRow[] }).messages.map((row) => ({
      role: row.role,
      content: row.content,
      status: row.status,
    }))
    if (rows.length >= atLeast) return rows.slice(-2)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`The store never held ${atLeast} rows. It holds ${JSON.stringify(rows)}`)
}

describe("chat against the real server", () => {
  test("a prompt is on screen before the answer arrives, and the answer and the store agree", async () => {
    const setup = await renderTui(<App />)
    await type(setup, PROMPT)

    // One tick and one flush after Return, which is the frame the user sees before anything could have
    // crossed the socket. `settle` is deliberately not used here: it would wait out the very round trip
    // this test exists to show has not happened yet.
    setup.mockInput.pressEnter()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await setup.flush()

    const optimistic = frame(setup)
    expect(optimistic).toContain(`> ${PROMPT}`)
    expect(optimistic).toContain("nightcode")
    expect(optimistic).not.toContain(REASONING)
    expect(optimistic).not.toContain(REPLY)
    // The in-flight turn is read from the spinner's label in the body rather than the header's status
    // cell. The header truncates that cell when the working directory is long, and the isolated
    // verification worktrees sit far deeper than the checkout, so a header assertion is cwd-dependent.
    expect(optimistic.split("\n").some((row) => row.includes("thinking"))).toBe(true)

    await untilSettled(setup, () => frame(setup).includes(REPLY))
    const answered = frame(setup)
    // Once the turn ends the reasoning block collapses to its length, so the word count is what is left.
    expect(answered).toContain("thinking · 3 words")
    expect(answered).toContain(REPLY)

    expect(await persistedRows()).toEqual([
      { role: "user", content: PROMPT, status: "complete" },
      { role: "assistant", content: REPLY, status: "complete" },
    ])
    setup.renderer.destroy()
  })

  test("escape mid-stream interrupts the turn, and the server keeps the answer that arrived", async () => {
    // 400ms a word leaves roughly two seconds of stream after the word this waits on, so the Escape below
    // lands mid-turn on a slow machine as well as a fast one. The scripted model resolves its knobs per
    // request, so this reaches this test's turn and no other.
    process.env.NIGHTCODE_SCRIPTED_DELAY_MS = "400"
    const setup = await renderTui(<App />)
    try {
      await type(setup, PROMPT)
      setup.mockInput.pressEnter()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await setup.flush()

      // "scripted" is the second word of the reply and the reasoning never contains it, so seeing it means
      // the assistant body has started filling and the model has words left to send.
      await untilSettled(setup, () => frame(setup).includes("scripted"), 8000)
      await press(setup, ["ESCAPE"])
      await untilSettled(setup, () => frame(setup).includes("Interrupted before the answer finished."), 8000)

      expect(frame(setup)).toContain("Interrupted before the answer finished.")

      // Both cases in this file share one temp home, so this turn's rows are only complete once four are there.
      const rows = await persistedRows(4)
      expect(rows[0]).toEqual({ role: "user", content: PROMPT, status: "complete" })
      expect(rows[1]?.role).toBe("assistant")
      expect(rows[1]?.status).toBe("interrupted")
      expect(rows[1]?.content.length).toBeGreaterThan(0)
      expect(REPLY.startsWith(rows[1]?.content ?? "")).toBe(true)
      expect(rows[1]?.content).not.toBe(REPLY)
      // What the server kept is what the user was already reading, not a second rendering of it.
      expect(frame(setup)).toContain((rows[1]?.content ?? "").trim())
    } finally {
      process.env.NIGHTCODE_SCRIPTED_DELAY_MS = DELAY_MS
      setup.renderer.destroy()
    }
  })
})
