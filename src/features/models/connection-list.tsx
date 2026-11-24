import { useState } from "react"
import { Ellipsis, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import {
  Table,
  TableBody,
  TableCell,
  TableCellText,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  connectionIssue,
  credentialLabel,
  type ModelConnection,
} from "./model-types"

export type ConnectionListView = { query: string; page: number; size: number }

export function ConnectionList({
  connections,
  loading,
  error,
  failure,
  blockedIds = [],
  busy,
  onRetry,
  onAdd,
  onEdit,
  onRemove,
  view,
  onViewChange,
}: {
  connections: ModelConnection[]
  view?: ConnectionListView
  onViewChange?: (patch: Partial<ConnectionListView>) => void
  loading?: boolean
  error?: string
  failure?: FeedbackDescription
  blockedIds?: string[]
  busy?: boolean
  onRetry: () => void
  onAdd: () => void
  onEdit: (item: ModelConnection) => void
  onRemove: (item: ModelConnection) => void
}) {
  const [localView, setLocalView] = useState<ConnectionListView>({
    query: "",
    page: 1,
    size: 10,
  })
  const { query, page, size } = view ?? localView
  const update = (patch: Partial<ConnectionListView>) =>
    onViewChange
      ? onViewChange(patch)
      : setLocalView((previous) => ({ ...previous, ...patch }))
  const setQuery = (nextQuery: string) => update({ query: nextQuery })
  const setPage = (nextPage: number) => update({ page: nextPage })
  const setSize = (nextSize: number) => update({ size: nextSize })

  const term = query.trim().toLowerCase()
  const filtered = term
    ? connections.filter((item) =>
        `${item.name} ${item.endpoint} ${credentialLabel(item)} ${item.account?.name ?? ""}`
          .toLowerCase()
          .includes(term)
      )
    : connections

  const totalPages = Math.max(1, Math.ceil(filtered.length / size))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * size, currentPage * size)

  return (
    <div className="model-page">
      <div className="flex flex-col gap-6">
        <header>
          <h2 className="text-[20px] leading-7 font-semibold">模型连接</h2>
        </header>

        {loading ? (
          <div
            role="status"
            aria-label="正在读取模型连接"
            className="flex flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-8 w-72 max-w-full" />
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-56 w-full rounded-lg" />
          </div>
        ) : error || failure ? (
          <OperationFeedback
            notify={false}
            title="无法读取模型连接"
            {...(failure ?? {
              message: error!,
              code: "read_failed",
              recovery: "reload",
            })}
            actions={
              <RecoveryAction
                issue={
                  failure ?? {
                    message: error!,
                    code: "read_failed",
                    recovery: "reload",
                  }
                }
                onRetry={onRetry}
                onReload={onRetry}
                labels={{ retry: "重新读取" }}
              />
            }
          />
        ) : (
          <section className="flex flex-col gap-3" aria-label="模型连接列表">
            {connections.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <InputGroup className="h-8 w-full max-w-xs">
                  <InputGroupAddon>
                    <Search className="size-3.5" />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="搜索连接"
                    placeholder="按名称、端点或凭据筛选"
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

                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  disabled={busy}
                  onClick={onAdd}
                >
                  <Plus data-icon="inline-start" />
                  添加连接
                </Button>
              </div>
            )}

            {pageItems.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table variant="compact">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="min-w-[140px]">名称</TableHead>
                      <TableHead className="w-[140px]">类型</TableHead>
                      <TableHead className="min-w-[200px]">端点</TableHead>
                      <TableHead className="w-[136px]">凭据</TableHead>
                      <TableHead className="w-[76px] text-right">
                        模型数
                      </TableHead>
                      <TableHead className="w-[104px]">状态</TableHead>
                      <TableHead className="w-[60px] text-right">
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((item) => {
                      const issue = connectionIssue(item)
                      const itemBusy = busy || blockedIds.includes(item.id)
                      const kindLabel =
                        item.kind === "subscription"
                          ? item.account?.name
                            ? `订阅 · ${item.account.name}`
                            : "订阅账号"
                          : "自定义服务"
                      const credential = credentialLabel(item)
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="max-w-[240px] align-middle">
                            <button
                              id={`model-connection-${item.id}`}
                              type="button"
                              className="model-name"
                              disabled={itemBusy}
                              onClick={() => onEdit(item)}
                              aria-label={`编辑 ${item.name} 连接`}
                            >
                              <TableCellText text={item.name} />
                            </button>
                          </TableCell>
                          <TableCell
                            variant="secondary"
                            className="max-w-[160px] align-middle"
                          >
                            <TableCellText text={kindLabel} />
                          </TableCell>
                          <TableCell
                            variant="secondary"
                            className="max-w-[320px] align-middle font-mono"
                          >
                            <TableCellText text={item.endpoint || "—"} />
                          </TableCell>
                          <TableCell
                            variant="secondary"
                            className="max-w-[160px] align-middle"
                          >
                            <TableCellText text={credential} />
                          </TableCell>
                          <TableCell className="text-right align-middle font-medium whitespace-nowrap text-foreground tabular-nums">
                            {item.models.length}
                          </TableCell>
                          <TableCell className="align-middle whitespace-nowrap">
                            {issue ? (
                              <Badge variant="destructive" title={issue}>
                                {item.kind === "subscription"
                                  ? "登录已失效"
                                  : "凭据不可用"}
                              </Badge>
                            ) : (
                              <Badge variant="secondary">已配置</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right align-middle whitespace-nowrap">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  className="size-8"
                                  disabled={itemBusy}
                                  aria-label={`${item.name} 的操作`}
                                >
                                  <Ellipsis />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    onSelect={() => onEdit(item)}
                                  >
                                    <Pencil />
                                    编辑连接
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => onRemove(item)}
                                  >
                                    <Trash2 />
                                    删除连接
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : connections.length > 0 ? (
              <Empty className="rounded-lg border border-border py-10">
                <EmptyHeader>
                  <EmptyTitle className="text-sm font-normal">
                    未找到匹配的连接
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
              <Empty className="rounded-lg border border-border py-10">
                <EmptyHeader>
                  <EmptyTitle className="text-sm font-normal">
                    尚未添加模型连接
                  </EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={onAdd}
                  >
                    <Plus data-icon="inline-start" />
                    添加连接
                  </Button>
                </EmptyContent>
              </Empty>
            )}

            {connections.length > 0 && (
              <DataTablePagination
                total={connections.length}
                filteredTotal={filtered.length}
                filtered={!!term}
                page={currentPage}
                pageSize={size}
                onPageChange={setPage}
                onPageSizeChange={setSize}
                itemLabel="个连接"
              />
            )}
          </section>
        )}
      </div>
    </div>
  )
}
