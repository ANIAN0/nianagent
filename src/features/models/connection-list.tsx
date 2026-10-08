import { useState } from "react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { Ellipsis, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { SettingsPagination } from "./settings-pagination"
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
  const setQuery = (query: string) => update({ query })
  const setPage = (page: number) => update({ page })
  const setSize = (size: number) => update({ size })
  const filtered = connections.filter((item) =>
    `${item.name} ${item.endpoint} ${credentialLabel(item)}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / size))
  )
  return (
    <div className="model-page">
      <header className="model-head">
        <div>
          <h2>模型连接</h2>
          <p>管理模型服务、凭据与各连接的模型。</p>
        </div>
        <Button
          disabled={loading || busy || !!error || !!failure}
          onClick={onAdd}
        >
          <Plus />
          添加连接
        </Button>
      </header>
      {loading ? (
        <div
          role="status"
          aria-label="正在读取模型连接"
          className="flex flex-col gap-3"
        >
          <Skeleton className="h-10 w-80 max-w-full" />
          {[1, 2, 3, 4].map((id) => (
            <Skeleton className="h-16 w-full" key={id} />
          ))}
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
        <>
          <div className="model-toolbar">
            <Input
              aria-label="搜索连接"
              placeholder="搜索连接"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
            <span>
              {filtered.length} / {connections.length} 个连接
            </span>
          </div>
          {filtered.length ? (
            <div
              className="model-table-frame"
              tabIndex={0}
              role="region"
              aria-label="模型连接表格，可横向滚动"
            >
              <Table className="model-table connection-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>连接</TableHead>
                    <TableHead>端点与凭据</TableHead>
                    <TableHead>状态与模型</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered
                    .slice((currentPage - 1) * size, currentPage * size)
                    .map((item) => {
                      const issue = connectionIssue(item)
                      const itemBusy = busy || blockedIds.includes(item.id)
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <button
                              id={`model-connection-${item.id}`}
                              className="model-name"
                              disabled={itemBusy}
                              onClick={() => onEdit(item)}
                              aria-label={`编辑 ${item.name} 连接`}
                            >
                              {item.name}
                            </button>
                            <span
                              className="model-secondary"
                              title={item.account?.name}
                            >
                              {item.kind === "subscription"
                                ? `订阅账号 · ${item.account?.name ?? "未登录"}`
                                : "自定义服务"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className="model-technical"
                              title={item.endpoint}
                            >
                              {item.endpoint || "未指定端点"}
                            </span>
                            <span
                              className="model-secondary"
                              title={credentialLabel(item)}
                            >
                              {credentialLabel(item)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="model-status-line">
                              <span className={issue ? "text-destructive" : ""}>
                                {issue
                                  ? item.kind === "subscription"
                                    ? "登录已失效"
                                    : "凭据不可用"
                                  : "已配置"}
                              </span>
                              <span className="model-secondary">
                                {item.models.length} 个模型
                              </span>
                            </div>
                            {issue && (
                              <span
                                className="model-secondary text-destructive"
                                title={issue}
                              >
                                {issue}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
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
          ) : (
            <Empty className="model-empty">
              <EmptyHeader>
                <EmptyTitle>
                  {query ? "没有匹配的连接" : "还没有模型连接"}
                </EmptyTitle>
                <EmptyDescription>
                  {query
                    ? "换个名称或端点试试。"
                    : "添加服务后，可测试并维护它的模型。"}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={query ? () => setQuery("") : onAdd}
                >
                  {query ? "清除搜索" : "添加连接"}
                </Button>
              </EmptyContent>
            </Empty>
          )}
          <SettingsPagination
            total={filtered.length}
            page={currentPage}
            size={size}
            onPage={setPage}
            onSize={setSize}
            label="连接"
          />
        </>
      )}
    </div>
  )
}
