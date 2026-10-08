import { useEffect, useState } from "react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { loadArchitecture } from "./catalog-data"
import { ArchitectureViewer } from "./components/architecture-viewer"

export default function ArchitecturePanel({ module }: { module: string }) {
  const [content, setContent] = useState("")
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let mounted = true
    void loadArchitecture().then(
      (text) => {
        if (mounted) {
          setContent(text)
          setError("")
        }
      },
      (cause: unknown) => {
        if (mounted)
          setError(
            cause instanceof Error ? cause.message : "架构说明载入失败。"
          )
      }
    )
    return () => {
      mounted = false
    }
  }, [revision])
  if (error)
    return (
      <OperationFeedback
        title="无法载入架构说明"
        message={error}
        notify={false}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              setError("")
              setRevision((old) => old + 1)
            }}
          >
            重新载入
          </Button>
        }
      />
    )
  if (!content)
    return (
      <div
        role="status"
        aria-label="载入架构说明"
        className="flex flex-col gap-4"
      >
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  return (
    <ArchitectureViewer
      content={content}
      module={module}
      sectionTitle={module}
      focusOnMount
    />
  )
}
