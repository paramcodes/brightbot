import { BRAND } from "@nightcode/shared"
import { useKeyboard, useRenderer } from "@opentui/react"
import { exitCleanly } from "./core/renderer.js"

/** Placeholder greeting. Layout primitives land in 1.3, the responder chain in 1.4. */
export function App() {
  const renderer = useRenderer()
  useKeyboard((event) => {
    if (event.name === "c" && event.ctrl) exitCleanly(renderer)
  })

  return (
    <box borderStyle="rounded" borderColor="#8be9fd" alignItems="center" justifyContent="center" flexGrow={1} width="100%">
      <ascii-font text="NIGHT" font="block" color="#8be9fd" />
      <text fg="#f8f8f2">{BRAND.tagline}</text>
      <text fg="#6272a4">ctrl+c to quit</text>
    </box>
  )
}
