import { useEffect, useId, useMemo, useRef, useState } from "react"
import { ChevronRight, Search, X } from "lucide-react"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
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
import type {
  Conversation,
  ComposerData,
  Workspace,
} from "@/lib/composer/types"
import { ConversationListFeedback } from "./conversation-list-feedback"
import { ConversationStatusMark } from "./conversation-status-mark"
import {
  conversationHasPending,
  conversationIsRunning,
} from "./conversation-history-layout"
import type { HistoryState } from "@/lib/submission/conversation-handoff"
import { cn } from "@/lib/utils"
import { useComposerKeyboard } from "@/components/composer/composer-keymap"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { rpcCall } from "@/lib/rpc/client"

export type ConversationSearchProps = {
  data: Pick<ComposerData, "conversations" | "workspaces">
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (item: Conversation) => void
  /** 与侧栏一致的归档视图范围；正文搜索同范围。 */
  archived?: "hide" | "only"
  workspace?: Workspace
  historyState?: HistoryState
  historyError?: string
  historyIssue?: FeedbackDescription
  onHistoryRetry?: () => void
}

const SEARCH_RESULT_LIMIT = 20
const SEARCH_DEBOUNCE_MS = 250

// 输入卫生：去 NUL，按码点截断到 500（不劈开代理对）。
function sanitizeQuery(raw: string) {
  const withoutNul = raw.replaceAll("\u0000", "")
  return Array.from(withoutNul).slice(0, 500).join("")
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

type SearchRow = {
  conversation: Conversation
  /** 正文命中片段；元数据命中行无此字段。 */
  snippet?: string
}

export function ConversationSearch({
  data,
  open,
  onOpenChange,
  onSelect,
  archived = "hide",
  workspace,
  historyState = "ready",
  historyError,
  historyIssue,
  onHistoryRetry,
}: ConversationSearchProps) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [resultLimit, setResultLimit] = useState(SEARCH_RESULT_LIMIT)
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "unread">(
    "all"
  )
  const [content, setContent] = useState<{
    term: string
    scope: string
    items: { conversationId: string; snippet: string }[]
    hasMore: boolean
  } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const listId = useId()
  const term = sanitizeQuery(query).trim()
  const workspaceId = workspace?.id
  const scope = `${archived}:${workspaceId ?? ""}`
  const conversations = useMemo(
    () =>
      workspaceId
        ? data.conversations.filter((item) => item.workspaceId === workspaceId)
        : data.conversations,
    [data.conversations, workspaceId]
  )
  const pathOf = (item: Conversation) =>
    data.workspaces.find((workspace) => workspace.id === item.workspaceId)
      ?.path ??
    item.cwd ??
    ""
  const statusMatches = (item: Conversation) => {
    if (statusFilter === "active")
      return conversationIsRunning(item) || conversationHasPending(item)
    if (statusFilter === "unread") return item.unread === true
    return true
  }
  const matches = useMemo(
    () =>
      conversations.filter(
        (item) =>
          statusMatches(item) &&
          `${item.title} ${pathOf(item)} ${item.message ?? ""}`
            .toLocaleLowerCase()
            .includes(term.toLocaleLowerCase())
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, data.workspaces, term, statusFilter]
  )
  // 正文搜索：250ms 防抖，新查询取消前序；失败保留本地匹配不告警。
  // 内容结果带 term 标记，按当前词派生（换词即刻失配，无需 effect 清理）。
  useEffect(() => {
    if (!open || !term) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      rpcCall(
        "conversationSearch",
        {
          filter: {
            query: term,
            archived,
            ...(workspaceId && { workspaceId }),
          },
        },
        controller.signal
      )
        .then((result) => {
          if (!controller.signal.aborted) setContent({ term, scope, ...result })
        })
        .catch((error) => {
          if (error?.name !== "AbortError" && !controller.signal.aborted)
            setContent({ term, scope, items: [], hasMore: false })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, term, archived, workspaceId, scope])
  const effectiveContent =
    open && content?.term === term && content.scope === scope ? content : null
  const byId = useMemo(
    () => new Map(conversations.map((item) => [item.id, item])),
    [conversations]
  )
  const contentOnly = useMemo(() => {
    const localIds = new Set(matches.map((item) => item.id))
    return (effectiveContent?.items ?? [])
      .map((item) => ({
        conversation: byId.get(item.conversationId),
        snippet: item.snippet,
      }))
      .filter(
        (entry): entry is { conversation: Conversation; snippet: string } =>
          !!entry.conversation &&
          !localIds.has(entry.conversation.id) &&
          statusMatches(entry.conversation)
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, effectiveContent, byId, statusFilter])
  const visibleLimit = workspace ? resultLimit : SEARCH_RESULT_LIMIT
  const rows = useMemo<SearchRow[]>(() => {
    const local: SearchRow[] = matches
      .slice(0, visibleLimit)
      .map((item) => ({ conversation: item }))
    return [...local, ...contentOnly.slice(0, visibleLimit - local.length)]
  }, [matches, contentOnly, visibleLimit])
  const hasMoreKnown = matches.length + contentOnly.length > rows.length
  const showMore = !!workspace && hasMoreKnown
  const hasMore = hasMoreKnown || (effectiveContent?.hasMore ?? false)
  const activeIndex = Math.min(active, Math.max(0, rows.length - 1))
  function select(row: SearchRow) {
    onOpenChange(false)
    onSelect(row.conversation)
  }
  const keyboard = useComposerKeyboard<HTMLInputElement>(() => {
    if (rows[activeIndex]) select(rows[activeIndex])
  })
  const contentCount = contentOnly.length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(680px,calc(100dvh-48px))] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[640px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          setQuery("")
          setActive(0)
          setStatusFilter("all")
          setResultLimit(SEARCH_RESULT_LIMIT)
          setContent(null)
          input.current?.focus()
        }}
      >
        <div className="flex items-center justify-between gap-3 pt-4 pr-10 pb-3 pl-5">
          <DialogTitle
            className="min-w-0 truncate text-base font-semibold"
            title={workspace?.path}
          >
            {workspace ? `搜索会话 · ${workspace.name}` : "搜索会话"}
          </DialogTitle>
          <KbdGroup className="hidden text-[11px] text-muted-foreground sm:inline-flex">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span className="mx-0.5">选择</span>
            <Kbd>Enter</Kbd>
            <span className="mx-0.5">打开</span>
          </KbdGroup>
        </div>
        <DialogDescription className="sr-only">
          按名称、工作目录、最近消息或正文查找本应用会话。
        </DialogDescription>
        <div className="px-5 pb-3">
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
                rows[activeIndex] ? `${listId}-${activeIndex}` : undefined
              }
              aria-autocomplete="list"
              aria-label="搜索会话名称、目录、最近消息或正文"
              placeholder="搜索会话名称、目录、最近消息或正文"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setResultLimit(SEARCH_RESULT_LIMIT)
                setActive(0)
              }}
              onKeyDown={(event) => {
                const intent = keyboard.onKeyDown(event)
                if (intent === "composing" || event.defaultPrevented) return
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                  rows.length
                ) {
                  event.preventDefault()
                  const next =
                    (activeIndex +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      rows.length) %
                    rows.length
                  setActive(next)
                  results.current?.children[next]?.scrollIntoView({
                    block: "nearest",
                  })
                }
              }}
              onCompositionStart={keyboard.onCompositionStart}
              onCompositionEnd={keyboard.onCompositionEnd}
            />
            {query && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="清空搜索"
                  onClick={() => {
                    setQuery("")
                    setResultLimit(SEARCH_RESULT_LIMIT)
                    setActive(0)
                    setContent(null)
                    input.current?.focus()
                  }}
                >
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        <div className="flex items-center justify-between border-t px-5 py-2">
          <p className="text-[11px] text-muted-foreground" role="status">
            {historyState === "loading"
              ? "正在读取会话…"
              : `${matches.length} 个会话${
                  contentCount > 0 ? ` · 正文命中 ${contentCount}` : ""
                }`}
          </p>
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="状态过滤"
          >
            {(
              [
                ["all", "全部"],
                ["active", "进行中"],
                ["unread", "未读"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 rounded-md px-2 text-xs font-normal",
                  statusFilter === value && "bg-accent text-accent-foreground"
                )}
                aria-pressed={statusFilter === value}
                onClick={() => {
                  setStatusFilter(value)
                  setResultLimit(SEARCH_RESULT_LIMIT)
                  setActive(0)
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        {historyState !== "ready" && (
          <div className="px-3 pt-2">
            <ConversationListFeedback
              state={historyState}
              error={historyError}
              issue={historyIssue}
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
          {rows.map((row, index) => (
            <Button
              key={row.conversation.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={activeIndex === index}
              tabIndex={-1}
              variant="ghost"
              className={cn(
                "grid h-auto min-h-12 w-full grid-cols-[minmax(0,1fr)_16px] gap-x-2 gap-y-0 rounded-lg px-2 py-1 text-left font-normal",
                activeIndex === index && "bg-accent/60"
              )}
              onPointerMove={(event) => {
                if (
                  event.pointerType === "mouse" &&
                  (event.movementX || event.movementY)
                )
                  setActive(index)
              }}
              onClick={() => select(row)}
            >
              <span className="flex min-w-0 items-center gap-4">
                <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <ConversationStatusMark
                    status={row.conversation.status ?? "idle"}
                    unread={row.conversation.unread}
                  />
                  <span className="truncate">
                    <Match text={row.conversation.title} query={term} />
                  </span>
                </span>
                <time
                  dateTime={row.conversation.updatedAt}
                  className="shrink-0 text-[11px] text-muted-foreground"
                >
                  {row.conversation.updatedLabel}
                </time>
              </span>
              <ChevronRight className="col-start-2 row-span-2 row-start-1 size-4 text-muted-foreground" />
              <span className="col-start-1 truncate text-xs leading-5 text-muted-foreground">
                <Match text={pathOf(row.conversation)} query={term} />
              </span>
              {row.snippet ? (
                <span className="col-start-1 truncate text-xs leading-5 text-muted-foreground">
                  <Match text={row.snippet} query={term} />
                </span>
              ) : (
                row.conversation.message &&
                term && (
                  <span className="col-start-1 truncate text-xs leading-5 text-muted-foreground">
                    <Match text={row.conversation.message} query={term} />
                  </span>
                )
              )}
            </Button>
          ))}
          {!rows.length && historyState === "ready" && (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyTitle className="text-sm font-normal">
                  {conversations.length ? "未找到相关会话" : "暂无会话"}
                </EmptyTitle>
                <EmptyDescription className="text-xs">
                  {conversations.length
                    ? "试试其他名称、目录、最近消息或正文关键词。"
                    : "新建会话后，可在这里快速找到。"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {hasMore && !showMore && rows.length > 0 && (
            <p
              className="px-2 py-2 text-center text-[11px] text-muted-foreground"
              role="note"
            >
              更多结果未显示，请换更具体的关键词。
            </p>
          )}
        </div>
        {showMore && (
          <div className="shrink-0 border-t px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => {
                setResultLimit((limit) => limit + SEARCH_RESULT_LIMIT)
                setActive(rows.length)
                input.current?.focus()
                requestAnimationFrame(() => {
                  results.current?.children[rows.length]?.scrollIntoView({
                    block: "nearest",
                  })
                })
              }}
            >
              显示更多结果
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
