import { useId, useRef, useState } from "react"
import { ChevronRight, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupButton,
} from "@/components/ui/input-group"
import type { Conversation, HomeData } from "./home-types"
import { ConversationListFeedback } from "./conversation-list-feedback"
import { ConversationStatusMark } from "./conversation-status-mark"
import type { HistoryState } from "@/features/conversation/conversation-catalog-service"
import { cn } from "@/lib/utils"

export type ConversationSearchProps = {
  data: Pick<HomeData, "conversations" | "workspaces">
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (item: Conversation) => void
  historyState?: HistoryState
  historyError?: string
  onHistoryRetry?: () => void
}
function Match({ text, query }: { text: string; query: string }) {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (!query || index < 0) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-primary/20 text-inherit">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  )
}
export function ConversationSearch({
  data,
  open,
  onOpenChange,
  onSelect,
  historyState = "ready",
  historyError,
  onHistoryRetry,
}: ConversationSearchProps) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const listId = useId()
  const term = query.trim()
  const pathOf = (item: Conversation) =>
    data.workspaces.find((workspace) => workspace.id === item.workspaceId)
      ?.path ??
    item.cwd ??
    ""
  const matches = data.conversations.filter((item) =>
    `${item.title} ${pathOf(item)} ${item.message ?? ""}`
      .toLocaleLowerCase()
      .includes(term.toLocaleLowerCase())
  )
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1))
  function select(item: Conversation) {
    onOpenChange(false)
    onSelect(item)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(680px,calc(100dvh-48px))] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[640px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          setQuery("")
          setActive(0)
          input.current?.focus()
        }}
      >
        <DialogTitle className="px-5 pt-5 pb-1 text-lg">搜索会话</DialogTitle>
        <DialogDescription className="px-5 pb-4 text-[13px]">
          按名称、工作目录或最近消息查找本应用会话。
        </DialogDescription>
        <div className="px-5 pb-4">
          <InputGroup className="h-10">
            <InputGroupAddon>
              <Search className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              ref={input}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={
                matches[activeIndex] ? `${listId}-${activeIndex}` : undefined
              }
              aria-autocomplete="list"
              aria-label="搜索会话名称、目录或最近消息"
              placeholder="搜索会话名称、目录或最近消息"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                  matches.length
                ) {
                  event.preventDefault()
                  const next =
                    (activeIndex +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      matches.length) %
                    matches.length
                  setActive(next)
                  results.current?.children[next]?.scrollIntoView({
                    block: "nearest",
                  })
                } else if (event.key === "Enter" && matches[activeIndex]) {
                  event.preventDefault()
                  select(matches[activeIndex])
                }
              }}
            />
            {query && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="清空搜索"
                  onClick={() => {
                    setQuery("")
                    setActive(0)
                    input.current?.focus()
                  }}
                >
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        <p
          className="border-t px-5 py-2 text-[11px] text-muted-foreground"
          role="status"
        >
          {historyState === "loading"
            ? "正在读取会话…"
            : `${matches.length} 个会话`}
        </p>
        {historyState !== "ready" && (
          <div className="px-3 pt-2">
            <ConversationListFeedback
              state={historyState}
              error={historyError}
              hasItems={data.conversations.length > 0}
              onRetry={onHistoryRetry}
            />
          </div>
        )}
        <div
          ref={results}
          id={listId}
          role="listbox"
          aria-label="搜索结果"
          className="min-h-[min(176px,24dvh)] overflow-y-auto p-2"
        >
          {matches.map((item, index) => (
            <Button
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={activeIndex === index}
              tabIndex={-1}
              variant="ghost"
              className={cn(
                "grid h-auto min-h-12 w-full grid-cols-[minmax(0,1fr)_16px] gap-x-2 gap-y-0 rounded-lg px-2 py-1 text-left font-normal",
                activeIndex === index && "bg-accent/60"
              )}
              onMouseMove={() => setActive(index)}
              onClick={() => select(item)}
            >
              <span className="flex min-w-0 items-center gap-4">
                <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <ConversationStatusMark
                    status={item.status ?? "idle"}
                    unread={item.unread}
                  />
                  <span className="truncate">
                    <Match text={item.title} query={term} />
                  </span>
                </span>
                <time
                  dateTime={item.updatedAt}
                  className="shrink-0 text-[11px] text-muted-foreground"
                >
                  {item.updatedLabel}
                </time>
              </span>
              <ChevronRight className="col-start-2 row-span-2 row-start-1 size-4 text-muted-foreground" />
              <span className="col-start-1 truncate text-xs leading-5 text-muted-foreground">
                <Match text={pathOf(item)} query={term} />
              </span>
              {item.message && term && (
                <span className="col-start-1 truncate text-xs leading-5 text-muted-foreground">
                  <Match text={item.message} query={term} />
                </span>
              )}
            </Button>
          ))}
          {!matches.length && historyState === "ready" && (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyTitle className="text-sm font-normal">
                  {data.conversations.length ? "未找到相关会话" : "暂无会话"}
                </EmptyTitle>
                <EmptyDescription className="text-xs">
                  {data.conversations.length
                    ? "试试其他名称、目录或最近消息关键词。"
                    : "新建会话后，可在这里快速找到。"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
