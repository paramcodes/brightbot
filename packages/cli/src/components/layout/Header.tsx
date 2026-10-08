import { BRAND } from "@nightcode/shared"
import type { Theme } from "../../styles/theme.js"

export interface HeaderProps {
  theme: Theme
  cwd: string
  mode: string
  model: string
  status: string
  width: number
}

/**
 * Status row above the conversation: identity, working directory, agent mode, model, and live status.
 * Drops fragments instead of wrapping, because a wrapped header breaks every row below it.
 */
export function Header({ theme, cwd, mode, model, status, width }: HeaderProps) {
  const cells = [
    { key: "brand", text: `${BRAND.name} ${BRAND.version}`, color: theme.accent },
    { key: "cwd", text: cwd, color: theme.muted },
    { key: "mode", text: mode, color: theme.accentAlt },
    { key: "model", text: model, color: theme.info },
    { key: "status", text: status, color: theme.success },
  ]

  let budget = Math.max(width - 2, 8)
  const shown = cells.map((cell) => {
    const label = cell.text.length + 2 <= budget ? cell.text : `${cell.text.slice(0, Math.max(budget - 5, 1))}…`
    budget -= cell.text.length + 2
    return { ...cell, label }
  })

  return (
    <box height={1} width="100%" flexDirection="row" gap={2} paddingX={1}>
      {shown.map((cell) => (
        <text key={cell.key} fg={cell.color}>
          {cell.label}
        </text>
      ))}
    </box>
  )
}
