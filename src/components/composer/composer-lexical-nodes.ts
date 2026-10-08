import {
  $getRoot,
  $isTextNode,
  $isElementNode,
  $createRangeSelection,
  $setSelection,
  TextNode,
  type LexicalNode,
  type ElementNode,
  type NodeKey,
  type SerializedTextNode,
  type EditorConfig,
} from "lexical"

import type { Material } from "@/lib/composer/types"
import { fileReferenceFeedback } from "@/features/materials/material-reference-feedback"

/** 引用节点及文本偏移桥；不持有 React 页面状态。 */
export type SerializedReference = SerializedTextNode & {
  referenceId: string
  source: string
  materialType?: Material["type"]
  status?: Material["status"]
  error?: string
  retryable?: boolean
}
export class ReferenceNode extends TextNode {
  __referenceId: string
  __source: string
  __materialType?: Material["type"]
  __status?: Material["status"]
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
        type: this.__materialType ?? "file",
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
export function referenceMatches(node: ReferenceNode, material: Material) {
  return (
    node.__referenceId === material.id ||
    (node.__source === (material.source ?? material.name) &&
      node.__materialType === material.type)
  )
}
export function offsetBefore(node: LexicalNode): number {
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
export function pointOffset(point: {
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
export function setCaret(start: number, end: number) {
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
