import { useEffect, useRef, useState, type CSSProperties } from "react"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block"

type Highlight = Awaited<
  ReturnType<typeof import("./message-highlight").highlightMessage>
>

export function MessageCode({
  source,
  language,
}: {
  source: string
  language?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [result, setResult] = useState<{
    source: string
    language: string
    lines: Highlight
  }>()
  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setVisible(true)
      observer.disconnect()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || !language || source.length > 48000) return
    let current = true
    const task = setTimeout(() => {
      void import("./message-highlight")
        .then(({ highlightMessage }) => highlightMessage(source, language))
        .then((lines) => {
          if (current) setResult({ source, language, lines })
        })
        .catch(() => {
          /* Keep the readable source when a grammar cannot load. */
        })
    }, 100)
    return () => {
      current = false
      clearTimeout(task)
    }
  }, [visible, language, source])
  const lines =
    result?.source === source && result.language === language
      ? result.lines
      : undefined
  return (
    <div ref={root} className="my-3 min-w-0">
      <CodeBlock>
        <CodeBlockHeader>
          <CodeBlockTitle>{language || "代码"}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={source} />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent
          lineNumbers={source.split("\n").length >= 12}
          data-highlighted={lines ? true : undefined}
        >
          {lines
            ? lines.map((line, index) => (
                <CodeBlockLine key={index}>
                  {line.map(({ content, light, dark }, tokenIndex) => (
                    <span
                      key={tokenIndex}
                      className="[color:var(--token-light)] dark:[color:var(--token-dark)]"
                      style={
                        {
                          "--token-light": light ?? "currentColor",
                          "--token-dark": dark ?? light ?? "currentColor",
                        } as CSSProperties
                      }
                    >
                      {content}
                    </span>
                  ))}
                </CodeBlockLine>
              ))
            : source}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  )
}
