import { describe, expect, test } from "bun:test"
import { useEffect } from "react"
import { press, renderTui } from "../../../test/harness.js"
import { ResponderProvider } from "../../core/responder/ResponderContext.js"
import { useRootKeys } from "../../core/responder/useResponder.js"
import { ToastProvider } from "./ToastProvider.js"
import { useToast } from "./useToast.js"

/** Pushes a toast on mount, then dismisses it when `escape` arrives: the subsystem as a user drives it. */
function ToastSurface({ durationMs }: { durationMs: number }) {
  const { push, toasts, dismiss } = useToast()
  useRootKeys((token) => {
    if (token === "escape") dismiss(toasts[0]?.id ?? -1)
  })
  useEffect(() => {
    push({ kind: "success", message: "preferences saved", durationMs })
  }, [push, durationMs])

  return (
    <box flexDirection="column">
      <text>count:{toasts.length}</text>
      <text>message:{toasts[0]?.message ?? ""}</text>
      <text>kind:{toasts[0]?.kind ?? ""}</text>
    </box>
  )
}

function line(frame: string, prefix: string): string {
  return frame.split("\n").find((row) => row.includes(prefix)) ?? ""
}

async function mount(durationMs: number) {
  return renderTui(
    <ToastProvider>
      <ResponderProvider>
        <ToastSurface durationMs={durationMs} />
      </ResponderProvider>
    </ToastProvider>,
  )
}

describe("toast subsystem", () => {
  test("shows a toast pushed on mount", async () => {
    const frame = (await mount(0)).captureCharFrame()
    expect(line(frame, "count:")).toContain("count:1")
    expect(line(frame, "message:")).toContain("preferences saved")
    expect(line(frame, "kind:")).toContain("success")
  })

  test("dismisses the toast on escape", async () => {
    const setup = await mount(0)
    await press(setup, ["ESCAPE"])
    expect(line(setup.captureCharFrame(), "count:")).toContain("count:0")
  })

  test("auto-dismisses after its duration", async () => {
    const setup = await mount(40)
    expect(line(setup.captureCharFrame(), "count:")).toContain("count:1")
    await new Promise((resolve) => setTimeout(resolve, 120))
    await setup.flush()
    expect(line(setup.captureCharFrame(), "count:")).toContain("count:0")
  })
})
