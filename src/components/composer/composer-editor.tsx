import { useEffect, useEffectEvent, useRef, useState, type Ref } from "react"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
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
  TextNode,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  type LexicalNode,
  type ElementNode,
  type NodeKey,
  type SerializedTextNode,
  type EditorConfig,
} from "lexical"
import { registerPlainText } from "@lexical/plain-text"
import { registerHistory, createEmptyHistoryState } from "@lexical/history"
import type { Material } from "@/features/home/home-types"
import { composerKeyIntent } from "./composer-keymap"
import {
  materialMention,
  type ComposerEditorElement,
} from "./composer-editor-contract"

type SerializedReference = SerializedTextNode & {
  referenceId: string
  source: string
}
class ReferenceNode extends TextNode {
  __referenceId: string
  __source: string
  constructor(
    text: string,
    referenceId: string,
    source: string,
    key?: NodeKey
  ) {
    super(text, key)
    this.__referenceId = referenceId
    this.__source = source
  }
  static getType() {
    return "moon-reference"
  }
  static clone(node: ReferenceNode) {
    return new ReferenceNode(
      node.__text,
      node.__referenceId,
      node.__source,
      node.__key
    )
  }
  static importJSON(node: SerializedReference) {
    return new ReferenceNode(node.text, node.referenceId, node.source)
      .updateFromJSON(node)
      .setMode("token")
  }
  exportJSON(): SerializedReference {
    return {
      ...super.exportJSON(),
      type: "moon-reference",
      referenceId: this.__referenceId,
      source: this.__source,
    }
  }
  createDOM(config: EditorConfig) {
    const element = super.createDOM(config)
    element.classList.add("moon-inline-reference")
    element.title = this.__source
    element.dataset.referenceId = this.__referenceId
    return element
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
  cwd?: string
  onChange(text: string): void
  onReferencesChanged?(
    text: string,
    removed: string[],
    restored: Material[]
  ): void
  onSubmit(): void
  placeholder: string
  ariaLabel: string
  variant: "hero" | "docked"
  disabled?: boolean
}
export function ComposerEditor(props: ComposerEditorProps) {
  const [preview, setPreview] = useState<Material | null>(null)
  // Stable initial markup makes saved text accessible before Lexical mounts.
  // Subsequent DOM updates belong exclusively to Lexical.
  const [initialText] = useState(props.value)
  const element = useRef<ComposerEditorElement>(null)
  const runtime = useRef<ReturnType<typeof createEditor>>(null)
  const latest = useRef(props)
  const identities = useRef(new Map<string, Material>())
  const change = useEffectEvent(
    (text: string, removed: string[], restored: Material[]) => {
      if (props.onReferencesChanged)
        props.onReferencesChanged(text, removed, restored)
      else props.onChange(text)
    }
  )
  const submit = useEffectEvent(() => props.onSubmit())
  const changeExternalText = useEffectEvent((text: string) =>
    props.onChange(text)
  )
  const { value, materials, cwd, disabled } = props
  useEffect(() => {
    latest.current = props
    props.materials?.forEach((item) => identities.current.set(item.id, item))
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
      },
      selectionEnd: { configurable: true, get: () => selectionOffset("end") },
      setSelectionRange: {
        configurable: true,
        value: (a: number, b: number) =>
          editor.update(() => setCaret(a, b), { discrete: true }),
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
            submit()
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
          if (item.type !== "file" && item.type !== "directory") continue
          const token = materialMention(item, latest.current.cwd)
          const index = text.indexOf(token)
          if (
            index < 0 ||
            (index && !/\s/u.test(text[index - 1]!)) ||
            (text[index + token.length] &&
              !/\s/u.test(text[index + token.length]!))
          )
            continue
          const part = index
            ? node.splitText(index, index + token.length)[1]!
            : node.splitText(token.length)[0]!
          part.replace(
            new ReferenceNode(token, item.id, item.source ?? item.name).setMode(
              "token"
            )
          )
          return
        }
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
                    text.includes(materialMention(item, latest.current.cwd))
                )
            )
            present = current
            const restored = [...current]
              .filter(
                (id) =>
                  !latest.current.materials?.some((item) => item.id === id)
              )
              .map((id) => identities.current.get(id))
              .filter((item): item is Material => !!item)
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
      editor.setRootElement(null)
      runtime.current = null
      if (typeof ref === "function") ref(null)
      else if (ref) ref.current = null
    }
  }, [])
  useEffect(() => {
    const editor = runtime.current
    if (!editor) return
    editor.setEditable(!disabled)
    const missing = (materials ?? []).filter(
      (item) =>
        (item.type === "file" || item.type === "directory") &&
        item.status === "ready" &&
        !value.includes(materialMention(item, cwd))
    )
    if (missing.length) {
      changeExternalText(
        [value, ...missing.map((item) => materialMention(item, cwd))]
          .filter(Boolean)
          .join(" ") + " "
      )
      return
    }
    const current = editor
      .getEditorState()
      .read(() => $getRoot().getTextContent())
    if (current !== value)
      editor.update(
        () => {
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
          if (document.activeElement === element.current)
            setCaret(
              Math.min(caret, value.length),
              Math.min(caret, value.length)
            )
        },
        { discrete: true, tag: "external" }
      )
    else
      editor.update(
        () =>
          $getRoot()
            .getAllTextNodes()
            .forEach((node) => {
              if (!(node instanceof ReferenceNode)) node.markDirty()
            }),
        { tag: "external" }
      )
  }, [value, materials, cwd, disabled])
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
      <MaterialPreviewDialog
        material={preview}
        cwd={props.cwd ?? ""}
        onClose={() => setPreview(null)}
      />
    </>
  )
}
