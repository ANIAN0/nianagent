"use client"

// Markdown 阅读器（T06/T09 呈现层）：渲染冻结块投影、锚点高亮、授权图片资源。
// 定位/评论提交由工作台壳负责；本组件只消费 ReaderProps 契约。
import { useEffect, useRef, type RefObject } from "react"
import type { ReaderProps } from "../reader-registry"

/** 相对资源路径改写为授权加载标记；外链/数据图保持原样。 */
export const renderAssets = (html: string) =>
  html.replace(/(src)="([^"]+)"/g, (match, attr, src) =>
    /^(https?:|data:)/i.test(src)
      ? match
      : `${attr}="" data-asset="${src.replace(/^\.?\//, "")}"`
  )

type MarkdownAnchor =
  | {
      kind: "markdown"
      block: number
      start: number
      end: number
      quote: string
    }
  | {
      kind: "markdown"
      segments: { block: number; start: number; end: number; quote: string }[]
    }

const isMarkdownAnchor = (
  anchor: ReaderProps["threads"][number]["anchor"]
): anchor is MarkdownAnchor => anchor.kind === "markdown"

/** 把块内码点偏移换算为该文本节点内的 UTF-16 偏移（Range API 使用 UTF-16 单位）。
 * AC17-二轮：此前双码点分支提前返回，("😀x",1) 返回 0 而非 2。 */
const utf16Offset = (text: string, codepoints: number) => {
  let consumed = 0
  for (let index = 0; index < text.length;) {
    if (consumed >= codepoints) return index
    const point = text.codePointAt(index) ?? 0
    consumed += 1
    index += point > 0xffff ? 2 : 1
  }
  return text.length
}

/** AC17-二轮：结构空白修剪——移除容器首/尾的仅空白文本节点（marked 块输出的
 * 块间换行），递归处理 ul/blockquote/table 等嵌套边界，使 DOM 文本与冻结投影
 * 逐字一致；不触碰元素、属性与非边界空白（列表项间换行属投影内容，保留）。 */
