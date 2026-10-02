import { Children, isValidElement, type ReactNode } from "react"
import { Square, SquareCheck } from "lucide-react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { CopyButton } from "./copy-button"
import "./messages.css"

function textContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? textContent(child.props.children)
          : ""
    )
    .join("")
}

export function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="conversation-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          input: ({ checked }) => (
            <span
              className="conversation-task-state"
              data-checked={Boolean(checked)}
              role="img"
              aria-label={checked ? "已完成" : "未完成"}
            >
              {checked ? <SquareCheck aria-hidden /> : <Square aria-hidden />}
            </span>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => {
            const code = Children.toArray(children).find((child) =>
              isValidElement(child)
            )
            const language = isValidElement<{ className?: string }>(code)
              ? code.props.className?.replace("language-", "")
              : undefined
            return (
              <div className="conversation-code-block">
                <div className="conversation-code-header">
                  <span>{language || "代码"}</span>
                  <CopyButton
                    text={textContent(children).replace(/\n$/, "")}
                    label="复制代码"
                  />
                </div>
                <pre>{children}</pre>
              </div>
            )
          },
          table: ({ children }) => (
            <div
              className="conversation-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="表格"
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
