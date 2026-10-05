import type { RefObject } from "react"
import { Check, ChevronRight, type LucideIcon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

export type MaterialCandidate = {
  searchText?: string
  id: string
  group: string
  name: string
  description: string
  icon: LucideIcon
  disabled?: boolean
  selected?: boolean
  text?: string
  drill?: boolean
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
  onDrill,
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
  onDrill?: (item: MaterialCandidate) => void
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
            <div key={item.id} className="relative">
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
                  "h-9 w-full justify-start gap-2 rounded-lg px-3 py-1 font-normal",
                  item.drill && "pr-10",
                  active === rowIndex && "bg-accent/60"
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => {
                  if (!item.disabled) onActive(rowIndex)
                }}
                onClick={() => onSelect(item)}
              >
                <item.icon data-icon="inline-start" />
                <span className="flex min-w-0 flex-1 items-center gap-4">
                  <span className="min-w-0 shrink truncate text-left text-[13px]">
                    {item.name}
                  </span>
                  <span
                    className="ml-auto max-w-[55%] min-w-0 shrink truncate text-xs text-muted-foreground"
                    title={item.description}
                  >
                    {item.description}
                  </span>
                </span>
                {item.selected && <Check data-icon="inline-end" />}
              </Button>
              {item.drill && onDrill && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-1 bottom-1.5"
                  aria-label={`进入目录 ${item.name}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onDrill(item)}
                >
                  <ChevronRight />
                </Button>
              )}
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
        <div
          role="status"
          aria-label={`正在读取${statusGroup ?? "资源"}`}
          className="flex flex-col gap-2 p-3"
        >
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
        </div>
      ) : failure ? (
        <div className="p-2">
          <div
            role={failure.severity === "warning" ? "status" : "alert"}
            className="flex flex-wrap items-center gap-2 px-1 py-2 text-xs leading-5"
          >
            <span className="min-w-0 text-muted-foreground">
              {failure.message}
            </span>
            <RecoveryAction
              issue={failure}
              onRetry={onRetry}
              onReload={onRetry}
              onCheck={onRetry}
              labels={{ retry: "重新读取" }}
            />
          </div>
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
