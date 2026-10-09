import { describe, expect, test } from "bun:test"
import { useMemo } from "react"
import { syntaxStyle } from "../src/components/chat/markdown-style.js"
import { dracula } from "../src/styles/theme.js"
import { renderTui, untilSettled } from "./harness.js"

function Markdown({ content }: { content: string }) {
  const style = useMemo(() => syntaxStyle(dracula), [])
  return <markdown content={content} syntaxStyle={style} fg={dracula.fg} streaming={false} />
}

describe("untilSettled", () => {
  test("waits for a markdown body that only lands after its blocks finalize", async () => {
    const setup = await renderTui(<Markdown content="finalized **body** text" />)
    // The point of the helper is that the body arrives eventually. Whether a single `settle` already saw
    // it depends on how fast the renderable finalized, so this does not assert that `settle` alone was
    // insufficient: that is a timing claim, and a machine fast enough to finalize inside `settle` would
    // fail it while behaving correctly.
    await untilSettled(setup, () => setup.captureCharFrame().includes("finalized"))
    expect(setup.captureCharFrame()).toContain("finalized")
    setup.renderer.destroy()
  })

  test("returns as soon as the predicate already holds", async () => {
    const setup = await renderTui(<Markdown content="already here" />)
    await untilSettled(setup, () => setup.captureCharFrame().includes("already here"))
    expect(setup.captureCharFrame()).toContain("already here")
    setup.renderer.destroy()
  })

  test("times out with the frame it last saw", async () => {
    const setup = await renderTui(<Markdown content="never matches this" />)
    let message = ""
    try {
      await untilSettled(setup, () => false, 150)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("untilSettled timed out after 150ms")
    expect(message).toContain("Last frame")
    setup.renderer.destroy()
  })
})
