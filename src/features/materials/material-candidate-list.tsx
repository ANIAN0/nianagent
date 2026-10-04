import type { RefObject } from "react"
import { Check, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

export type MaterialCandidate = {
  id: string
  group: string
  name: string
  description: string
  icon: LucideIcon
  disabled?: boolean
  selected?: boolean
  text?: string
}
export function MaterialCandidateList({
  id,
  rows,
  active,
  listRef,
  maxHeight,
  label = "输入候选",
  emptyMessage = "没有匹配的资源，可修改关键词",
  statusGroup,
  loading,
  error,
  issue,
  diagnostics = [],
  onRetry,
  onActive,
  onSelect,
}: {
  id: string
  rows: MaterialCandidate[]
  active: number
  listRef: RefObject<HTMLDivElement | null>
  maxHeight: number
  label?: string
  emptyMessage?: string
  statusGroup?: string
  loading?: boolean
  error?: string
  issue?: FeedbackDescription
  diagnostics?: string[]
  onRetry?: () => void
  onActive: (index: number) => void
  onSelect: (item: MaterialCandidate) => void
}) {
  // An unavailable resource source does not hide independently supported commands.
  const unavailable = loading || issue || error
  const visibleRows = unavailable
    ? rows.filter((item) => statusGroup && item.group !== statusGroup)
    : rows
  const failure =
    issue ??
    (error
      ? feedbackFromError(error, "材料列表未能读取，请重新读取。")
      : undefined)
  return (
    <div className="moon-scrollbar overflow-y-auto" style={{ maxHeight }}>
      <div
        ref={listRef}
        id={id}
        role="listbox"
        aria-label={label}
        aria-busy={loading}
      >
        {visibleRows.map((item, index) => {
          const rowIndex = rows.indexOf(item)
          return (
            <div key={item.id}>
              {(index === 0 ||
                visibleRows[index - 1]?.group !== item.group) && (
                <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
                  {item.group}
                </div>
              )}
              <Button
                type="button"
                id={`${id}-${rowIndex}`}
                data-candidate-index={rowIndex}
                role="option"
                aria-selected={active === rowIndex}
                disabled={item.disabled}
                tabIndex={-1}
                variant="ghost"
                className={cn(
                  "h-auto min-h-11 w-full justify-start gap-2 rounded-lg px-3 py-2 font-normal",
                  active === rowIndex && "bg-accent/60"
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => {
                  if (!item.disabled) onActive(rowIndex)
                }}
                onClick={() => onSelect(item)}
              >
                <item.icon data-icon="inline-start" />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="max-w-full truncate text-left">
                    {item.name}
                  </span>
                  <span
                    className="max-w-full truncate text-xs text-muted-foreground"
                    title={item.description}
                  >
                    {item.description}
                  </span>
                </span>
                {item.selected && <Check data-icon="inline-end" />}
              </Button>
            </div>
          )
        })}
      </div>
      {unavailable && statusGroup && (
        <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
          {statusGroup}
        </div>
      )}
      {loading ? (
        <p
          role="status"
          className="px-3 py-6 text-center text-xs text-muted-foreground"
        >
          正在读取{statusGroup ?? "资源"}…
        </p>
      ) : failure ? (
        <div className="p-2">
          <OperationFeedback
            title={`${statusGroup ?? "材料列表"}${failure.code === "cancelled" ? "读取已取消" : "读取失败"}`}
            message={failure.message}
            details={failure.details}
            severity={
              failure.severity ??
              (failure.code === "cancelled" ? "info" : "error")
            }
            actions={
              <RecoveryAction
                issue={failure}
                onRetry={onRetry}
                onReload={onRetry}
                onCheck={onRetry}
                labels={{ retry: "重新读取" }}
              />
            }
          />
        </div>
      ) : null}
      {!unavailable && !rows.length && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {emptyMessage}
        </p>
      )}
      {diagnostics.map((item, index) => (
        <p
          key={index}
          className="px-3 py-1 text-xs leading-5 text-muted-foreground"
        >
          {item}
        </p>
      ))}
    </div>
  )
}
