import { type Ref } from "react"

import type { Material } from "@/lib/composer/types"

import { type ComposerEditorElement } from "./composer-editor-contract"
export type ComposerEditorProps = {
  inputRef?: Ref<ComposerEditorElement>
  value: string
  materials?: Material[]
  /** Completed owner-scoped records resolve Undo without adding selection. */
  referenceIdentities?: Material[]
  cwd?: string
  onChange(text: string): void
  onReferencesChanged?(
    text: string,
    removed: string[],
    restored: Material[]
  ): void
  onSubmit(alternate?: boolean): void
  onRetryReference?(id: string): void
  canRetryReference?(material: Material): boolean
  retryLabelReference?(material: Material): string
  onRemoveReference?(id: string): void
  placeholder: string
  ariaLabel: string
  variant: "hero" | "docked"
  disabled?: boolean
}
export type SelectionRequest = {
  text: string
  start: number
  end: number
  focusLease?: number
}
