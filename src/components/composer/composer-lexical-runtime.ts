import {
  createEditor,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  $createLineBreakNode,
  $addUpdateTag,
  TextNode,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  SKIP_DOM_SELECTION_TAG,
} from "lexical"
import { registerPlainText } from "@lexical/plain-text"
import { registerHistory, createEmptyHistoryState } from "@lexical/history"
import type { Material } from "@/lib/composer/types"

import { composerKeyIntent } from "./composer-keymap"
import {
  composerReferenceToken,
  composerReferenceIndex,
  type ComposerEditorElement,
} from "./composer-editor-contract"
import type { RefObject } from "react"
import type { LexicalEditor } from "lexical"
import type {
  ComposerEditorProps,
  SelectionRequest,
} from "./composer-editor.types"
import { ReferenceNode, pointOffset, setCaret } from "./composer-lexical-nodes"

/** 注册、IME、选择桥和卸载成对发生；迟到焦点请求必须通过租约校验。 */
export function mountComposerEditor({
  root,
  runtime,
  latest,
  identities,
  pendingSelection,
  focusLease,
  canRestoreSelection,
  invalidateFocusedSelection,
  change,
  submit,
}: {
  root: ComposerEditorElement
  runtime: RefObject<LexicalEditor | null>
  latest: RefObject<ComposerEditorProps>
  identities: RefObject<Map<string, Material>>
  pendingSelection: RefObject<SelectionRequest | null>
  focusLease: RefObject<number>
  canRestoreSelection: (request: { focusLease?: number }) => boolean
  invalidateFocusedSelection: () => void
  change: (text: string, removed: string[], restored: Material[]) => void
  submit: (alternate?: boolean) => void
}) {
  const editor = createEditor({
    namespace: "MoonComposer",
    nodes: [ReferenceNode],
    onError: (error) => {
      throw error
    },
  })
  runtime.current = editor
  editor.setRootElement(root)
  const composition = { active: false, endedAt: 0 }
  const start = () => {
    composition.active = true
    root.dataset.composing = "true"
  }
  const end = () => {
    composition.active = false
    composition.endedAt = Date.now()
    root.dataset.composing = "false"
  }
  root.addEventListener("compositionstart", start)
  root.addEventListener("compositionend", end)
  root.addEventListener("blur", invalidateFocusedSelection)
  let present = new Set<string>()
  let syncing = false
  const selectionOffset = (which: "start" | "end") =>
    editor.getEditorState().read(() => {
      const s = $getSelection()
      if (!$isRangeSelection(s)) return $getRoot().getTextContentSize()
      const a = pointOffset(s.anchor),
        b = pointOffset(s.focus)
      return which === "start" ? Math.min(a, b) : Math.max(a, b)
    })
  Object.defineProperties(root, {
    value: {
      configurable: true,
      get: () =>
        editor.getEditorState().read(() => $getRoot().getTextContent()),
    },
    selectionStart: {
      configurable: true,
      get: () => selectionOffset("start"),
      set: (start: number) =>
        editor.update(
          () => setCaret(start, Math.max(start, selectionOffset("end"))),
          { discrete: true }
        ),
    },
    selectionEnd: {
      configurable: true,
      get: () => selectionOffset("end"),
      set: (end: number) =>
        editor.update(
          () => setCaret(Math.min(end, selectionOffset("start")), end),
          { discrete: true }
        ),
    },
    setSelectionRange: {
      configurable: true,
      value: (a: number, b: number) =>
        editor.update(() => setCaret(a, b), { discrete: true }),
    },
    setSelectionAfterChange: {
      configurable: true,
      value: (
        text: string,
        start: number,
        end: number,
        options?: { requireFocus?: boolean }
      ) => {
        const request = {
          text,
          start,
          end,
          focusLease: options?.requireFocus ? focusLease.current : undefined,
        }
        if (!canRestoreSelection(request)) return
        if (
          editor.getEditorState().read(() => $getRoot().getTextContent()) ===
          text
        )
          editor.update(
            () => {
              if (canRestoreSelection(request)) setCaret(start, end)
              else $addUpdateTag(SKIP_DOM_SELECTION_TAG)
            },
            { discrete: true }
          )
        else pendingSelection.current = request
      },
    },
  })
  const cleanups = [
    registerPlainText(editor),
    registerHistory(editor, createEmptyHistoryState(), 300),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!event) return false
        if (root.getAttribute("aria-expanded") === "true") return true
        const intent = composerKeyIntent(event, composition)
        if (intent === "composing") return false
        if (intent === "submit") {
          event.preventDefault()
          submit(event.ctrlKey || event.metaKey)
          return true
        }
        if (intent === "ignore") {
          event.preventDefault()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    ...[KEY_TAB_COMMAND, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND].map(
      (command) =>
        editor.registerCommand(
          command,
          () => root.getAttribute("aria-expanded") === "true",
          COMMAND_PRIORITY_CRITICAL
        )
    ),
    editor.registerNodeTransform(TextNode, (node) => {
      if (node instanceof ReferenceNode || editor.isComposing()) return
      const text = node.getTextContent()
      for (const item of latest.current.materials ?? []) {
        if (!["file", "directory"].includes(item.type ?? "")) continue
        if (item.presentation === "attachment") continue
        const token = composerReferenceToken(item, latest.current.cwd)
        const index = composerReferenceIndex(text, token)
        if (index < 0) continue
        const part = index
          ? node.splitText(index, index + token.length)[1]!
          : node.splitText(token.length)[0]!
        part.replace(
          new ReferenceNode(
            token,
            item.id,
            item.source ?? item.name,
            undefined,
            item.type,
            item.status,
            item.error,
            item.retryable
          ).setMode("token")
        )
        return
      }
    }),
    editor.registerNodeTransform(ReferenceNode, (node) => {
      if (node.__materialType === "skill") {
        node.replace($createTextNode(node.getTextContent()))
        return
      }
      const material =
        latest.current.materials?.find(
          (item) =>
            item.source === node.__source && item.type === node.__materialType
        ) ?? identities.current.get(node.__referenceId)
      if (
        material &&
        material.source === node.__source &&
        material.type === node.__materialType &&
        (material.id !== node.__referenceId ||
          material.status !== node.__status ||
          material.error !== node.__error ||
          material.retryable !== node.__retryable)
      )
        node.bind(material)
    }),
    editor.registerUpdateListener(
      ({ editorState, dirtyElements, dirtyLeaves, tags }) => {
        editorState.read(() => {
          const text = $getRoot().getTextContent()
          const current = new Set(
            $getRoot()
              .getAllTextNodes()
              .filter(
                (node): node is ReferenceNode => node instanceof ReferenceNode
              )
              .map((node) => node.__referenceId)
          )
          const removed = [...present].filter(
            (id) =>
              !current.has(id) &&
              !(latest.current.materials ?? []).some(
                (item) =>
                  item.id === id &&
                  composerReferenceIndex(
                    text,
                    composerReferenceToken(item, latest.current.cwd)
                  ) >= 0
              )
          )
          present = current
          const restored = [...current]
            .filter(
              (id) => !latest.current.materials?.some((item) => item.id === id)
            )
            .map((id) => identities.current.get(id))
            .filter(
              (item): item is Material =>
                !!item && item.type !== "skill" && item.kind !== "Skill"
            )
          if (
            !syncing &&
            !tags.has("external") &&
            (dirtyElements.size || dirtyLeaves.size)
          )
            change(text, removed, restored)
        })
        root.dispatchEvent(new Event("select"))
      }
    ),
  ]
  syncing = true
  editor.update(
    () => {
      const p = $createParagraphNode()
      latest.current.value.split("\n").forEach((line, i) => {
        if (i) p.append($createLineBreakNode())
        if (line) p.append($createTextNode(line))
      })
      $getRoot().clear().append(p)
    },
    { discrete: true, tag: "external" }
  )
  syncing = false
  const ref = latest.current.inputRef
  if (typeof ref === "function") ref(root)
  else if (ref) ref.current = root
  return () => {
    cleanups.forEach((cleanup) => cleanup())
    root.removeEventListener("compositionstart", start)
    root.removeEventListener("compositionend", end)
    root.removeEventListener("blur", invalidateFocusedSelection)
    invalidateFocusedSelection()
    editor.setRootElement(null)
    runtime.current = null
    if (typeof ref === "function") ref(null)
    else if (ref) ref.current = null
  }
}
