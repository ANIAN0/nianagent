import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type Ref,
} from "react"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import { InlineReferenceHint } from "./inline-reference-hint"
import { ReferenceStatusDialog } from "./reference-status-dialog"
import { useComposerPanelInactive } from "@/features/home/composer-panel-context"
import {
  createEditor,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $isElementNode,
  $createParagraphNode,
  $createTextNode,
  $createLineBreakNode,
  $createRangeSelection,
  $setSelection,
  $addUpdateTag,
  TextNode,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  HISTORY_PUSH_TAG,
  HISTORY_MERGE_TAG,
  SKIP_DOM_SELECTION_TAG,
  type LexicalNode,
  type ElementNode,
  type NodeKey,
  type SerializedTextNode,
  type EditorConfig,
} from "lexical"
import { registerPlainText } from "@lexical/plain-text"
import { registerHistory, createEmptyHistoryState } from "@lexical/history"
import type { Material } from "@/features/home/home-types"
import { fileReferenceFeedback } from "@/features/materials/material-reference-feedback"
import { composerKeyIntent } from "./composer-keymap"
import {
  materialMention,
  composerReferenceToken,
  composerReferenceIndex,
  removeComposerReferenceTokens,
  type ComposerEditorElement,
} from "./composer-editor-contract"

type SerializedReference = SerializedTextNode & {
  referenceId: string
  source: string
  materialType?: Material["type"]
  status?: Material["status"]
  error?: string
  retryable?: boolean
}
class ReferenceNode extends TextNode {
  __referenceId: string
  __source: string
  __materialType: Material["type"]
  __status: Material["status"]
  __error?: string
  __retryable?: boolean
  constructor(
    text: string,
    referenceId: string,
    source: string,
    key?: NodeKey,
    materialType?: Material["type"],
    status?: Material["status"],
    error?: string,
    retryable?: boolean
  ) {
    super(text, key)
    this.__referenceId = referenceId
    this.__source = source
    this.__materialType = materialType
    this.__status = status
    this.__error = error
    this.__retryable = retryable
  }
  static getType() {
    return "moon-reference"
  }
  static clone(node: ReferenceNode) {
    return new ReferenceNode(
      node.__text,
      node.__referenceId,
      node.__source,
      node.__key,
      node.__materialType,
      node.__status,
      node.__error,
      node.__retryable
    )
  }
  static importJSON(node: SerializedReference) {
    return new ReferenceNode(
      node.text,
      node.referenceId,
      node.source,
      undefined,
      node.materialType,
      node.status,
      node.error,
      node.retryable
    )
      .updateFromJSON(node)
      .setMode("token")
  }
  exportJSON(): SerializedReference {
    return {
      ...super.exportJSON(),
      type: "moon-reference",
      referenceId: this.__referenceId,
      source: this.__source,
      materialType: this.__materialType,
      status: this.__status,
      error: this.__error,
      retryable: this.__retryable,
    }
  }
  createDOM(config: EditorConfig) {
    const element = super.createDOM(config)
    element.classList.add("moon-inline-reference")
    element.dataset.referenceSource = this.__source
    element.dataset.referenceId = this.__referenceId
    element.dataset.referenceStatus = this.__status ?? "ready"
    element.dataset.referenceHint = this.referenceHint()
    element.setAttribute(
      "aria-label",
      `${this.__text}，${element.dataset.referenceHint}`
    )
    return element
  }
  updateDOM(previous: this, element: HTMLElement, config: EditorConfig) {
    const replace = super.updateDOM(previous, element, config)
    element.dataset.referenceSource = this.__source
    element.dataset.referenceId = this.__referenceId
    element.dataset.referenceStatus = this.__status ?? "ready"
    element.dataset.referenceHint = this.referenceHint()
    element.setAttribute(
      "aria-label",
      `${this.__text}，${element.dataset.referenceHint}`
    )
    return replace
  }
  referenceHint() {
    if (!this.__status || this.__status === "ready") return this.__source
    return (
      fileReferenceFeedback({
        name: this.__text,
        type: this.__materialType,
        status: this.__status,
        error: this.__error,
        retryable: this.__retryable,
      })?.hint ??
      (this.__status === "preparing"
        ? "正在准备，完成后可发送"
        : this.__error || "准备失败，点击处理")
    )
  }
  bind(material: Material) {
    const node = this.getWritable()
    node.__referenceId = material.id
    node.__materialType = material.type
    node.__status = material.status
    node.__error = material.error
    node.__retryable = material.retryable
  }
  isTextEntity() {
    return true
  }
  canInsertTextBefore() {
    return false
  }
  canInsertTextAfter() {
    return false
  }
}
function referenceMatches(node: ReferenceNode, material: Material) {
  return (
    node.__referenceId === material.id ||
    (node.__source === (material.source ?? material.name) &&
      node.__materialType === material.type)
  )
}
function offsetBefore(node: LexicalNode): number {
  let offset = 0
  let current: LexicalNode | null = node
  while (current?.getParent()) {
    const parent: ElementNode = current.getParent()!
    for (const sibling of current.getPreviousSiblings())
      offset +=
        sibling.getTextContentSize() + (parent.getType() === "root" ? 2 : 0)
    current = parent
  }
  return offset
}
function pointOffset(point: {
  getNode(): LexicalNode
  offset: number
  type: string
}) {
  const node = point.getNode()
  if ($isTextNode(node)) return offsetBefore(node) + point.offset
  if ($isElementNode(node))
    return (
      offsetBefore(node) +
      node
        .getChildren()
        .slice(0, point.offset)
        .reduce(
          (n, child) =>
            n +
            child.getTextContentSize() +
            (node.getType() === "root" ? 2 : 0),
          0
        )
    )
  return offsetBefore(node)
}
function setCaret(start: number, end: number) {
  const selection = $createRangeSelection()
  const set = (point: typeof selection.anchor, target: number) => {
    function find(node: LexicalNode): boolean {
      const before = offsetBefore(node)
      if ($isTextNode(node) && target <= before + node.getTextContentSize()) {
        point.set(node.getKey(), Math.max(0, target - before), "text")
        return true
      }
      if ($isElementNode(node)) return node.getChildren().some(find)
      if (node.getType() === "linebreak" && target <= before + 1) {
        const parent = node.getParent()!
        point.set(
          parent.getKey(),
          node.getIndexWithinParent() + (target > before ? 1 : 0),
          "element"
        )
        return true
      }
      return false
    }
    if (!find($getRoot())) {
      const parent = $getRoot().getLastChild()
      if ($isElementNode(parent))
        point.set(parent.getKey(), parent.getChildrenSize(), "element")
      else point.set($getRoot().getKey(), 0, "element")
    }
  }
  set(selection.anchor, start)
  set(selection.focus, end)
  $setSelection(selection)
}

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
    const root = element.current!
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
                (id) =>
                  !latest.current.materials?.some((item) => item.id === id)
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
  }, [canRestoreSelection, invalidateFocusedSelection])
  useEffect(() => {
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
            setCaret(
              Math.min(caret, value.length),
              Math.min(caret, value.length)
            )
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
