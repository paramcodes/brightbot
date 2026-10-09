import { Banner } from "../components/layout/Banner.js"
import type { Theme } from "../styles/theme.js"

export interface HomeViewProps {
  theme: Theme
}

/** The landing screen. Every route body sits below the header and above the composer. */
export function HomeView({ theme }: HomeViewProps) {
  return (
    <box flexDirection="column" alignItems="center" width="100%">
      <Banner theme={theme} />
      <text fg={theme.dim}>theme: {theme.name}</text>
    </box>
  )
}
