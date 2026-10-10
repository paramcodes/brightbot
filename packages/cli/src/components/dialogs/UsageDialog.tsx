import type { CreditEntry } from "@nightcode/shared"
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

/** The clock is a parameter so a test fixes it rather than reading the machine's. */
export function relativeAge(iso: string, now: Date): string {
  let seconds = (Date.parse(iso) - now.getTime()) / 1000
  for (const division of DIVISIONS) {
    if (Math.abs(seconds) < division.size) return FORMATTER.format(Math.round(seconds), division.unit)
    seconds /= division.size
  }
  return FORMATTER.format(Math.round(seconds), "year")
}

/**
 * How one charge reads: the model, the tokens, and the credits it took.
 *
 * The clock is passed in so the row is fixed while the dialog is open, which is what keeps two frames
 * of the same turn the same. The prompt tokens are shown because they are most of what a turn costs.
 */
export function chargeHint(entry: CreditEntry, now: Date): string {
  const tokens = entry.promptTokens + entry.completionTokens
  return `${entry.credits.toFixed(2)} cr · ${tokens} tok · ${relativeAge(entry.createdAt, now)}`
}

/**
 * The rows a status line uses, and why. The empty state is a row with an id no charge can have, so the
 * cursor can move over it while selecting it does nothing.
 */
const STATUS_ID = "usage-status"

export interface UsageDialogProps {
  theme: Theme
  filter: string
  onFilter: (value: string) => void
  balance: number
  entries: readonly CreditEntry[]
  loading: boolean
  error: string | null
  onSelect?: (entry: CreditEntry) => void
  onClose: () => void
}

/** The `/usage` dialog: what is left, and what it was spent on. It owns no keyboard logic of its own. */
export function UsageDialog({ theme, filter, onFilter, balance, entries, loading, error, onSelect, onClose }: UsageDialogProps) {
  const now = new Date()
  const items: readonly DialogItem[] =
    entries.length === 0
      ? [{ id: STATUS_ID, label: loading ? "reading the balance…" : (error ?? "no charges yet") }]
      : entries.map((entry) => ({ id: entry.id, label: entry.model, hint: chargeHint(entry, now) }))

  return (
    <DialogSearchList
      theme={theme}
      title={`credits · ${balance.toFixed(2)} left`}
      layerId="usage"
      items={items}
      filter={filter}
      onFilter={onFilter}
      placeholder="filter charges"
      width={72}
      onSelect={(item) => {
        const entry = entries.find((candidate) => candidate.id === item.id)
        if (entry) onSelect?.(entry)
      }}
      onCancel={onClose}
    />
  )
}
