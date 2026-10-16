import { useEffect, useLayoutEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { defaultKeymap } from "@codemirror/commands"
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { javascript } from "@codemirror/lang-javascript"
import { markdown } from "@codemirror/lang-markdown"

export type SourceSelection = {
  text: string
  lineStart: number
  lineEnd: number
  columnStart: number
  columnEnd: number
}
type Props = {
  content: string
  name: string
  line: number
  scroll: number
  onScroll: (scroll: number) => void
  onSelect: (selection: SourceSelection | undefined) => void
}
export function SourceViewer(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  }, [props])
  useEffect(() => {
    if (!container.current) return
    const extension = props.name.split(".").at(-1)?.toLowerCase()
    const language = ["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(
      extension || ""
    )
      ? javascript({
          typescript: extension === "ts" || extension === "tsx",
          jsx: extension === "jsx" || extension === "tsx",
        })
      : ["md", "markdown", "mdown"].includes(extension || "")
        ? markdown()
        : []
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: props.content,
        extensions: [
          ...(props.content.includes("\r\n") &&
          !/[\r\n]/.test(props.content.replaceAll("\r\n", ""))
            ? [EditorState.lineSeparator.of("\r\n")]
            : []),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            "aria-label": "当前文件源码",
            tabindex: "0",
          }),
          keymap.of(defaultKeymap),
          lineNumbers({
            formatNumber: (line) => String(line + props.line - 1),
          }),
          syntaxHighlighting(defaultHighlightStyle),
          language,
          EditorView.domEventHandlers({
            scroll: (_event, view) => {
              latest.current.onScroll(view.scrollDOM.scrollTop)
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.selectionSet) return
            const selection = update.state.selection.main
            if (selection.empty) {
              latest.current.onSelect(undefined)
              return
            }
            const from = update.state.doc.lineAt(selection.from),
              to = update.state.doc.lineAt(selection.to)
            latest.current.onSelect({
              text: (() => {
                // Map the actual editor line/column back to source line starts.
                // This also preserves mixed CRLF/LF bytes without offset drift.
                const starts = [0]
                for (const match of props.content.matchAll(/\r\n|\r|\n/g))
                  starts.push(match.index + match[0].length)
                return props.content.slice(
                  starts[from.number - 1] + selection.from - from.from,
                  starts[to.number - 1] + selection.to - to.from
                )
              })(),
              lineStart: latest.current.line + from.number - 1,
              lineEnd: latest.current.line + to.number - 1,
              columnStart: selection.from - from.from + 1,
              columnEnd: selection.to - to.from + 1,
            })
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
            },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              lineHeight: "20px",
            },
            ".cm-gutters": {
              backgroundColor: "var(--muted)",
              color: "var(--muted-foreground)",
              border: "none",
            },
            ".cm-content": { minHeight: "100%", paddingLeft: "6px" },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
    })
    editor.current = view
    const frame = requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = latest.current.scroll
    })
    return () => {
      cancelAnimationFrame(frame)
      view.destroy()
      editor.current = null
    }
  }, [props.content, props.name, props.line])
  useLayoutEffect(() => {
    const view = editor.current
    if (view && Math.abs(view.scrollDOM.scrollTop - props.scroll) > 1)
      view.scrollDOM.scrollTop = props.scroll
  }, [props.scroll])
  return <div className="file-source" ref={container} />
}
