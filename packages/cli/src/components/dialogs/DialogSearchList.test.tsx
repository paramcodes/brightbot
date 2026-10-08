import { describe, expect, test } from "bun:test"
import { useState } from "react"
import { press, renderTui, type } from "../../../test/harness.js"
import { ResponderProvider } from "../../core/responder/ResponderContext.js"
import { useRootKeys } from "../../core/responder/useResponder.js"
import { defaultTheme } from "../../styles/theme.js"
import { ToastProvider } from "../toast/ToastProvider.js"
import { useToast } from "../toast/useToast.js"
import { type DialogItem, DialogSearchList } from "./DialogSearchList.js"

const ITEMS: readonly DialogItem[] = [
  { id: "clear", label: "/clear", hint: "wipe the screen" },
  { id: "sessions", label: "/sessions", hint: "resume history" },
  { id: "models", label: "/models", hint: "switch model" },
  { id: "agents", label: "/agents", hint: "switch agent" },
  { id: "usage", label: "/usage", hint: "credits and limits" },
  { id: "exit", label: "/exit", hint: "quit nightcode" },
]

const selected: string[] = []
const cancelled: string[] = []

interface DialogHostProps {
  layerId: string
  label: string
  title: string
}

function DialogHost({ layerId, label, title }: DialogHostProps) {
  const [open, setOpen] = useState(true)
  if (!open) return null
  return (
    <DialogSearchList
      theme={defaultTheme}
      title={title}
      items={ITEMS}
      layerId={layerId}
      onSelect={(item) => {
        selected.push(`${label}:${item.id}`)
        setOpen(false)
      }}
      onCancel={() => {
        cancelled.push(label)
        setOpen(false)
      }}
    />
  )
}

/** The shell below the dialog. It reports escape through the real toast layer, which paints above a modal. */
function Shell({ stacked }: { stacked: boolean }) {
  const { push } = useToast()
  useRootKeys((token) => {
    if (token === "escape") push({ kind: "error", message: "shell saw escape", durationMs: 0 })
  })
  return (
    <box width="100%" height="100%">
      <text>shell-visible</text>
      <DialogHost layerId={stacked ? "bottom" : "only"} label={stacked ? "bottom" : "only"} title="commands" />
      {stacked ? <DialogHost layerId="top" label="top" title="models" /> : null}
    </box>
  )
}

function mount(stacked = false) {
  selected.length = 0
  cancelled.length = 0
  return renderTui(
    <ToastProvider>
      <ResponderProvider>
        <Shell stacked={stacked} />
      </ResponderProvider>
    </ToastProvider>,
  )
}

describe("DialogSearchList", () => {
  test("the backdrop hides the shell underneath", async () => {
    const setup = await mount()
    expect(setup.captureCharFrame()).not.toContain("shell-visible")
  })

  test("lists every item and narrows the list as the user types", async () => {
    const setup = await mount()
    const frame = setup.captureCharFrame()
    for (const item of ITEMS) expect(frame).toContain(item.label)
    await type(setup, "switch")
    const filtered = setup.captureCharFrame()
    expect(filtered).toContain("/models")
    expect(filtered).toContain("/agents")
    expect(filtered).not.toContain("/clear")
    expect(filtered).not.toContain("/sessions")
    expect(filtered).not.toContain("/usage")
    expect(filtered).not.toContain("/exit")
  })

  test("typing a hint narrows the list too", async () => {
    const setup = await mount()
    await type(setup, "credits")
    const frame = setup.captureCharFrame()
    expect(frame).toContain("/usage")
    expect(frame).not.toContain("/models")
  })

  test("arrows move the selection and return selects the highlighted item", async () => {
    const setup = await mount()
    await type(setup, "switch")
    await press(setup, ["ARROW_DOWN"])
    await press(setup, ["RETURN"])
    expect(selected).toEqual(["only:agents"])
  })

  test("arrows clamp at both ends of the list", async () => {
    const first = await mount()
    await type(first, "switch")
    await press(first, ["ARROW_UP"])
    await press(first, ["RETURN"])
    expect(selected).toEqual(["only:models"])
  })

  test("return with no match selects nothing and keeps the dialog open", async () => {
    const setup = await mount()
    await type(setup, "zzzz")
    await press(setup, ["RETURN"])
    expect(selected).toEqual([])
    const frame = setup.captureCharFrame()
    expect(frame).toContain("no match")
    expect(frame).toContain("type to filter")
  })

  test("escape cancels the dialog and the shell underneath never sees the key", async () => {
    const setup = await mount()
    await press(setup, ["ESCAPE"])
    expect(cancelled).toEqual(["only"])
    const frame = setup.captureCharFrame()
    expect(frame).toContain("shell-visible")
    expect(frame).not.toContain("shell saw escape")
    expect(frame).not.toContain("/models")
  })

  test("escape closes only the top dialog of a stack", async () => {
    const setup = await mount(true)
    await press(setup, ["ESCAPE"])
    expect(cancelled).toEqual(["top"])
    const frame = setup.captureCharFrame()
    expect(frame).toContain("/clear")
    expect(frame).not.toContain("shell saw escape")

    await press(setup, ["ESCAPE"])
    expect(cancelled).toEqual(["top", "bottom"])
  })
})
