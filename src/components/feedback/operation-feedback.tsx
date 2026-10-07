import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NotificationToast } from "@/components/ui/notification-toast"
import { StatusMessage } from "./status-message"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

function FeedbackDetails({ details }: { details: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-open={open}
      className="min-w-0 data-[open=true]:basis-full"
    >
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="xs">
          {open ? "收起诊断详情" : "诊断详情"}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-40 overflow-auto pt-2 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground">
          {details}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}
/** Transient failure copy plus durable recovery at the operation's own entry. */
export function OperationFeedback({
  title,
  message,
  code,
  details,
  severity = "error",
  actions,
  notify = true,
}: {
  title: string
  message: string
  code?: string
  details?: string
  severity?: "error" | "warning" | "info"
  actions?: ReactNode
  /** Compatibility only: there is one shared feedback presentation. */
  density?: "default" | "compact"
  /**
   * notify 默认 true：通知路径走共享 Toast（短暂提示后淡出）。
   * 静态记录与已打开的恢复/状态面板须显式传 notify={false}（打开时不重播通知，
   * 见 DESIGN.md“恢复面板和静态记录用notify=false”）；相关调用方补传
   * notify={false} 的改动归属会话/首页批次，不在此文件改任何调用方。
   */
  notify?: boolean
}) {
  const notification = notify && severity !== "info"
  return (
    <>
      {notification ? (
        <NotificationToast
          message={`${message || title}${code ? ` (${code})` : ""}`}
          tone={severity}
        />
      ) : (
        <StatusMessage
          title={title}
          message={message}
          code={code}
          severity={severity}
        />
      )}
      {(actions || details || notification) && (
        <div
          className="flex min-w-0 flex-wrap items-center gap-2"
          role="group"
          aria-label={`${title}：${message}`}
        >
          {notification && (
            <span className="text-[13px] leading-5 text-muted-foreground">
              {title}
              {message ? `：${message}` : ""}
            </span>
          )}
          {actions}
          {details && (
            <FeedbackDetails key={`${title}:${details}`} details={details} />
          )}
        </div>
      )}
    </>
  )
}
