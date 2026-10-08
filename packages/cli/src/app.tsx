import { cwd } from "node:process"
import { useRenderer } from "@opentui/react"
import { useState } from "react"
import { InputBar } from "./components/input/InputBar.js"
import { Banner } from "./components/layout/Banner.js"
import { Header } from "./components/layout/Header.js"
import { exitCleanly } from "./core/renderer.js"
import { ResponderProvider, useRootKeys } from "./core/responder/useResponder.js"
import { defaultTheme } from "./styles/theme.js"

/** Header, banner, composer, and the responder chain that owns every control key. */
export function App() {
  return (
    <ResponderProvider>
      <AppShell />
    </ResponderProvider>
  )
}

function AppShell() {
  const renderer = useRenderer()
  const theme = defaultTheme
  const [draft, setDraft] = useState("")

  useRootKeys((token) => {
    if (token === "ctrl+c") exitCleanly(renderer)
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
