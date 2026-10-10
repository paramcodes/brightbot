import { MODELS } from "@nightcode/shared"
import type { Theme } from "../../styles/theme.js"
import type { DialogItem } from "../dialogs/DialogSearchList.js"
import { DialogSearchList } from "../dialogs/DialogSearchList.js"

const ITEMS: readonly DialogItem[] = MODELS.map((model) => ({
  id: model.id,
  label: model.label,
  hint: `${model.provider} · $${model.inputPerMillion} in / $${model.outputPerMillion} out per MTok`,
}))

/** The palette's default 56 columns wraps a row carrying two prices, so the model list is wider. */
const WIDTH = 72

export interface ModelSelectDialogProps {
  theme: Theme
  filter: string
  onFilter: (value: string) => void
  onSelect: (modelId: string) => void
  onClose: () => void
}

/** The `/models` picker. It owns no keyboard logic of its own; DialogSearchList is the only implementation. */
export function ModelSelectDialog({ theme, filter, onFilter, onSelect, onClose }: ModelSelectDialogProps) {
  return (
    <DialogSearchList
      theme={theme}
      title="models"
      layerId="model-select"
      items={ITEMS}
      filter={filter}
      onFilter={onFilter}
      placeholder="filter models"
      width={WIDTH}
      onSelect={(item) => onSelect(item.id)}
      onCancel={onClose}
    />
  )
}
