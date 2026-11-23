import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockLine,
} from "@/components/ui/code-block"
import { lazy, Suspense } from "react"
import { PageErrorBoundary } from "@/components/feedback/page-error-boundary"
const Patch = lazy(() =>
  import("@pierre/diffs/react").then((module) => ({
    default: module.PatchDiff,
  }))
)
type ReadOnlyPatchProps =
  | { patch: string; legacyDiff?: never; firstChangedLine?: never }
  | { patch?: never; legacyDiff: string; firstChangedLine?: number }

export function ReadOnlyPatch({
  patch,
  legacyDiff,
  firstChangedLine,
}: ReadOnlyPatchProps) {
  if (legacyDiff !== undefined)
    return (
      <CodeBlock size="sm">
        <CodeBlockContent
          aria-label={
            firstChangedLine
              ? `实际文件差异，首处修改在第 ${firstChangedLine} 行`
              : "实际文件差异"
          }
        >
          {legacyDiff.split("\n").map((line, index) => (
            <CodeBlockLine
              key={index}
              variant={
                line.startsWith("+")
                  ? "added"
                  : line.startsWith("-")
                    ? "removed"
                    : "default"
              }
            >
              {/^[+-]/.test(line) ? line.slice(1) : line}
            </CodeBlockLine>
          ))}
        </CodeBlockContent>
      </CodeBlock>
    )
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
