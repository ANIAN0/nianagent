import { useEffect, useState } from "react"
import { ChevronRight, FileCode } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Button } from "@/components/ui/button"
import { loadSource, type CatalogMetadata } from "./catalog"

/** Source is requested only when opened, and stale requests cannot update another entry. */
export function CatalogSource({
  entry,
  readSource = loadSource,
  defaultOpen = false,
}: {
  entry: CatalogMetadata
  readSource?: (entry: CatalogMetadata, signal?: AbortSignal) => Promise<string>
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    source: string | null
    error: string
  }>({ source: null, error: "" })
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    readSource(entry, controller.signal).then(
      (source) => {
        if (!controller.signal.aborted) setResult({ source, error: "" })
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            source: null,
            error: error instanceof Error ? error.message : "源码暂时无法读取",
          })
      }
    )
    return () => controller.abort()
  }, [open, attempt, entry, readSource])
  return (
    <section>
      <h3>正式源码</h3>
      <code className="catalog-source-path">
        <FileCode aria-hidden="true" size={14} />
        {entry.source}
      </code>
      <details
        className="catalog-source"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <ChevronRight aria-hidden="true" size={14} />
          查看正式实现
        </summary>
        {open &&
          (result.error ? (
            <OperationFeedback
              title="源码读取失败"
              message={result.error}
              notify={false}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setResult({ source: null, error: "" })
                    setAttempt((value) => value + 1)
                  }}
                >
                  重试
                </Button>
              }
            />
          ) : result.source === null ? (
            <p className="catalog-source-loading" role="status">
              正在读取源码…
            </p>
          ) : (
            <pre tabIndex={0} aria-label={`${entry.name}源码`}>
              <code>{result.source}</code>
            </pre>
          ))}
      </details>
    </section>
  )
}
