import { useState } from "react"
import {
  Ellipsis,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react"
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
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableCellText,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { feedbackFromError } from "@/lib/operation-issue"
import type { McpServer } from "./mcp-service"

export type McpRowFailure = ReturnType<typeof feedbackFromError> & {
  enabled: boolean
}
export type McpServerListProps = {
  servers: McpServer[]
  loading: boolean
  hasLoaded?: boolean
  error: string
  errorDetails?: string
  failure?: FeedbackDescription
  busy?: boolean
  busyNames?: string[]
  rowFailures?: Record<string, McpRowFailure>
  removalPending?: string
  unresolvedNames?: string[]
  query: string
  onQuery(value: string): void
  onAdd(): void
  onEdit(server: McpServer): void
  onRemove(server: McpServer): void
  onToggle(server: McpServer, enabled: boolean): void
  onRetryToggle?(server: McpServer, enabled: boolean): void
  onCheckToggle?(server: McpServer): void
  onRetry(): void
}

function formatRuntimeStatus(server: McpServer): {
  label: string
  variant: "secondary" | "outline" | "destructive"
  tooltip?: string
} {
  const { runtime, configuration } = server
  if (!configuration.enabled) {
    return { label: "已停用", variant: "outline" }
  }
  if (!runtime) {
    return { label: "未连接", variant: "outline" }
  }
  const extra =
    runtime.state !== "connected" && runtime.connections > 0
      ? `另有 ${runtime.connections} 个会话已连接`
      : undefined
  const tooltip = [runtime.error, extra].filter(Boolean).join("；") || undefined

  switch (runtime.state) {
    case "connected":
      return {
        label: `已连接 · ${runtime.connections}`,
        variant: "secondary",
        tooltip: `已连接 ${runtime.connections} 个会话`,
      }
    case "connecting":
      return { label: "连接中", variant: "outline", tooltip }
    case "disconnected":
      return { label: "已断开", variant: "outline", tooltip }
    case "needs-auth":
      return { label: "需要授权", variant: "destructive", tooltip }
    case "failed":
      return { label: "连接失败", variant: "destructive", tooltip }
  }
}

function formatTestSummary(server: McpServer) {
  const { test } = server
  if (!test) return "未测试"
  const stateLabel =
    test.state === "connected"
      ? `通过 · ${test.tools.length} 个工具`
      : test.state === "needs-auth"
        ? "需要授权"
        : "失败"
  return `${stateLabel} · ${new Date(test.testedAt).toLocaleString()}`
}

const DEFAULT_PAGE_SIZE = 10

export function McpServerList({
  servers,
  loading,
  hasLoaded = servers.length > 0,
  error,
  errorDetails,
  failure: listFailure,
  busy,
  busyNames = [],
  rowFailures = {},
  removalPending,
  unresolvedNames = [],
  query,
  onQuery,
  onAdd,
  onEdit,
  onRemove,
  onToggle,
  onRetryToggle,
  onCheckToggle,
  onRetry,
}: McpServerListProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const term = query.toLowerCase().trim()
  const matching = term
    ? servers.filter(({ configuration }) =>
        `${configuration.name} ${configuration.description} ${configuration.command} ${configuration.url}`
          .toLowerCase()
          .includes(term)
      )
    : servers

  const totalPages = Math.max(1, Math.ceil(matching.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageItems = matching.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  const initialLoading = loading && !hasLoaded
  const initialFailure = !!error && !hasLoaded

  const activeRowFailures = servers
    .map((server) => {
      const name = server.configuration.name
      const failure = rowFailures[name]
      const rowBusy = !!busy || busyNames.includes(name)
      if (!failure || rowBusy) return null
      const unknown =
        unresolvedNames.includes(name) ||
        failure.code === "result_unknown" ||
        failure.recovery === "check"
      return { server, name, failure, unknown }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  return (
    <div className="model-page">
      <div className="flex flex-col gap-6">
        <header>
          <h2 className="text-[20px] leading-7 font-semibold">入站 MCP 服务</h2>
        </header>

        {error && (
          <OperationFeedback
            notify={false}
            title={hasLoaded ? "未能刷新 MCP 服务" : "无法读取 MCP 服务"}
            message={hasLoaded ? `已保留上次读取的目录。${error}` : error}
            details={errorDetails}
            severity={hasLoaded ? "warning" : "error"}
            actions={
              <RecoveryAction
                issue={
                  listFailure ?? {
                    message: error,
                    code: "read_failed",
                    recovery: "reload",
                  }
                }
                onRetry={onRetry}
                onReload={onRetry}
                disabled={busy || loading}
                labels={{ retry: "重新读取" }}
              />
            }
          />
        )}

        {activeRowFailures.map(({ server, name, failure, unknown }) => (
          <OperationFeedback
            key={name}
            notify={false}
            title={
              unknown
                ? `${name} 的启用状态待确认`
                : `未能${failure.enabled ? "启用" : "停用"} ${name}`
            }
            message={failure.message}
            details={failure.details}
            severity={unknown ? "warning" : "error"}
            actions={
              <RecoveryAction
                issue={failure}
                onCheck={() => onCheckToggle?.(server)}
                onRetry={() => onRetryToggle?.(server, failure.enabled)}
                onReload={onRetry}
                onSettings={unknown ? undefined : () => onEdit(server)}
                disabled={loading}
                labels={{ check: "核对启用结果" }}
              />
            }
          />
        ))}

        {initialLoading ? (
          <div
            className="flex flex-col gap-3"
            role="status"
            aria-label="正在读取 MCP 服务"
          >
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-8 w-72 max-w-full" />
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-56 w-full rounded-lg" />
          </div>
        ) : initialFailure ? null : (
          <section className="flex flex-col gap-3" aria-label="入站 MCP 服务目录">
            {servers.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <InputGroup className="h-8 w-full max-w-xs">
                  <InputGroupAddon>
                    <Search className="size-3.5" />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="搜索 MCP 服务"
                    placeholder="按名称、用途或地址筛选"
                    value={query}
                    onChange={(event) => {
                      onQuery(event.target.value)
                      setPage(1)
                    }}
                  />
                  {query && (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        aria-label="清空筛选"
                        onClick={() => {
                          onQuery("")
                          setPage(1)
                        }}
                      >
                        <X />
                      </InputGroupButton>
                    </InputGroupAddon>
                  )}
                </InputGroup>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={onRetry}
                    disabled={
                      loading ||
                      busy ||
                      listFailure?.recovery === "restart" ||
                      listFailure?.recovery === "none"
                    }
                  >
                    {loading ? (
                      <Loader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <RefreshCw data-icon="inline-start" />
                    )}
                    {loading ? "正在刷新…" : "刷新状态"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    disabled={busy}
                    onClick={onAdd}
                  >
                    <Plus data-icon="inline-start" />
                    添加服务
                  </Button>
                </div>
              </div>
            )}

            {pageItems.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table variant="compact">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="min-w-[140px]">名称</TableHead>
                      <TableHead className="w-[136px]">传输方式</TableHead>
                      <TableHead className="min-w-[200px]">命令 / 地址</TableHead>
                      <TableHead className="w-[116px]">连接状态</TableHead>
                      <TableHead className="w-[160px]">最近测试</TableHead>
                      <TableHead className="w-[68px]">启用</TableHead>
                      <TableHead className="w-[60px] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((server) => {
                      const { configuration } = server
                      const name = configuration.name
                      const rowBusy = !!busy || busyNames.includes(name)
                      const failure = rowFailures[name]
                      const unknown =
                        unresolvedNames.includes(name) ||
                        failure?.code === "result_unknown" ||
                        failure?.recovery === "check"
                      const deletionPending = removalPending === name
                      const endpoint =
                        configuration.transport === "stdio"
                          ? configuration.command
                          : configuration.url
                      const status = formatRuntimeStatus(server)
                      const testSummary = formatTestSummary(server)

                      return (
                        <TableRow key={name}>
                          <TableCell className="max-w-[200px] align-middle">
                            <button
                              type="button"
                              className="model-name"
                              disabled={rowBusy || unknown || deletionPending}
                              onClick={() => onEdit(server)}
                              aria-label={`编辑 ${name} 服务`}
                            >
                              <TableCellText text={name} />
                            </button>
                          </TableCell>
                          <TableCell className="align-middle whitespace-nowrap">
                            <Badge
                              variant="outline"
                              className="px-1.5 font-normal text-muted-foreground"
                            >
                              {configuration.transport === "stdio"
                                ? "stdio"
                                : "Streamable HTTP"}
                            </Badge>
                          </TableCell>
                          <TableCell
                            variant="secondary"
                            className="max-w-[280px] align-middle font-mono"
                          >
                            <TableCellText text={endpoint || "—"} />
                          </TableCell>
                          <TableCell className="align-middle whitespace-nowrap">
                            <Badge
                              variant={status.variant}
                              title={status.tooltip}
                            >
                              {deletionPending
                                ? "待确认删除"
                                : rowBusy
                                  ? "保存中…"
                                  : status.label}
                            </Badge>
                          </TableCell>
                          <TableCell
                            variant="secondary"
                            className="max-w-[180px] align-middle"
                          >
                            <TableCellText text={testSummary} />
                          </TableCell>
                          <TableCell className="align-middle whitespace-nowrap">
                            <Switch
                              aria-label={`启用 ${name}`}
                              checked={configuration.enabled}
                              disabled={rowBusy || unknown || deletionPending}
                              onCheckedChange={(checked) =>
                                onToggle(server, checked)
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right align-middle whitespace-nowrap">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  className="size-8"
                                  disabled={
                                    rowBusy ||
                                    unknown ||
                                    (!!removalPending && !deletionPending)
                                  }
                                  aria-label={`${name} 的操作`}
                                >
                                  <Ellipsis />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    disabled={deletionPending}
                                    onSelect={() => onEdit(server)}
                                  >
                                    <Pencil />
                                    编辑服务
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant={
                                      deletionPending
                                        ? "default"
                                        : "destructive"
                                    }
                                    onSelect={() => onRemove(server)}
                                  >
                                    {deletionPending ? (
                                      <RefreshCw />
                                    ) : (
                                      <Trash2 />
                                    )}
                                    {deletionPending
                                      ? "核对删除结果"
                                      : "删除服务"}
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
            ) : servers.length > 0 ? (
              <Empty className="rounded-lg border border-border py-10">
                <EmptyHeader>
                  <EmptyTitle className="text-sm font-normal">
                    未找到匹配的 MCP 服务
                  </EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onQuery("")
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
                    尚未配置 MCP 服务
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
                    添加服务
                  </Button>
                </EmptyContent>
              </Empty>
            )}

            {servers.length > 0 && (
              <DataTablePagination
                total={servers.length}
                filteredTotal={matching.length}
                filtered={!!term}
                page={currentPage}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                itemLabel="个服务"
              />
            )}
          </section>
        )}
      </div>
    </div>
  )
}
