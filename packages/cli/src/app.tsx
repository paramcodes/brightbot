import { cwd } from "node:process"
import { useKeyboard, useRenderer } from "@opentui/react"
import { useState } from "react"
import { InputBar } from "./components/input/InputBar.js"
import { Banner } from "./components/layout/Banner.js"
import { Header } from "./components/layout/Header.js"
import { exitCleanly } from "./core/renderer.js"
import { defaultTheme } from "./styles/theme.js"

/** Header, banner, and composer. The responder chain and toasts land in 1.4 and 1.5. */
export function App() {
  const renderer = useRenderer()
  const theme = defaultTheme
  const [draft, setDraft] = useState("")

  useKeyboard((event) => {
    if (event.name === "c" && event.ctrl) exitCleanly(renderer)
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header theme={theme} cwd={cwd()} mode="plan" model="claude-3-5-sonnet" status="idle" width={renderer.width} />
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <Banner theme={theme} />
      </box>
      <InputBar theme={theme} value={draft} focused onChange={setDraft} onSubmit={() => setDraft("")} />
    </box>
  )
}
