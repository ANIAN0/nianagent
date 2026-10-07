import { Button } from "@/components/ui/button"
import "./catalog-preview-status.css"

/** The shell and standalone preview share the same feedback presentation. */
export function CatalogPreviewStatus({
  error,
  onRetry,
}: {
  error?: string
  onRetry?: () => void
}) {
  return (
    <div
      className="catalog-preview-status"
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
    >
      <p>{error ?? "正在载入组件…"}</p>
      {error && onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试预览
        </Button>
      )}
    </div>
  )
}
