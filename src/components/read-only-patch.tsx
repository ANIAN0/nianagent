import { lazy, Suspense } from "react"
import { PageErrorBoundary } from "@/components/feedback/page-error-boundary"
const Patch = lazy(() =>
  import("@pierre/diffs/react").then((module) => ({
    default: module.PatchDiff,
  }))
)
export function ReadOnlyPatch({ patch }: { patch: string }) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<p role="status">正在加载差异查看器…</p>}>
        <Patch
          patch={patch}
          options={{ diffStyle: "unified" }}
          disableWorkerPool
        />
      </Suspense>
    </PageErrorBoundary>
  )
}
