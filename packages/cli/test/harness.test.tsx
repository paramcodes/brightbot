import { describe, expect, test } from "bun:test"
import { useMemo } from "react"
import { syntaxStyle } from "../src/components/chat/markdown-style.js"
import { dracula } from "../src/styles/theme.js"
import { renderTui, settle, untilSettled } from "./harness.js"

function Markdown({ content }: { content: string }) {
  const style = useMemo(() => syntaxStyle(dracula), [])
  return <markdown content={content} syntaxStyle={style} fg={dracula.fg} streaming={false} />
}

describe("untilSettled", () => {
  test("waits for a markdown body that only lands after its blocks finalize", async () => {
    const setup = await renderTui(<Markdown content="finalized **body** text" />)
    // `settle` alone is not enough: the renderable is still building its block tree here.
    await settle(setup)
    expect(setup.captureCharFrame().trim()).toBe("")

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
