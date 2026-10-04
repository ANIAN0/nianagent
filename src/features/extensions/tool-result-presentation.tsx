import { Component, Suspense, useMemo, type ReactNode } from "react"
import type { ConversationToolCall } from "@/features/conversation/conversation-types"
import { useMessageEnvironment } from "@/features/conversation/messages/message-environment"
import { findResultRenderer } from "./result-renderers"

class PresentationBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <>
        <p className="conversation-result-note" role="status">
          扩展展示不可用，以下保留实际工具结果。
        </p>
        {this.props.fallback}
      </>
    ) : (
      this.props.children
    )
  }
}

/** A presentation failure cannot change recorded tool status or rerun its side effects. */
export function ToolResultPresentation({
  tool,
  fallback,
}: {
  tool: ConversationToolCall
  fallback: ReactNode
}) {
  const environment = useMessageEnvironment()
  const presentation = tool.presentation
  const declaration =
    presentation && findResultRenderer(presentation.kind, presentation.version)
  const Renderer = declaration?.component
  const publicTool = useMemo(
    () =>
      Object.freeze({
        id: tool.id,
        name: tool.name,
        source: tool.source,
        status: tool.status,
        input: tool.input,
        result: tool.result,
      }),
    [tool]
  )
  let payload: unknown
  try {
    payload = presentation ? JSON.parse(presentation.payload) : undefined
  } catch {
    return <>{fallback}</>
  }
  if (!presentation || !Renderer || tool.status !== "success")
    return <>{fallback}</>
  return (
    <PresentationBoundary
      key={`${tool.occurrenceId ?? tool.id}:${presentation.kind}:${presentation.version}`}
      fallback={fallback}
    >
      <Suspense
        fallback={
          <p className="conversation-result-note" role="status">
            正在载入结果展示…
          </p>
        }
      >
        <Renderer
          payload={payload}
          tool={publicTool}
          onOpenPath={environment?.onOpenPath}
        />
      </Suspense>
    </PresentationBoundary>
  )
}
