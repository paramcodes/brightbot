import { describe, expect, test } from "bun:test"
import { useCallback, useState } from "react"
import { press, renderTui, type } from "../../../test/harness.js"
import { ResponderProvider, useResponder, useRootKeys } from "./useResponder.js"

interface LayerSpec {
  id: string
  /** True when this layer consumes the key and hides it from the layers below. */
  consume: boolean
}

/** One mounted layer. Reported keys are appended to the probe's rendered line. */
function Layer({ id, consume, onKey }: LayerSpec & { onKey: (entry: string) => void }) {
  useResponder(id, () => {
    onKey(id)
    return consume
  })
  return null
}

function ChainProbe({ layers }: { layers: LayerSpec[] }) {
  const [seen, setSeen] = useState<string[]>([])
  const report = useCallback((entry: string) => setSeen((current) => [...current, entry]), [])
  useRootKeys((token) => report(`unhandled:${token}`))

  return (
    <box flexDirection="column">
      {layers.map((layer) => (
        <Layer key={layer.id} {...layer} onKey={report} />
      ))}
      <text>seen:{seen.join("|")}</text>
    </box>
  )
}

async function mount(layers: LayerSpec[] = []) {
  return renderTui(
    <ResponderProvider>
      <ChainProbe layers={layers} />
    </ResponderProvider>,
  )
}

describe("responder chain", () => {
  test("an unconsumed control key reaches the root handler", async () => {
    const setup = await mount()
    await press(setup, ["ESCAPE"])
    expect(seenText(setup)).toBe("seen:unhandled:escape")
  })

  test("the top layer sees the key before lower layers", async () => {
    const setup = await mount([
      { id: "toast", consume: false },
      { id: "dialog", consume: false },
    ])
    await press(setup, ["ARROW_DOWN"])
    expect(seenText(setup)).toBe("seen:dialog|toast|unhandled:down")
  })

  test("a consuming layer hides the key from lower layers and the root handler", async () => {
    const setup = await mount([
      { id: "toast", consume: false },
      { id: "dialog", consume: true },
    ])
    await press(setup, ["ESCAPE"])
    expect(seenText(setup)).toBe("seen:dialog")
  })

  test("printable keys never reach the chain", async () => {
    const setup = await mount([{ id: "base", consume: true }])
    await type(setup, "q")
    expect(seenText(setup)).toBe("seen:")
  })

  test("ctrl chords reach the chain", async () => {
    const setup = await mount()
    await setup.mockInput.pressKey("c", { ctrl: true })
    await press(setup, [])
    await setup.mockInput.pressKey("x", { ctrl: true })
    await press(setup, [])
    expect(seenText(setup)).toBe("seen:unhandled:ctrl+c|unhandled:ctrl+x")
  })
})

function seenText(setup: Awaited<ReturnType<typeof mount>>): string {
  const line =
    setup
      .captureCharFrame()
      .split("\n")
      .find((row) => row.startsWith("seen:")) ?? ""
  return line.trimEnd()
}
