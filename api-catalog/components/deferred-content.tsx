import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import { Button } from "@/components/ui/button"

function ResolvedContent({
  children,
  onReady,
}: {
  children: ReactNode
  onReady?: () => void
}) {
  useEffect(() => onReady?.(), [onReady])
  return children
}

class LoadingBoundary extends Component<
  {
    children: ReactNode
    label: string
    onRetry: () => void
    onDismiss?: () => void
  },
  { error: boolean }
> {
  state = { error: false }

  static getDerivedStateFromError() {
    return { error: true }
  }

  render() {
    if (this.state.error)
      return (
        <div className="api-deferred-error" role="alert">
          <p>{this.props.label}载入失败，当前草稿仍保留。</p>
          <Button variant="outline" size="sm" onClick={this.props.onRetry}>
            重新载入
          </Button>
          {this.props.onDismiss && (
            <Button variant="ghost" size="sm" onClick={this.props.onDismiss}>
              关闭
            </Button>
          )}
        </div>
      )
    return this.props.children
  }
}

/** Mount only after user intent. Retry remounts the view, which owns its focus target. */
export function DeferredContent<P extends object>({
  load,
  props,
  label,
  fallback,
  onDismiss,
  onRetryReady,
}: {
  load: () => Promise<{ default: ComponentType<P> }>
  props: P
  label: string
  fallback: ReactNode
  onDismiss?: () => void
  onRetryReady?: () => void
}) {
  const [content, setContent] = useState(() => ({
    View: lazy(load),
    attempt: 0,
  }))
  const View = content.View
  return (
    <LoadingBoundary
      key={content.attempt}
      label={label}
      onRetry={() =>
        setContent((current) => ({
          View: lazy(load),
          attempt: current.attempt + 1,
        }))
      }
      onDismiss={onDismiss}
    >
      <Suspense fallback={fallback}>
        <ResolvedContent onReady={content.attempt ? onRetryReady : undefined}>
          <View {...props} />
        </ResolvedContent>
      </Suspense>
    </LoadingBoundary>
  )
}
