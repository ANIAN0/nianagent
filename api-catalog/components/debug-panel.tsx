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
  let draftSessionId: unknown
  try {
    draftSessionId = JSON.parse(request.value).sessionId
  } catch {
    /* Parameter validation remains the request editor's responsibility. */
  }
  const queueBlocked =
    !!response.response.queueReceiptInput &&
    (!response.response.queueBlockedSessionId ||
      draftSessionId === response.response.queueBlockedSessionId)
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
      <RequestEditor
        {...request}
        blockedReason={
          queueBlocked
            ? "原队列操作结果尚未确认。请先使用下方原会话和原请求编号核对队列回执，勿用新编号重复执行。"
            : response.response.receiptInput
              ? "原写入结果尚未确认。请先查询下方的写入回执，再执行新写入。"
              : response.response.authorizationInput
                ? "原授权任务尚未确认。请先使用下方原ID查询或取消原任务，不要启动另一授权。"
                : undefined
        }
      />
      <ResponseViewer {...response} />
    </div>
  )
}
