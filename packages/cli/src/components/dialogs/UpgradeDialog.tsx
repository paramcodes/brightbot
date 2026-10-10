import type { Theme } from "../../styles/theme.js"
import type { DialogItem } from "./DialogSearchList.js"
import { DialogSearchList } from "./DialogSearchList.js"

/** What one pack costs, in credits. The local ledger grants exactly this. */
export const TOP_UP_PACK = 500

const CONFIRM_ID = "top-up-confirm"

export interface UpgradeDialogProps {
  theme: Theme
  /** What the caller has now, so the offer is a sentence about a number rather than a bare button. */
  balance: number
  onConfirm: () => void
  onClose: () => void
}

/**
 * The `/upgrade` dialog: one row to buy, one to cancel.
 *
 * It is a `DialogSearchList` because the answer really is a choice between two rows, and the keyboard
 * is the one every other modal already implements. The cancel row's id is one no pack can have, so
 * selecting it does nothing beyond closing.
 */
export function UpgradeDialog({ theme, balance, onConfirm, onClose }: UpgradeDialogProps) {
  const items: readonly DialogItem[] = [
    { id: CONFIRM_ID, label: `add ${TOP_UP_PACK} credits`, hint: `${balance.toFixed(2)} left now` },
    { id: "top-up-cancel", label: "not now" },
  ]

  return (
    <DialogSearchList
      theme={theme}
      title="credits"
      layerId="upgrade"
      items={items}
      filter=""
      onFilter={() => {}}
      placeholder=""
      width={56}
      maxVisible={2}
      onSelect={(item) => {
        if (item.id === CONFIRM_ID) onConfirm()
        else onClose()
      }}
      onCancel={onClose}
    />
  )
}
