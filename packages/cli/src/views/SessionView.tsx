import type { Theme } from "../styles/theme.js"

export interface SessionTurn {
  id: number
  prompt: string
}

let nextTurnId = 1

export function sessionTurn(prompt: string): SessionTurn {
  const id = nextTurnId
  nextTurnId += 1
  return { id, prompt }
}

export function resetSessionTurnIds(): void {
  nextTurnId = 1
}

export interface SessionViewProps {
  theme: Theme
  turns: readonly SessionTurn[]
}

/**
 * The active session. The streaming response relay lands in a later phase, so the assistant block
 * stays empty rather than showing a spinner that implies work is happening.
 */
export function SessionView({ theme, turns }: SessionViewProps) {
  return (
    <box flexDirection="column" width="100%" height="100%" paddingX={1}>
      {turns.map((turn) => (
        <box key={turn.id} flexDirection="column" marginBottom={1}>
          <text fg={theme.accent}>you</text>
          <text fg={theme.fg}>{`> ${turn.prompt}`}</text>
        </box>
      ))}
      <box flexDirection="column">
        <text fg={theme.accentAlt}>nightcode</text>
        <text fg={theme.dim}>no response yet</text>
      </box>
    </box>
  )
}
