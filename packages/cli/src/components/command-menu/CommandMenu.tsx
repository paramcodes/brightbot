import type { Theme } from "../../styles/theme.js"
import type { DialogItem } from "../dialogs/DialogSearchList.js"
import { DialogSearchList } from "../dialogs/DialogSearchList.js"
import { type Command, ROOT_COMMANDS } from "./commands.js"

const ITEMS: readonly DialogItem[] = ROOT_COMMANDS.map((command) => ({
  id: command.id,
  label: command.name,
  hint: command.summary,
}))

export interface CommandMenuProps {
  theme: Theme
  filter: string
  onFilter: (value: string) => void
  onRun: (command: Command) => void
  onClose: () => void
}

/** The `/` palette. It owns no keyboard logic of its own; DialogSearchList is the only implementation. */
export function CommandMenu({ theme, filter, onFilter, onRun, onClose }: CommandMenuProps) {
  return (
    <DialogSearchList
      theme={theme}
      title="commands"
      layerId="command-menu"
      items={ITEMS}
      filter={filter}
      onFilter={onFilter}
      placeholder="filter commands"
      onSelect={(item) => {
        const command = ROOT_COMMANDS.find((entry) => entry.id === item.id)
        if (command) onRun(command)
      }}
      onCancel={onClose}
    />
  )
}
