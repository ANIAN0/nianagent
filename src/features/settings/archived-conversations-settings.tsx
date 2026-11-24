import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArchiveRestore, RefreshCw, Search, X } from "lucide-react"
import { toast } from "sonner"
import type { ConversationSummary } from "@/contracts/rpc.generated"
import { rpcCall } from "@/lib/rpc/client"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { notifyToast } from "@/components/ui/notification-toast"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { DataTablePagination } from "@/components/ui/pagination"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableCellText,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const DEFAULT_PAGE_SIZE = 10

function formatUpdatedAt(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return "—"
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time))
}

export function ArchivedConversationsSettings({
  onUnarchived,
  onOpenConversation,
}: {
  onUnarchived?: () => void
  onOpenConversation?: (id: string) => void
}) {
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState<FeedbackDescription>()
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [restoringIds, setRestoringIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const mountedRef = useRef(true)

  const reload = useCallback(() => {
    setLoading(true)
    setIssue(undefined)
    setRefreshNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const controller = new AbortController()
    void rpcCall(
      "conversationList",
      { filter: { archived: "only" } },
      controller.signal
    )
      .then((list) => {
        if (controller.signal.aborted || !mountedRef.current) return
        setItems(list)
        setIssue(undefined)
        setLoading(false)
      })
      .catch((error) => {
        if (controller.signal.aborted || !mountedRef.current) return
        setIssue(feedbackFromError(error, "已归档会话暂时无法读取，请重试。"))
        setLoading(false)
      })
    return () => {
      mountedRef.current = false
      controller.abort()
    }
  }, [refreshNonce])

  const term = query.trim().toLocaleLowerCase()
  const filtered = useMemo(() => {
    if (!term) return items
    return items.filter((item) =>
      `${item.title} ${item.cwd} ${item.lastMessage}`
        .toLocaleLowerCase()
        .includes(term)
    )
  }, [items, term])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  )

  async function restore(item: ConversationSummary) {
    if (restoringIds.has(item.id)) return
    setRestoringIds((prev) => new Set(prev).add(item.id))
    try {
      await rpcCall("conversationSetArchived", {
        id: item.id,
        archived: false,
      })
      if (!mountedRef.current) return
      setItems((prev) => prev.filter((entry) => entry.id !== item.id))
      onUnarchived?.()
      const toastId = `conversation-unarchived-${item.id}`
      notifyToast(`已恢复「${item.title}」`, {
        id: toastId,
        actions: onOpenConversation ? (
          <button
            type="button"
            onClick={() => {
              toast.dismiss(toastId)
              onOpenConversation(item.id)
            }}
          >
            打开会话
          </button>
        ) : undefined,
      })
    } catch (error) {
      if (!mountedRef.current) return
      notifyToast(feedbackFromError(error, "恢复会话未能完成。").message, {
        tone: "error",
      })
    } finally {
      if (mountedRef.current) {
        setRestoringIds((prev) => {
          if (!prev.has(item.id)) return prev
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
      }
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-page-inner">
        <header>
          <h2>已归档会话</h2>
        </header>

        {issue && (
          <OperationFeedback
            title="已归档会话未能读取"
            {...issue}
            notify={false}
            actions={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={reload}
              >
                重新读取
              </Button>
            }
          />
        )}

        <section className="flex flex-col gap-3" aria-label="已归档会话列表">
          {!issue && (items.length > 0 || !loading) && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {items.length > 0 ? (
                <InputGroup className="h-8 w-full max-w-xs">
                  <InputGroupAddon>
                    <Search className="size-3.5" />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="筛选已归档会话"
                    placeholder="按名称、目录或最近消息筛选"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setPage(1)
                    }}
                  />
                  {query && (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        aria-label="清空筛选"
                        onClick={() => {
                          setQuery("")
                          setPage(1)
                        }}
                      >
                        <X />
                      </InputGroupButton>
                    </InputGroupAddon>
                  )}
                </InputGroup>
              ) : (
                <div />
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={loading}
                onClick={reload}
              >
                <RefreshCw
                  data-icon="inline-start"
                  className={loading ? "animate-spin" : ""}
                />
                {loading ? "正在刷新…" : "刷新"}
              </Button>
            </div>
          )}

          {loading && items.length === 0 ? (
            <div
              role="status"
              aria-label="正在读取已归档会话"
              className="flex flex-col gap-3"
            >
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          ) : pageItems.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table variant="compact">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="min-w-[200px]">会话</TableHead>
                    <TableHead className="min-w-[220px]">工作目录</TableHead>
                    <TableHead className="w-[156px]">最近更新</TableHead>
                    <TableHead className="sticky right-0 w-[116px] bg-muted text-right">
                      操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((item) => {
                    const restoring = restoringIds.has(item.id)
                    const timeLabel = formatUpdatedAt(item.updatedAt)
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="max-w-[320px] align-middle font-medium text-foreground">
                          <TableCellText text={item.title} />
                        </TableCell>
                        <TableCell
                          variant="secondary"
                          className="max-w-[380px] align-middle font-mono"
                        >
                          <TableCellText text={item.cwd || "—"} />
                        </TableCell>
                        <TableCell
                          variant="secondary"
                          className="align-middle whitespace-nowrap tabular-nums"
                        >
                          <time dateTime={item.updatedAt}>{timeLabel}</time>
                        </TableCell>
                        <TableCell className="sticky right-0 bg-card text-right align-middle whitespace-nowrap">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            disabled={restoring}
                            onClick={() => void restore(item)}
                          >
                            {restoring ? (
                              <Spinner data-icon="inline-start" />
                            ) : (
                              <ArchiveRestore data-icon="inline-start" />
                            )}
                            {restoring ? "恢复中…" : "恢复会话"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          ) : !issue && items.length > 0 ? (
            <Empty className="rounded-lg border border-border py-10">
              <EmptyHeader>
                <EmptyTitle className="text-sm font-normal">
                  未找到匹配的已归档会话
                </EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("")
                    setPage(1)
                  }}
                >
                  清空筛选
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            !issue && (
              <Empty className="rounded-lg border border-border py-10">
                <EmptyHeader>
                  <EmptyTitle className="text-sm font-normal">
                    暂无已归档会话
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            )
          )}

          {!loading && items.length > 0 && (
            <DataTablePagination
              total={items.length}
              filteredTotal={filtered.length}
              filtered={!!term}
              page={currentPage}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              itemLabel="个会话"
            />
          )}
        </section>
      </div>
    </div>
  )
}