const normalizedTextNodes = new WeakSet<Text>()
export const pruneStructuralWhitespace = (element: HTMLElement) => {
  const containers = new Set([
    "DIV",
    "SECTION",
    "UL",
    "OL",
    "LI",
    "BLOCKQUOTE",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
  ])
  const prune = (parent: Node) => {
    if (parent instanceof HTMLElement && parent.tagName === "PRE") {
      // marked 给代码块补的最后一个换行不属于源文本；只移除这一个。
      const code = parent.querySelector("code")
      const last = code?.lastChild
      if (last instanceof Text && !normalizedTextNodes.has(last)) {
        if (last.data.endsWith("\n")) last.data = last.data.slice(0, -1)
        normalizedTextNodes.add(last)
      }
      return
    }
    for (const child of Array.from(parent.childNodes)) {
      if (child instanceof Text) {
        if (
          parent instanceof HTMLElement &&
          containers.has(parent.tagName) &&
          !/\S/.test(child.data)
        ) {
          child.remove()
        } else if (
          child.previousSibling instanceof HTMLInputElement &&
          child.previousSibling.type === "checkbox" &&
          child.data.startsWith(" ") &&
          !normalizedTextNodes.has(child)
        ) {
          child.data = child.data.slice(1)
          normalizedTextNodes.add(child)
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) prune(child)
    }
  }
  prune(element)
}

export type ProjectionSpan = { node: Text; start: number; length: number }

/** AC17-三轮：按块类型构建「DOM 文本节点 → 投影码点偏移」有序映射。
 * - 普通块：修剪后 DOM 文本顺序即投影文本；
 * - 表格块：行内单元格之间 " | "（3 码点）、行之间换行（1 码点），与冻结投影
 *   cells.join(" | ")/rows.join("\n") 的构造完全一致——表格不再被排除；
 * 返回 spans、重建投影文本与总长；调用方以块冻结文本校验不变量。 */
export function buildProjectionSpans(
  element: HTMLElement,
  kind: string
): { spans: ProjectionSpan[]; text: string; length: number } {
  const spans: ProjectionSpan[] = []
  const parts: string[] = []
  // AC17-四轮：span.start/length 与定位/截取统一码点单位（此前 start 用 UTF-16、
  // length 用码点——emoji 前内容会使后续 span 全部偏移）。text 重建仍为 UTF-16
  // 字符串，仅用于与冻结文本全等比较。
  let cpStart = 0
  const pushText = (node: Node) => {
    const text = (node as Text).data
    const cps = [...text].length
    if (cps === 0) return
    spans.push({ node: node as Text, start: cpStart, length: cps })
    parts.push(text)
    cpStart += cps
  }
  const separator = (text: string) => {
    parts.push(text)
    cpStart += [...text].length
  }
  const visit = (node: Node) => {
    if (node instanceof Text) {
      pushText(node)
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.tagName === "BR") {
      separator("\n")
      return
    }
    if (node instanceof HTMLImageElement) {
      separator(node.alt)
      return
    }
    if (node.tagName === "INPUT") return
    const children = Array.from(node.childNodes)
    if (node.tagName === "UL" || node.tagName === "OL") {
      const items = Array.from(node.children).filter(
        (child) => child.tagName === "LI"
      )
      items.forEach((child, index) => {
        if (index) separator("\n")
        visit(child)
      })
    } else if (node.tagName === "BLOCKQUOTE") {
      children.forEach((child, index) => {
        if (index) separator("\n")
        visit(child)
      })
    } else if (node.tagName === "LI") {
      let hasContent = false
      for (const child of children) {
        if (child instanceof HTMLInputElement) continue
        if (
          hasContent &&
          child instanceof HTMLElement &&
          ["UL", "OL", "P", "PRE", "BLOCKQUOTE"].includes(child.tagName)
        )
          separator(" ")
        const before = cpStart
        visit(child)
        hasContent ||= cpStart > before
      }
    } else {
      children.forEach(visit)
    }
  }
  if (kind === "table") {
    const rows = Array.from(element.querySelectorAll("tr"))
    rows.forEach((row, rowIndex) => {
      if (rowIndex) separator("\n")
      Array.from(row.children).forEach((cell, cellIndex) => {
        if (cellIndex) separator(" | ")
        visit(cell)
      })
    })
  } else visit(element)
  const text = parts.join("")
  const length = cpStart
  return { spans, text, length }
}

/** 定位：UTF-16 节点偏移 → 投影码点偏移；节点不在映射内返回 null（不猜测）。 */
export function projectionOffsetFor(
  spans: ProjectionSpan[],
  node: Node,
  utf16: number
): number | null {
  const span = spans.find((item) => item.node === node)
  if (!span) {
    // 双击行尾或跨元素选择时，Range 端点可以是元素的子节点索引。
    // 按实际 DOM 边界排序映射，不能把合法元素端点误报为冻结内容损坏。
    if (
      node.nodeType !== Node.ELEMENT_NODE ||
      utf16 < 0 ||
      utf16 > node.childNodes.length ||
      spans.length === 0
    )
      return null
    const boundary = document.createRange()
    boundary.setStart(node, utf16)
    boundary.collapse(true)
    for (const item of spans) {
      if (boundary.comparePoint(item.node, 0) >= 0) return item.start
    }
    const last = spans[spans.length - 1]
    return last.start + last.length
  }
  const text = (node as Text).data
  return span.start + [...text.slice(0, utf16)].length
}

export function useMarkdownHighlights(
  rootRef: RefObject<HTMLDivElement | null>,
  blocks: NonNullable<ReaderProps["version"]["blocks"]>,
  threads: ReaderProps["threads"],
  name: string
) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const registry =
      typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null
    registry?.delete(name)
    const anchors = threads
      .map((thread) => thread.anchor)
      .filter(isMarkdownAnchor)
    if (anchors.length === 0) return
    const ranges: Range[] = []
    const collect = (blockIndex: number, startCp: number, endCp: number) => {
      const element = root.querySelector<HTMLElement>(
        `[data-block="${blockIndex}"]`
      )
      if (!element) return
      const frozen = blocks.find((block) => block.index === blockIndex)?.text
      if (frozen === undefined) return
      const kind = element.dataset.blockKind ?? "markdown"
      const { spans, text, length } = buildProjectionSpans(element, kind)
      // 投影不变量守护：重建投影与冻结文本不一致时放弃该块高亮（不猜测映射）
      if (text !== frozen || length !== [...frozen].length) return
      for (const span of spans) {
        const spanEnd = span.start + span.length
        if (spanEnd <= startCp || span.start >= endCp) continue
        const fromCp = Math.max(startCp, span.start) - span.start
        const toCp = Math.min(endCp, spanEnd) - span.start
        const range = document.createRange()
        range.setStart(span.node, utf16Offset(span.node.data, fromCp))
        range.setEnd(span.node, utf16Offset(span.node.data, toCp))
        if (!range.collapsed) ranges.push(range)
      }
    }
    for (const anchor of anchors) {
      if ("segments" in anchor)
        for (const segment of anchor.segments)
          collect(segment.block, segment.start, segment.end)
      else collect(anchor.block, anchor.start, anchor.end)
    }
    if (ranges.length > 0 && typeof Highlight !== "undefined" && registry)
      registry.set(name, new Highlight(...ranges))
    return () => {
      registry?.delete(name)
    }
  }, [threads, blocks, rootRef, name])
}

