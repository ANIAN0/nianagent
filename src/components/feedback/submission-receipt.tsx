import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { LoaderCircle, RotateCw } from "lucide-react"
import "./submission-receipt.css"

/** Read the original receipt without submitting the editable draft again. */
export function SubmissionReceipt({
  checking = false,
  disabled = false,
  onCheck,
  actions,
}: {
  checking?: boolean
  disabled?: boolean
  onCheck?: () => void
  actions?: ReactNode
}) {
  return (
    <div className="submission-receipt" role="group">
      <span className="submission-receipt-status" role="status">
        <span className="submission-receipt-dot" aria-hidden="true" />
        {checking ? "正在检查接收状态…" : "接收结果待确认"}
      </span>
      {onCheck && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="submission-receipt-check"
          disabled={disabled || checking}
          onClick={onCheck}
        >
          {checking ? (
            <LoaderCircle
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <RotateCw data-icon="inline-start" />
          )}
          检查发送状态
        </Button>
      )}
      {actions}
    </div>
  )
}
