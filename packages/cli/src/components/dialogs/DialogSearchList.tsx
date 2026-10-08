import { useState } from "react"
import { useResponder } from "../../core/responder/useResponder.js"
import type { Theme } from "../../styles/theme.js"
import { DialogBackdrop } from "./DialogBackdrop.js"

export interface DialogItem {
  id: string
  label: string
  hint?: string
}

export interface DialogSearchListProps {
  theme: Theme
  title: string
  items: readonly DialogItem[]
  /** Controlled so a caller can seed the filter, which is how the palette absorbs a fast paste of `/exit`. */
  filter: string
  onFilter: (value: string) => void
  onSelect: (item: DialogItem) => void
  onCancel: () => void
  /** Responder layer id. Required, because two layers sharing one id silently replace each other. */
  layerId: string
  placeholder?: string
  width?: number
  maxVisible?: number
}

const DEFAULT_MAX_VISIBLE = 8

function matchesQuery(items: readonly DialogItem[], query: string): DialogItem[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...items]
  return items.filter((item) => item.label.toLowerCase().includes(needle) || (item.hint ?? "").toLowerCase().includes(needle))
}

/**
 * The one keyboard implementation for modal lists. Filter by typing, arrows move, return selects,
 * escape cancels. The layer consumes every key it owns, so the shell underneath never sees one.
 *
 * The selection is tracked by item id rather than by row index, because a filtered list has no
 * stable indices and a stale index silently selects the wrong row.
 */
export function DialogSearchList({
  theme,
  title,
  items,
  filter,
  onFilter,
  onSelect,
  onCancel,
  layerId,
  placeholder = "filter…",
  width = 56,
  maxVisible = DEFAULT_MAX_VISIBLE,
}: DialogSearchListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const matches = matchesQuery(items, filter)
  const cursor = Math.max(
    matches.findIndex((item) => item.id === selectedId),
    0,
  )

  useResponder(layerId, ({ token }) => {
    if (token === "escape") {
      onCancel()
      return true
    }
    if (token === "return") {
      const item = matches[cursor]
      if (item) onSelect(item)
      return true
    }
    if (token !== "up" && token !== "down") return false
    const step = token === "up" ? -1 : 1
    const next = matches[Math.min(Math.max(cursor + step, 0), matches.length - 1)]
    if (next) setSelectedId(next.id)
    return true
  })

  const windowStart = Math.max(0, Math.min(cursor - maxVisible + 1, matches.length - maxVisible))
  const visible = matches.slice(windowStart, windowStart + maxVisible)

  return (
    <DialogBackdrop theme={theme} title={title} width={width}>
      <box borderStyle="rounded" borderColor={theme.border} flexDirection="row" alignItems="center" gap={1} marginBottom={1}>
        <text fg={theme.accent}>{">"}</text>
        <box flexGrow={1}>
          <input value={filter} placeholder={placeholder} focused onInput={onFilter} />
        </box>
      </box>
      <box flexDirection="column" height={maxVisible} overflow="hidden">
        {visible.map((item, offset) => {
          const selected = windowStart + offset === cursor
          return (
            <text key={item.id} fg={selected ? theme.panel : theme.fg} bg={selected ? theme.accent : undefined}>
              {selected ? ">" : " "} {item.label}
              {item.hint ? <span fg={selected ? theme.panel : theme.dim}>{`  ${item.hint}`}</span> : null}
            </text>
          )
        })}
      </box>
      {matches.length === 0 ? <text fg={theme.warning}>no match</text> : null}
      <text fg={theme.dim}>type to filter · ↑↓ move · enter select · esc cancel</text>
    </DialogBackdrop>
  )
}
