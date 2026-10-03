import { useEffect, useRef, type ComponentProps } from "react"
import { ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RequestEditor } from "./request-editor"
import { ResponseViewer } from "./response-viewer"

export type DebugPanelProps = {
  request: ComponentProps<typeof RequestEditor>
  response: ComponentProps<typeof ResponseViewer>
  onClose: () => void
  focusOnMount?: boolean
}

export default function DebugPanel({
  request,
  response,
  onClose,
  focusOnMount = false,
}: DebugPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnMount) heading.current?.focus({ preventScroll: true })
  }, [focusOnMount, request.operation])
  return (
    <div className="api-debug-panel">
      <div className="api-debug-heading">
        <div>
          <h3 ref={heading} tabIndex={-1}>
            接口调试
          </h3>
          <p>收起时取消等待，参数与结果保留。已提交的修改不回滚。</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ChevronUp data-icon="inline-start" />
          收起调试
        </Button>
      </div>
      <RequestEditor {...request} />
      <ResponseViewer {...response} />
    </div>
  )
}