export function MarkdownReader({
  version,
  threads,
  containerRef,
  onSelect,
}: ReaderProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const pruneRef = (element: HTMLDivElement | null) => {
    if (element) pruneStructuralWhitespace(element)
  }
  // AC17：高亮按冻结投影偏移映射（block.start/end 为码点偏移），不再对原始 HTML 按
  // quote 正则替换——重复词、富文本、emoji、跨块与重叠意见均按偏移精确定位，
  // 且经 CSS Custom Highlight 呈现，不改写 DOM 属性。
  const blocks = version.blocks ?? []
  useMarkdownHighlights(rootRef, blocks, threads, "v2-anchor")

  return (
    <div
      ref={containerRef}
      className="min-w-0 flex-1 overflow-auto bg-card px-8 py-10"
      onMouseUp={onSelect}
    >
      <div ref={rootRef} className="mx-auto max-w-3xl pb-20">
        {blocks.map((block) => (
          <div
            key={block.index}
            ref={pruneRef}
            className="v2-block mb-3"
            data-block={block.index}
            data-block-kind={block.type}
            dangerouslySetInnerHTML={{ __html: renderAssets(block.html) }}
          />
        ))}
      </div>
      <style>{markdownReaderStyles}</style>
    </div>
  )
}

export const markdownReaderStyles = `
  .v2-block h1 { font-size: 1.4rem; font-weight: 600; margin: 0.8rem 0 0.4rem; color: var(--foreground); }
  .v2-block h2 { font-size: 1.2rem; font-weight: 600; margin: 0.7rem 0 0.35rem; color: var(--foreground); }
  .v2-block h3 { font-size: 1.05rem; font-weight: 600; margin: 0.6rem 0 0.3rem; color: var(--foreground); }
  .v2-block p { margin: 0.4rem 0; line-height: 1.7; color: var(--foreground); }
  .v2-block ul, .v2-block ol { margin: 0.4rem 0 0.4rem 1.4rem; list-style: revert; color: var(--foreground); }
  .v2-block li { margin: 0.15rem 0; line-height: 1.6; }
  .v2-block blockquote { border-left: 3px solid var(--border); padding-left: 0.8rem; color: var(--muted-foreground); margin: 0.5rem 0; }
  .v2-block img { display: inline-block; max-width: min(100%, 560px); border-radius: 6px; }
  .v2-block pre { background: var(--muted); color: var(--foreground); padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 0.85em; border: 1px solid var(--border); }
  .v2-block code { background: var(--muted); color: var(--foreground); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
  .v2-block pre code { background: transparent; padding: 0; border: 0; }
  .v2-block table { border-collapse: collapse; margin: 0.5rem 0; }
  .v2-block th, .v2-block td { border: 1px solid var(--border); padding: 6px 10px; color: var(--foreground); }
  .v2-block th { background: var(--muted); font-weight: 600; }
  .v2-block a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
  ::highlight(v2-anchor), ::highlight(v2-left-anchor), ::highlight(v2-right-anchor) { background: rgba(250, 204, 21, 0.38); border-radius: 2px; }
`
