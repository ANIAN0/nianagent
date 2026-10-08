import { Component, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

/** 只重建出错的展示子树；会话、草稿和原请求 owner 应放在边界上方。 */
export class PageErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <section role="alert" className="p-6">
          <p>当前页面未能显示，已保存的内容和原操作记录保留。</p>
          <Button
            variant="outline"
            onClick={() => this.setState({ failed: false })}
          >
            重新显示
          </Button>
        </section>
      )
    return this.props.children
  }
}
