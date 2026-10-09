import { describe, expect, test } from "bun:test"
import { useState } from "react"
import { renderTui, settle } from "../../../test/harness.js"
import { dracula } from "../../styles/theme.js"
import { Spinner } from "./Spinner.js"

describe("Spinner", () => {
  test("renders the label beside the glyph", async () => {
    const setup = await renderTui(<Spinner theme={dracula} label="thinking" />)
    expect(setup.captureCharFrame()).toContain("thinking")
    setup.renderer.destroy()
  })

  test("keeps the renderer live while it is on screen", async () => {
    const setup = await renderTui(<Spinner theme={dracula} label="thinking" />)
    await settle(setup)
    // Every animation frame request asks the renderer for another frame, so a running loop is the
    // only reason the renderer stays live with nothing else on screen.
    expect(setup.renderer.getSchedulerState().isRunning).toBe(true)
    setup.renderer.destroy()
  })

  test("stops asking for frames once it leaves the tree", async () => {
    let hide: () => void = () => {}
    function Wrapper() {
      const [shown, setShown] = useState(true)
      hide = () => setShown(false)
      return shown ? <Spinner theme={dracula} label="thinking" /> : <text>no spinner</text>
    }
    const setup = await renderTui(<Wrapper />)
    await settle(setup)
    expect(setup.renderer.getSchedulerState().isRunning).toBe(true)

    hide()
    await settle(setup)
    expect(setup.captureCharFrame()).toContain("no spinner")

    // A spinner that left the tree without cancelling its frame request would keep this true forever.
    expect(setup.renderer.getSchedulerState().isRunning).toBe(false)
    setup.renderer.destroy()
  })
})
