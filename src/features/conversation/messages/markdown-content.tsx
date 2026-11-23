import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { FileText, ImageOff, Square, SquareCheck } from "lucide-react"
import Markdown, { defaultUrlTransform, type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { MessageCode } from "./message-code"
import { MessageMath } from "./message-math"
import { MaterialServiceContext } from "@/lib/composer/material-service-port"
import type {
  ConversationToolCall,
  MessageAttachment,
} from "../conversation-types"
import { useMessageEnvironment } from "./message-environment"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { useFilePreview } from "./use-file-preview"
import { isExternalMessageLink, localMessagePath } from "./message-path"
import "./messages.css"

const references = createContext<{
  images: { image: MessageAttachment; paths: string[] }[]
  artifacts: NonNullable<ConversationToolCall["artifact"]>[]
} | null>(null)

export function MarkdownReferencesProvider({
  tools,
  children,
}: {
  tools: ConversationToolCall[]
  children: ReactNode
}) {
  const complete = tools.filter((tool) => tool.status === "success")
  return (
    <references.Provider
      value={{
        images: complete.flatMap((tool) => {
          const image = tool.images?.length === 1 ? tool.images[0] : undefined
          const target = tool.target
          if (tool.name !== "read" || !image || target?.kind !== "file")
            return []
          return [
            {
              image: { ...image, kind: "image", materialType: "image" },
              paths: [
                target.path,
                target.displayPath,
                target.requestedPath,
              ].filter((path): path is string => !!path),
            },
          ]
        }),
        artifacts: complete.flatMap((tool) =>
          tool.artifact ? [tool.artifact] : []
        ),
      }}
    >
      {children}
    </references.Provider>
  )
}

function sameLocalPath(left: string | undefined, right: string) {
  if (!left) return false
  const normalize = (value: string) => {
    const path = value.replaceAll("\\", "/").replace(/^\.\//, "")
    return /^[a-z]:\//i.test(path) ? path.toLowerCase() : path
  }
  return normalize(left) === normalize(right)
}

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

const components: Components = {
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
      <LocalFileLink path={localMessagePath(href)!}>{children}</LocalFileLink>
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
  code: ({ className, children }) =>
    className?.includes("math-inline") ? (
      <MessageMath source={textContent(children)} />
    ) : (
      <code className={className}>{children}</code>
    ),
  pre: ({ children }) => {
    const code = Children.toArray(children).find((child) =>
      isValidElement(child)
    )
    const className = isValidElement<{ className?: string }>(code)
      ? code.props.className
      : undefined
    const source = textContent(children)
    return className?.includes("math-display") ? (
      <MessageMath source={source.trimEnd()} display />
    ) : (
      <MessageCode
        source={source}
        language={className?.match(/(?:^| )language-([^ ]+)/)?.[1]}
      />
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
}

export const MarkdownContent = memo(function MarkdownContent({
  text,
}: {
  text: string
}) {
  return (
    <div className="conversation-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        urlTransform={(url) =>
          localMessagePath(url) ? url : defaultUrlTransform(url)
        }
        components={components}
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
  const artifact = useContext(references)?.artifacts.find(
    (item) =>
      sameLocalPath(item.path, path) || sameLocalPath(item.displayPath, path)
  )
  const { pending, issue, open, available, onSettings } = useFilePreview(
    artifact?.path ?? path
  )
  return (
    <span className="conversation-local-link-control">
      <button
        type="button"
        className={
          artifact
            ? "inline-flex max-w-full items-center gap-2 rounded-md border bg-card px-2 py-1 align-middle text-sm text-card-foreground"
            : "conversation-local-link"
        }
        title={path}
        aria-busy={pending}
        disabled={pending || !available}
        onClick={() => {
          void open()
        }}
      >
        {artifact ? (
          <>
            <FileText className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{artifact.displayPath || children}</span>
          </>
        ) : (
          children
        )}
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
  const image = useContext(references)?.images.find(
    (item) =>
      path && item.paths.some((candidate) => sameLocalPath(candidate, path))
  )?.image
  if (image)
    return <PreparedInlineImage key={image.id} image={image} name={name} />
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

function PreparedInlineImage({
  image,
  name,
}: {
  image: MessageAttachment
  name: string
}) {
  const service = useContext(MaterialServiceContext)
  const environment = useMessageEnvironment()
  const cwd = environment?.cwd
  const anchor = useRef<HTMLButtonElement>(null)
  const [result, setResult] = useState<{ url?: string; failed?: boolean }>()
  useEffect(() => {
    if (!service || !cwd || !anchor.current) return
    const controller = new AbortController()
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      void service
        .preview(cwd, image.id, controller.signal)
        .then((preview) => {
          if (controller.signal.aborted) return
          if (
            preview.data &&
            /^image\/(?:png|jpeg|gif|webp)$/i.test(preview.mimeType)
          )
            setResult({
              url: `data:${preview.mimeType};base64,${preview.data}`,
            })
          else setResult({ failed: true })
        })
        .catch(() => {
          if (!controller.signal.aborted) setResult({ failed: true })
        })
    })
    observer.observe(anchor.current)
    return () => {
      observer.disconnect()
      controller.abort()
    }
  }, [cwd, image.id, service])
  return (
    <button
      ref={anchor}
      type="button"
      className="inline-flex max-w-full items-center rounded-md border bg-card p-1 align-middle text-sm"
      aria-label={`预览 ${name}`}
      disabled={!environment?.onOpenAttachment}
      onClick={() => environment?.onOpenAttachment?.(image)}
    >
      {result?.url ? (
        <img
          src={result.url}
          alt={name}
          className="max-h-64 max-w-full rounded-sm object-contain"
          onError={() => setResult({ failed: true })}
        />
      ) : (
        <span>{result?.failed ? `打开图片 · ${name}` : name}</span>
      )}
    </button>
  )
}
