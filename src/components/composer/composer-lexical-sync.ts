import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  $createLineBreakNode,
  $addUpdateTag,
  HISTORY_PUSH_TAG,
  HISTORY_MERGE_TAG,
  SKIP_DOM_SELECTION_TAG,
} from "lexical"

import type { Material } from "@/lib/composer/types"

import {
  materialMention,
  composerReferenceIndex,
} from "./composer-editor-contract"
import type { RefObject } from "react"
import type { LexicalEditor } from "lexical"
import type { SelectionRequest } from "./composer-editor.types"
import {
  ReferenceNode,
  referenceMatches,
  pointOffset,
  setCaret,
} from "./composer-lexical-nodes"

/** 外部草稿是文本权威，编辑器独占 DOM；后台 ACK 不恢复过期选择。 */
export function synchronizeComposerEditor({
  runtime,
  disabled,
  invalidateFocusedSelection,
  pendingSelection,
  materials,
  value,
  cwd,
  changeExternalText,
  canRestoreSelection,
  focusLease,
}: {
  runtime: RefObject<LexicalEditor | null>
  disabled?: boolean
  invalidateFocusedSelection: () => void
  pendingSelection: RefObject<SelectionRequest | null>
  materials?: Material[]
  value: string
  cwd?: string
  changeExternalText: (text: string) => void
  canRestoreSelection: (request: { focusLease?: number }) => boolean
  focusLease: RefObject<number>
}) {
  const editor = runtime.current
  if (!editor) return
  editor.setEditable(!disabled)
  const pending = pendingSelection.current
  if (disabled) invalidateFocusedSelection()
  const current = editor.getEditorState().read(() => ({
    text: $getRoot().getTextContent(),
    references: $getRoot()
      .getAllTextNodes()
      .filter((node): node is ReferenceNode => node instanceof ReferenceNode),
  }))
  const missing = (materials ?? []).filter(
    (item) =>
      (item.type === "file" || item.type === "directory") &&
      item.presentation !== "attachment" &&
      item.status === "ready" &&
      !(
        current.text === value &&
        current.references.some((node) => referenceMatches(node, item))
      ) &&
      composerReferenceIndex(value, materialMention(item, cwd)) < 0
  )
  if (missing.length) {
    changeExternalText(
      [value, ...missing.map((item) => materialMention(item, cwd))]
        .filter(Boolean)
        .join(" ") + " "
    )
    return
  }
  const matchingSelection = pending?.text === value ? pending : null
  const requestedSelection =
    matchingSelection && canRestoreSelection(matchingSelection)
      ? matchingSelection
      : null
  if (matchingSelection) pendingSelection.current = null
  const externalFocusLease = focusLease.current
  const canUpdateSelection = () =>
    requestedSelection
      ? canRestoreSelection(requestedSelection)
      : !matchingSelection &&
        canRestoreSelection({ focusLease: externalFocusLease })
  if (current.text !== value)
    editor.update(
      () => {
        const selectionAllowed = canUpdateSelection()
        if (!selectionAllowed) $addUpdateTag(SKIP_DOM_SELECTION_TAG)
        const selection = $getSelection()
        const caret = $isRangeSelection(selection)
          ? pointOffset(selection.anchor)
          : value.length
        const p = $createParagraphNode()
        value.split("\n").forEach((line, i) => {
          if (i) p.append($createLineBreakNode())
          if (line) p.append($createTextNode(line))
        })
        $getRoot().clear().append(p)
        if (requestedSelection && selectionAllowed)
          setCaret(requestedSelection.start, requestedSelection.end)
        else if (!matchingSelection && selectionAllowed)
          setCaret(Math.min(caret, value.length), Math.min(caret, value.length))
      },
      { discrete: true, tag: ["external", HISTORY_PUSH_TAG] }
    )
  else
    editor.update(
      () => {
        const selectionAllowed = canUpdateSelection()
        if (!selectionAllowed) $addUpdateTag(SKIP_DOM_SELECTION_TAG)
        $getRoot()
          .getAllTextNodes()
          .forEach((node) => {
            node.markDirty()
          })
        if (requestedSelection && selectionAllowed)
          setCaret(requestedSelection.start, requestedSelection.end)
      },
      { discrete: true, tag: ["external", HISTORY_MERGE_TAG] }
    )
}
