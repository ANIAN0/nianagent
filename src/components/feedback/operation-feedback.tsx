import type { ReactNode } from "react"
import { useState } from "react"
import { CircleAlert, ChevronDown, Info, TriangleAlert } from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

function FeedbackDetails({ details }: { details: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {open ? "收起诊断详情" : "诊断详情"}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-40 overflow-auto pt-2 text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground">
          {details}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Presentation only. The owning field, row, form or run supplies its recovery. */
export function OperationFeedback({
  title,
  message,
  details,
  severity = "error",
  actions,
  density = "default",
}: {
  title: string
  message: string
  details?: string
  severity?: "error" | "warning" | "info"
  actions?: ReactNode
  density?: "default" | "compact"
}) {
  const Icon =
    severity === "error"
      ? CircleAlert
      : severity === "warning"
        ? TriangleAlert
        : Info
  if (density === "compact")
    return (
      <Alert variant="compact" role={severity === "error" ? "alert" : "status"}>
        <Icon
          aria-hidden="true"
          className={
            severity === "error"
              ? "text-destructive"
              : severity === "warning"
                ? "text-status-warning"
                : "text-muted-foreground"
          }
        />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="w-full min-w-0 [overflow-wrap:anywhere]">
            {message || title}
          </span>
          {actions && (
            <div className="flex w-full flex-wrap items-center gap-1">
              {actions}
            </div>
          )}
          {details && (
            <div className="w-full">
              <FeedbackDetails key={`${title}:${details}`} details={details} />
            </div>
          )}
        </div>
      </Alert>
    )
  return (
    <Alert
      variant={
        severity === "error"
          ? "destructive"
          : severity === "warning"
            ? "warning"
            : "default"
      }
      role={severity === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-2">
          <p>{message}</p>
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
          {details && (
            <FeedbackDetails key={`${title}:${details}`} details={details} />
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
