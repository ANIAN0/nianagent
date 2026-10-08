import { mountComposerEditor } from "./composer-lexical-runtime"
import { synchronizeComposerEditor } from "./composer-lexical-sync"
import { ReferenceNode, referenceMatches } from "./composer-lexical-nodes"
import type { ComposerEditorProps } from "./composer-editor.types"
export type { ComposerEditorProps } from "./composer-editor.types"
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import { InlineReferenceHint } from "./inline-reference-hint"
import { ReferenceStatusDialog } from "./reference-status-dialog"
import { useComposerPanelInactive } from "@/components/composer/composer-panel-context"
import {
  createEditor,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  HISTORY_PUSH_TAG,
} from "lexical"

import type { Material } from "@/lib/composer/types"

import {
  composerReferenceToken,
  removeComposerReferenceTokens,
  type ComposerEditorElement,
} from "./composer-editor-contract"
export function ComposerEditor(props: ComposerEditorProps) {
  const [preview, setPreview] = useState<Material | null>(null)
  const inactive = useComposerPanelInactive()
  const [wasInactive, setWasInactive] = useState(inactive)
  if (wasInactive !== inactive) {
    setWasInactive(inactive)
    if (inactive) setPreview(null)
  }
  // Stable initial markup makes saved text accessible before Lexical mounts.
  // Subsequent DOM updates belong exclusively to Lexical.
  const [initialText] = useState(props.value)
  const element = useRef<ComposerEditorElement>(null)
  const runtime = useRef<ReturnType<typeof createEditor>>(null)
  const pendingSelection = useRef<{
    text: string
    start: number
    end: number
    focusLease?: number
  } | null>(null)
  const focusLease = useRef(0)
  const invalidateFocusedSelection = useCallback(() => {
    focusLease.current++
    if (pendingSelection.current?.focusLease !== undefined)
      pendingSelection.current = null
  }, [])
  const canRestoreSelection = useCallback(
    (request: { focusLease?: number }) => {
      const root = element.current
      return (
        request.focusLease === undefined ||
        !!(
          request.focusLease === focusLease.current &&
          root?.isConnected &&
          root.isContentEditable &&
          runtime.current?.isEditable() &&
          document.activeElement === root
        )
      )
    },
    []
  )
  const latest = useRef(props)
  const identities = useRef(new Map<string, Material>())
  const identityDirectory = useRef(props.cwd)
  const change = useEffectEvent(
    (text: string, removed: string[], restored: Material[]) => {
      if (props.onReferencesChanged)
        props.onReferencesChanged(text, removed, restored)
      else props.onChange(text)
    }
  )
  const submit = useEffectEvent((alternate = false) =>
    props.onSubmit(alternate)
  )
  const changeExternalText = useEffectEvent((text: string) =>
    props.onChange(text)
  )
  const { value, materials, referenceIdentities, cwd, disabled } = props
  useEffect(() => {
    latest.current = props
    if (identityDirectory.current !== props.cwd) {
      invalidateFocusedSelection()
      identities.current.clear()
      identityDirectory.current = props.cwd
    }
    for (const [id, item] of identities.current)
      if (item.type === "skill" || item.kind === "Skill")
        identities.current.delete(id)
    ;[...(props.referenceIdentities ?? []), ...(props.materials ?? [])].forEach(
      (item) => {
        if (item.type === "skill" || item.kind === "Skill") return
        // This map belongs to one keyed editor/session and cwd, never a global path.
        // Historical temporary IDs resolve to the current authority after Undo.
        for (const [id, previous] of identities.current)
          if (
            item.source &&
            previous.source === item.source &&
            previous.type === item.type
          )
            identities.current.set(id, item)
        identities.current.set(item.id, item)
      }
    )
  })
  useEffect(() => {
    return mountComposerEditor({
      root: element.current!,
      runtime,
      latest,
      identities,
      pendingSelection,
      focusLease,
      canRestoreSelection,
      invalidateFocusedSelection,
      change,
      submit,
    })
  }, [canRestoreSelection, invalidateFocusedSelection])
  useEffect(() => {
    synchronizeComposerEditor({
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
    })
  }, [
    value,
    materials,
    referenceIdentities,
    cwd,
    disabled,
    canRestoreSelection,
    invalidateFocusedSelection,
  ])
  const currentPreview = preview
    ? (props.materials?.find(
        (item) =>
          item.id === preview.id ||
          (item.source &&
            item.source === preview.source &&
            item.type === preview.type)
      ) ?? null)
    : null
  const removeReference = (id: string) => {
    const editor = runtime.current
    const material = props.materials?.find((item) => item.id === id)
    if (!editor || !material || !props.onReferencesChanged) {
      props.onRemoveReference?.(id)
      return
    }
    const token = composerReferenceToken(material, props.cwd)
    // Keep actual node identity authoritative even when prose touches the token.
    // One callback owns both edits, avoiding a second callback with stale text.
    editor.update(
      () => {
        for (const node of $getRoot().getAllTextNodes()) {
          if (node instanceof ReferenceNode) {
            if (referenceMatches(node, material)) node.remove()
          } else {
            const text = node.getTextContent()
            const next = removeComposerReferenceTokens(text, token)
            if (next !== text) node.setTextContent(next)
          }
        }
      },
      { discrete: true, tag: ["external", HISTORY_PUSH_TAG] }
    )
    props.onReferencesChanged(
      editor.getEditorState().read(() => $getRoot().getTextContent()),
      [id],
      []
    )
  }
  return (
    <>
      <div className="moon-composer-editor-body">
        <div
          ref={element}
          data-slot="input-group-control"
          data-composer-editor
          data-composer-variant={props.variant}
          data-command-hint={
            /^\/skill:[^\s]+[ \t]*$/u.test(props.value) ? "skill" : undefined
          }
          className="moon-composer-prompt"
          contentEditable={!props.disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={props.ariaLabel}
          aria-disabled={props.disabled}
          data-placeholder={props.placeholder}
          data-empty={!props.value}
          onClick={(event) => {
            const id = (event.target as Element).closest<HTMLElement>(
              "[data-reference-id]"
            )?.dataset.referenceId
            if (id)
              setPreview(
                props.materials?.find((item) => item.id === id) ?? null
              )
          }}
          onKeyDown={(event) => {
            if (event.altKey && event.key === "Enter")
              runtime.current?.getEditorState().read(() => {
                const selection = $getSelection()
                if ($isRangeSelection(selection)) {
                  const node = selection.anchor.getNode()
                  if (node instanceof ReferenceNode) {
                    event.preventDefault()
                    setPreview(
                      props.materials?.find(
                        (item) => item.id === node.__referenceId
                      ) ?? null
                    )
                  }
                }
              })
          }}
        >
          <p>{initialText || <br />}</p>
        </div>
      </div>
      <InlineReferenceHint root={element} />
      <MaterialPreviewDialog
        material={currentPreview?.status === "ready" ? currentPreview : null}
        cwd={props.cwd ?? ""}
        onClose={() => setPreview(null)}
      />
      <ReferenceStatusDialog
        material={
          currentPreview && currentPreview.status !== "ready"
            ? currentPreview
            : null
        }
        onClose={() => setPreview(null)}
        onRetry={props.onRetryReference}
        canRetry={props.canRetryReference}
        retryLabel={props.retryLabelReference}
        onRemove={props.onRemoveReference ? removeReference : undefined}
      />
    </>
  )
}
