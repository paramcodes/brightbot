import { describe, expect, test } from "bun:test"
import { renderTui } from "../../test/harness.js"
import { dracula } from "../styles/theme.js"
import { resetSessionTurnIds, SessionView, sessionTurn } from "./SessionView.js"

describe("SessionView", () => {
  test("keeps every turn visible with its own key when several prompts land", async () => {
    resetSessionTurnIds()
    const turns = [sessionTurn("first prompt"), sessionTurn("second prompt"), sessionTurn("third prompt")]
    expect(new Set(turns.map((turn) => turn.id)).size).toBe(3)
    const setup = await renderTui(<SessionView theme={dracula} turns={turns} />)
    const frame = setup.captureCharFrame()
    expect(frame).toContain("first prompt")
    expect(frame).toContain("second prompt")
    expect(frame).toContain("third prompt")
  })
})
