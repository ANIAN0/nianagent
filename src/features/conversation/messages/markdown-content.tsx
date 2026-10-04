import { Children, isValidElement, memo, type ReactNode } from "react"
import { ImageOff, Square, SquareCheck } from "lucide-react"
import Markdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { CopyButton } from "./copy-button"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { useFilePreview } from "./use-file-preview"
import { isExternalMessageLink, localMessagePath } from "./message-path"
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

export const MarkdownContent = memo(function MarkdownContent({
  text,
}: {
  text: string
}) {
  return (
    <div className="conversation-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          localMessagePath(url) ? url : defaultUrlTransform(url)
        }
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
          a: ({ children, href }) =>
            localMessagePath(href) ? (
              <LocalFileLink path={localMessagePath(href)!}>
                {children}
              </LocalFileLink>
            ) : isExternalMessageLink(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : href?.startsWith("#") ? (
              <a href={href}>{children}</a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) => (
            <ControlledMarkdownImage
              path={typeof src === "string" ? localMessagePath(src) : undefined}
              name={alt || "图片"}
            />
          ),
          pre: ({ children }) => {
            const code = Children.toArray(children).find((child) =>
              isValidElement(child)
            )
            const language = isValidElement<{ className?: string }>(code)
              ? code.props.className?.replace("language-", "")
              : undefined
            const source = textContent(children)
            const lines = source.split("\n")
            return (
              <div className="conversation-code-block">
                <div className="conversation-code-header">
                  <span>{language || "代码"}</span>
                  <CopyButton text={source} label="复制代码" />
                </div>
                <pre>
                  {lines.length >= 12 ? (
                    <code className="conversation-numbered-code">
                      {lines.map((line, index) => (
                        <span className="conversation-code-line" key={index}>
                          <span
                            className="conversation-code-line-number"
                            aria-hidden
                          >
                            {index + 1}
                          </span>
                          <span>{line || "\u00a0"}</span>
                        </span>
                      ))}
                    </code>
                  ) : (
                    children
                  )}
                </pre>
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
})

function LocalFileLink({
  path,
  children,
}: {
  path: string
  children: ReactNode
}) {
  const { pending, issue, open, available, onSettings } = useFilePreview(path)
  return (
    <span className="conversation-local-link-control">
      <button
        type="button"
        className="conversation-local-link"
        title={path}
        aria-busy={pending}
        disabled={pending || !available}
        onClick={() => {
          void open()
        }}
      >
        {children}
        {pending && <span className="sr-only">，正在读取文件</span>}
      </button>
      {issue && (
        <span className="conversation-inline-file-error" role="status">
          {issue.message}
          <RecoveryAction
            issue={issue}
            onRetry={() => {
              void open()
            }}
            onReload={() => {
              void open()
            }}
            onCheck={() => {
              void open()
            }}
            onSettings={onSettings}
            disabled={pending}
            labels={{
              retry: "重试预览",
              reload: "重新读取文件",
              check: "核对文件",
            }}
          />
        </span>
      )}
    </span>
  )
}

function ControlledMarkdownImage({
  path,
  name,
}: {
  path?: string
  name: string
}) {
  // Remote Markdown must not silently request arbitrary resources or load an
  // unbounded data URL. Local images go through the same guarded file preview.
  return (
    <span className="conversation-markdown-image">
      <ImageOff aria-hidden />
      {path ? (
        <LocalFileLink path={path}>预览图片 · {name}</LocalFileLink>
      ) : (
        <span>图片 · {name}（未提供可验证的本地材料）</span>
      )}
    </span>
  )
}
