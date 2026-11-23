import { useEffect, useState } from "react"

export function MessageMath({
  source,
  display = false,
}: {
  source: string
  display?: boolean
}) {
  const [result, setResult] = useState<{
    source: string
    display: boolean
    html: string
  }>()
  useEffect(() => {
    let current = true
    void Promise.all([import("katex"), import("katex/dist/katex.min.css")])
      .then(([{ default: katex }]) =>
        katex.renderToString(source, {
          displayMode: display,
          throwOnError: true,
          trust: false,
        })
      )
      .then((html) => {
        if (current) setResult({ source, display, html })
      })
      .catch(() => {
        /* The source remains readable until the formula is valid. */
      })
    return () => {
      current = false
    }
  }, [source, display])
  const html =
    result?.source === source && result.display === display
      ? result.html
      : undefined
  const Tag = display ? "div" : "span"
  return html ? (
    <Tag
      className={display ? "overflow-x-auto" : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <Tag>
      <code>{source}</code>
    </Tag>
  )
}
