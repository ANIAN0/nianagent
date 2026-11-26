import { useEffect, useRef, useState } from "react"
import { EditorState, RangeSetBuilder } from "@codemirror/state"
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Bold,
  Code,
  Columns2,
  Eye,
  FileCode2,
  Heading2,
  Italic,
  List,
  Pencil,
  Quote,
} from "lucide-react"
import { Button } from "@/components/ui/button"

type ViewMode = "edit" | "split" | "preview"

export type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  defaultMode?: ViewMode
  minHeightClass?: string
}

const markHeading = Decoration.mark({ class: "cm-md-heading" })
const markMeta = Decoration.mark({ class: "cm-md-meta" })
const markQuote = Decoration.mark({ class: "cm-md-quote" })
const markCodeBlock = Decoration.mark({ class: "cm-md-codeblock" })
const markInlineCode = Decoration.mark({ class: "cm-md-code" })
const markStrong = Decoration.mark({ class: "cm-md-strong" })
const markEmphasis = Decoration.mark({ class: "cm-md-em" })
const markLink = Decoration.mark({ class: "cm-md-link" })

function buildMarkdownDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  let inFence = false

  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo)
    const text = line.text

    if (/^\s*```/.test(text)) {
      builder.add(line.from, line.to, markMeta)
      inFence = !inFence
      continue
    }
    if (inFence) {
      if (line.from < line.to) builder.add(line.from, line.to, markCodeBlock)
      continue
    }

    // 标题行
    const headingMatch = /^(\s*#{1,6}\s+)(.*)$/.exec(text)
    if (headingMatch) {
      const markEnd = line.from + headingMatch[1].length
      builder.add(line.from, markEnd, markMeta)
      if (markEnd < line.to) builder.add(markEnd, line.to, markHeading)
      continue
    }

    // 收集行内装饰，按起点排序后写入 RangeSetBuilder
    const spans: Array<{ from: number; to: number; deco: Decoration }> = []

    const quoteMatch = /^(\s*>\s?)(.*)$/.exec(text)
    if (quoteMatch) {
      spans.push({
        from: line.from,
        to: line.from + quoteMatch[1].length,
        deco: markMeta,
      })
      if (line.from + quoteMatch[1].length < line.to) {
        spans.push({
          from: line.from + quoteMatch[1].length,
          to: line.to,
          deco: markQuote,
        })
      }
    } else {
      const listMatch = /^(\s*(?:[-*+]|\d+\.)\s+)/.exec(text)
      if (listMatch) {
        spans.push({
          from: line.from,
          to: line.from + listMatch[1].length,
          deco: markMeta,
        })
      }
    }

    // 行内代码 / 加粗 / 链接 / 斜体（跳过重叠区域）
    const occupied: Array<[number, number]> = []
    const overlaps = (start: number, end: number) =>
      occupied.some(([a, b]) => start < b && end > a)

    for (const match of text.matchAll(/`[^`\n]+`/g)) {
      const from = line.from + match.index
      const to = from + match[0].length
      if (!overlaps(from, to)) {
        occupied.push([from, to])
        spans.push({ from, to, deco: markInlineCode })
      }
    }
    for (const match of text.matchAll(/\[[^\]\n]+\]\([^)\n]+\)/g)) {
      const from = line.from + match.index
      const to = from + match[0].length
      if (!overlaps(from, to)) {
        occupied.push([from, to])
        spans.push({ from, to, deco: markLink })
      }
    }
    for (const match of text.matchAll(/\*\*[^*\n]+\*\*/g)) {
      const from = line.from + match.index
      const to = from + match[0].length
      if (!overlaps(from, to)) {
        occupied.push([from, to])
        spans.push({ from, to, deco: markStrong })
      }
    }
    for (const match of text.matchAll(/(?<!\*)\*[^*\n]+\*(?!\*)/g)) {
      const from = line.from + match.index
      const to = from + match[0].length
      if (!overlaps(from, to)) {
        occupied.push([from, to])
        spans.push({ from, to, deco: markEmphasis })
      }
    }

    spans.sort((a, b) => a.from - b.from || a.to - b.to)
    for (const item of spans) {
      if (item.from < item.to) builder.add(item.from, item.to, item.deco)
    }
  }

  return builder.finish()
}

const markdownHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildMarkdownDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildMarkdownDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    lineHeight: "22px",
  },
  ".cm-gutters": {
    backgroundColor: "color-mix(in oklab, var(--muted) 45%, transparent)",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)",
    minWidth: "36px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 6px",
    fontSize: "11px",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--muted) 35%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklab, var(--muted) 75%, transparent)",
    color: "var(--foreground)",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "10px 12px",
    caretColor: "var(--foreground)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
  },
  ".cm-md-heading": {
    color: "var(--primary)",
    fontWeight: "600",
  },
  ".cm-md-meta": {
    color: "var(--muted-foreground)",
    fontWeight: "500",
  },
  ".cm-md-quote": {
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
  ".cm-md-strong": {
    fontWeight: "700",
    color: "var(--foreground)",
  },
  ".cm-md-em": {
    fontStyle: "italic",
  },
  ".cm-md-code": {
    color: "#0f766e",
    backgroundColor: "color-mix(in oklab, var(--muted) 70%, transparent)",
    borderRadius: "4px",
    padding: "0 3px",
  },
  ".cm-md-codeblock": {
    color: "#0f766e",
  },
  ".cm-md-link": {
    color: "#2563eb",
    textDecoration: "underline",
  },
  "&.cm-focused": {
    outline: "none",
  },
})

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "在此编写 Markdown 内容…",
  ariaLabel = "Markdown 编辑器",
  defaultMode = "split",
  minHeightClass = "h-[420px]",
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<ViewMode>(defaultMode)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (mode === "preview") return
    const container = hostRef.current
    if (!container) return

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          EditorView.lineWrapping,
          highlightSelectionMatches(),
          markdown(),
          markdownHighlightPlugin,
          cmPlaceholder(placeholder),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
          editorTheme,
        ],
      }),
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅在切换回可见编辑态或基础配置变化时重建实例；内容同步由下方 effect 负责
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, placeholder, ariaLabel])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      })
    }
  }, [value])

  const wrapSelection = (before: string, after: string, fallback: string) => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const selected = view.state.sliceDoc(from, to)
    const inner = selected || fallback
    const insert = `${before}${inner}${after}`
    view.dispatch({
      changes: { from, to, insert },
      selection: {
        anchor: from + before.length,
        head: from + before.length + inner.length,
      },
    })
    view.focus()
  }

  const prefixLine = (prefix: string) => {
    const view = viewRef.current
    if (!view) return
    const { from } = view.state.selection.main
    const line = view.state.doc.lineAt(from)
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: prefix },
      selection: { anchor: from + prefix.length },
    })
    view.focus()
  }

  const showEditor = mode === "edit" || mode === "split"
  const showPreview = mode === "preview" || mode === "split"

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-background">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="二级标题"
            aria-label="二级标题"
            disabled={!showEditor}
            onClick={() => prefixLine("## ")}
          >
            <Heading2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="加粗"
            aria-label="加粗"
            disabled={!showEditor}
            onClick={() => wrapSelection("**", "**", "加粗文本")}
          >
            <Bold className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="斜体"
            aria-label="斜体"
            disabled={!showEditor}
            onClick={() => wrapSelection("*", "*", "斜体文本")}
          >
            <Italic className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="行内代码"
            aria-label="行内代码"
            disabled={!showEditor}
            onClick={() => wrapSelection("`", "`", "code")}
          >
            <Code className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="代码块"
            aria-label="代码块"
            disabled={!showEditor}
            onClick={() => wrapSelection("```\n", "\n```", "代码内容")}
          >
            <FileCode2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="无序列表"
            aria-label="无序列表"
            disabled={!showEditor}
            onClick={() => prefixLine("- ")}
          >
            <List className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="引用"
            aria-label="引用"
            disabled={!showEditor}
            onClick={() => prefixLine("> ")}
          >
            <Quote className="size-3.5" />
          </Button>
        </div>

        <div
          role="group"
          aria-label="编辑器视图模式"
          className="inline-flex h-7 items-center rounded-md bg-muted p-0.5"
        >
          {(
            [
              { id: "edit", label: "编辑", icon: Pencil },
              { id: "split", label: "分栏", icon: Columns2 },
              { id: "preview", label: "预览", icon: Eye },
            ] as const
          ).map((item) => {
            const Icon = item.icon
            const active = mode === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                className={
                  active
                    ? "inline-flex h-full items-center gap-1 rounded-sm bg-background px-2 text-xs font-medium text-foreground shadow-2xs"
                    : "inline-flex h-full items-center gap-1 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground"
                }
                onClick={() => setMode(item.id)}
              >
                <Icon className="size-3" />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 编辑与预览主体：固定稳定高度，切换模式或增删内容不引起弹窗跳动 */}
      <div
        className={`grid shrink-0 overflow-hidden ${minHeightClass} ${
          mode === "split" ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {showEditor && (
          <div
            ref={hostRef}
            className={`h-full min-h-0 min-w-0 overflow-hidden ${
              mode === "split" ? "border-b md:border-r md:border-b-0" : ""
            }`}
          />
        )}
        {showPreview && (
          <div className="moon-scrollbar h-full min-h-0 min-w-0 overflow-auto bg-card/40 p-4">
            {value.trim() ? (
              <article className="space-y-3 text-xs leading-6 text-foreground [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-semibold [&_hr]:border-border [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/60 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
                <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
              </article>
            ) : (
              <p className="text-xs text-muted-foreground">暂无预览内容</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
