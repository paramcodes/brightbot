import { useMemo } from "react"
import type { ToolRun } from "../../core/chat/types.js"
import type { Theme } from "../../styles/theme.js"

export interface ToolCallBlockProps {
  theme: Theme
  runs: readonly ToolRun[]
}

/** What one run says about itself, in one line. */
function lineFor(run: ToolRun): string {
  const elapsed = run.durationMs === null ? "" : ` · ${run.durationMs}ms`
  switch (run.status) {
    case "pending":
      return `${run.call.toolName} · waiting`
    case "awaiting-confirmation":
      return `${run.call.toolName} · waiting for you`
    case "running":
      return `${run.call.toolName} · running`
    case "denied":
      return `${run.call.toolName} · denied`
    case "complete":
      return `${run.call.toolName} · ok${elapsed}`
    case "failed":
      return `${run.call.toolName} · failed${elapsed}`
    default: {
      const unhandled: never = run.status
      throw new Error(`No line for the tool status ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * The tools a turn ran, grouped above the answer that followed them.
 *
 * Grouped rather than one block per call, because the interesting unit is the run of four reads the
 * model did in a row, not the four blocks. The count and the worst status are on the summary line, so
 * a collapsed group still says whether anything failed.
 *
 * The block is not a responder layer and takes no keys. A tool block that could be focused would sit
 * above the composer and take the arrow keys the user is scrolling with.
 */
export function ToolCallBlock({ theme, runs }: ToolCallBlockProps) {
  const summary = useMemo(() => worst(theme, runs), [theme, runs])
  if (runs.length === 0) return null
  return (
    <box flexDirection="column" borderStyle="rounded" borderColor={summary.color} paddingX={1} marginBottom={1}>
      <text fg={summary.color}>{`${runs.length} ${runs.length === 1 ? "tool call" : "tool calls"} · ${summary.state}`}</text>
      {runs.map((run) => (
        <text key={run.call.toolCallId} fg={theme.dim}>
          {lineFor(run)}
        </text>
      ))}
    </box>
  )
}

/**
 * The one word the summary uses, and the theme token that goes with it.
 *
 * Every color comes through `Theme` the way the rest of the tree does. A block that invented its own
 * palette would be the one part of the screen that ignored the user's theme choice.
 */
function worst(theme: Theme, runs: readonly ToolRun[]): { state: string; color: string } {
  if (runs.some((run) => run.status === "failed" || run.status === "denied")) return { state: "failed", color: theme.error }
  if (runs.some((run) => run.status === "pending" || run.status === "awaiting-confirmation"))
    return { state: "waiting", color: theme.warning }
  if (runs.some((run) => run.status === "running")) return { state: "running", color: theme.info }
  return { state: "done", color: theme.success }
}
