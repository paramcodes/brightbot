import type { Session } from "@nightcode/shared"
import type { Theme } from "../../styles/theme.js"
import type { DialogItem } from "./DialogSearchList.js"
import { DialogSearchList } from "./DialogSearchList.js"

const FORMATTER = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

/**
 * The ladder that decides what one unit covers. `Intl.RelativeTimeFormat` writes the words; this
 * decides which words they are.
 */
const DIVISIONS: readonly { readonly size: number; readonly unit: Intl.RelativeTimeFormatUnit }[] = [
  { size: 60, unit: "second" },
  { size: 60, unit: "minute" },
  { size: 24, unit: "hour" },
  { size: 7, unit: "day" },
  { size: 4.34524, unit: "week" },
  { size: 12, unit: "month" },
]

/** The clock is a parameter so a test fixes it, rather than reading the machine's and going stale. */
export function relativeAge(iso: string, now: Date): string {
  let seconds = (Date.parse(iso) - now.getTime()) / 1000
  for (const division of DIVISIONS) {
    if (Math.abs(seconds) < division.size) return FORMATTER.format(Math.round(seconds), division.unit)
    seconds /= division.size
  }
  return FORMATTER.format(Math.round(seconds), "year")
}

/** How a row reads: how long ago it was written. The turn count is not here on purpose. */
export function sessionHint(session: Session, now: Date): string {
  return relativeAge(session.createdAt, now)
}

/**
 * Shown in place of the list when there is nothing to pick. Its id is one no session can have, so
 * `DialogSearchList` can move a cursor over it while selecting it does nothing.
 */
const STATUS_ID = "history-status"

/** Wider than the palette's 56, because a row carries a title and a hint on one line. */
const WIDTH = 72

export interface SessionListDialogProps {
  theme: Theme
  filter: string
  onFilter: (value: string) => void
  sessions: readonly Session[]
  loading: boolean
  error: string | null
  onSelect: (session: Session) => void
  onClose: () => void
}

/** The `/sessions` picker. It owns no keyboard logic of its own; DialogSearchList is the only implementation. */
export function SessionListDialog({ theme, filter, onFilter, sessions, loading, error, onSelect, onClose }: SessionListDialogProps) {
  const now = new Date()
  const items: readonly DialogItem[] =
    sessions.length === 0
      ? [{ id: STATUS_ID, label: loading ? "reading the saved sessions…" : (error ?? "no saved sessions yet") }]
      : sessions.map((session) => ({ id: session.id, label: session.title, hint: sessionHint(session, now) }))

  return (
    <DialogSearchList
      theme={theme}
      title="sessions"
      layerId="session-list"
      items={items}
      filter={filter}
      onFilter={onFilter}
      placeholder="filter sessions"
      width={WIDTH}
      onSelect={(item) => {
        const session = sessions.find((entry) => entry.id === item.id)
        if (session) onSelect(session)
      }}
      onCancel={onClose}
    />
  )
}
