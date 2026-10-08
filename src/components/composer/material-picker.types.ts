import { type RefObject } from "react"

import type { Material } from "@/lib/composer/types"

export type MaterialPickerProps = {
  disabled?: boolean
  materials: Material[]
  selected: Material[]
  onAdd: (material: Material) => void
  anchorRef?: RefObject<HTMLDivElement | null>
  onInsert?: (text: string) => void
  allowCompact?: boolean
  onChooseAttachments?: () => Promise<void>
  choosing?: boolean
  sessionId?: string
  workspacePath?: string
  onTextChange?: (text: string) => void
  onCommandSelect?: (name: string, text: string) => void
}
