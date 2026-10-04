import { Fragment } from "react"
import { Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
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

function McpConnectionStatus({ server }: { server: McpServer }) {
  const { runtime, configuration, test } = server
  const status = !configuration.enabled
    ? "已停用"
    : runtime
      ? {
          connecting: "会话正在连接",
          connected: `已连接 · ${runtime.connections} 个会话`,
          disconnected: "会话连接已断开",
          "needs-auth": "会话连接需要授权",
          failed: "会话连接失败",
        }[runtime.state]
      : "尚未建立会话连接"
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm">{status}</p>
      {runtime &&
        runtime.state !== "connected" &&
        runtime.connections > 0 &&
        configuration.enabled && (
          <p className="text-xs text-muted-foreground">
            另有 {runtime.connections} 个会话已连接
          </p>
        )}
      <p className="text-xs text-muted-foreground">
        {!configuration.enabled
          ? "下一轮不提供此服务的工具"
          : configuration.exposure === "hidden"
            ? "工具已隐藏，当前不提供调用"
            : (runtime?.connections || 0) > 0
              ? "按各会话已选工具提供调用"
              : "连接就绪后，按会话选择提供工具"}
      </p>
      <p className="text-xs text-muted-foreground">
        {test
          ? `最近测试：${test.state === "connected" ? `通过 · ${test.tools.length} 个工具` : test.state === "needs-auth" ? "需要授权" : "失败"} · ${new Date(test.testedAt).toLocaleString()}`
          : "尚未测试"}
      </p>
      {runtime?.error && configuration.enabled && (
        <OperationFeedback
          title="会话连接需要处理"
          message="请在服务配置中检查连接参数与凭据，再测试连接。"
          details={runtime.error}
          severity="warning"
        />
      )}
    </div>
  )
}

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
  const matching = servers.filter(({ configuration }) =>
    `${configuration.name} ${configuration.description} ${configuration.command} ${configuration.url}`
      .toLowerCase()
      .includes(query.toLowerCase().trim())
  )
  const initialLoading = loading && !hasLoaded
  const initialFailure = !!error && !hasLoaded
  return (
    <section
      className="model-page flex flex-col gap-4"
      aria-label="MCP 服务目录"
    >
      <header className="model-head mb-0">
        <div>
          <h2>MCP 服务</h2>
          <p>管理已保存服务，在会话配置中选择本次可用工具。</p>
        </div>
        <Button
          disabled={busy || initialLoading || initialFailure}
          onClick={onAdd}
        >
          <Plus data-icon="inline-start" />
          添加服务
        </Button>
      </header>
      {error && (
        <OperationFeedback
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
      {!initialFailure && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <InputGroup className="max-w-sm">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="搜索 MCP 服务"
              placeholder="搜索名称、用途或地址"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
            />
          </InputGroup>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRetry}
            disabled={
              loading ||
              busy ||
              listFailure?.recovery === "restart" ||
              listFailure?.recovery === "none"
            }
          >
            {loading ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {loading ? "正在刷新…" : "刷新状态"}
          </Button>
        </div>
      )}
      {initialLoading ? (
        <div
          className="flex flex-col gap-3"
          role="status"
          aria-label="正在读取 MCP 服务"
        >
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : initialFailure ? null : !matching.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {query ? "没有匹配的服务" : "尚未配置 MCP 服务"}
            </EmptyTitle>
            <EmptyDescription>
              {query
                ? "修改搜索条件查看其他服务。"
                : "添加本地程序或 HTTP 服务，然后测试并保存。"}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              disabled={busy}
              onClick={query ? () => onQuery("") : onAdd}
            >
              {query ? "清空搜索" : "添加服务"}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>服务</TableHead>
                <TableHead>会话连接与最近测试</TableHead>
                <TableHead>启用</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matching.map((server) => {
                const name = server.configuration.name
                const rowBusy = !!busy || busyNames.includes(name)
                const failure = rowFailures[name]
                const unknown =
                  unresolvedNames.includes(name) ||
                  failure?.code === "result_unknown" ||
                  failure?.recovery === "check"
                const deletionPending = removalPending === name
                return (
                  <Fragment key={name}>
                    <TableRow>
                      <TableCell className="max-w-xs min-w-44">
                        <Button
                          variant="link"
                          className="h-auto p-0"
                          disabled={rowBusy || unknown || deletionPending}
                          onClick={() => onEdit(server)}
                        >
                          {name}
                        </Button>
                        <p className="mt-1 text-xs break-words text-muted-foreground">
                          {server.configuration.description ||
                            (server.configuration.transport === "stdio"
                              ? server.configuration.command
                              : server.configuration.url)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="outline">
                            {server.configuration.transport === "stdio"
                              ? "本地 · stdio"
                              : "Streamable HTTP"}
                          </Badge>
                          <Badge variant="secondary">已保存</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-64">
                        <McpConnectionStatus server={server} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-2">
                          <Switch
                            aria-label={`启用 ${name}`}
                            checked={server.configuration.enabled}
                            disabled={rowBusy || unknown || deletionPending}
                            onCheckedChange={(checked) =>
                              onToggle(server, checked)
                            }
                          />
                          <span
                            className="text-xs text-muted-foreground"
                            role={rowBusy ? "status" : undefined}
                          >
                            {deletionPending
                              ? "删除结果待确认"
                              : rowBusy
                                ? "正在保存…"
                                : server.configuration.enabled
                                  ? "已启用"
                                  : "已停用"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={rowBusy || unknown || deletionPending}
                          onClick={() => onEdit(server)}
                        >
                          配置
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={
                            rowBusy ||
                            unknown ||
                            (!!removalPending && !deletionPending)
                          }
                          aria-label={
                            deletionPending
                              ? `核对 ${name} 删除结果`
                              : `删除 ${name}`
                          }
                          onClick={() => onRemove(server)}
                        >
                          {deletionPending ? <RefreshCw /> : <Trash2 />}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {failure && !rowBusy && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <OperationFeedback
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
                                onRetry={() =>
                                  onRetryToggle?.(server, failure.enabled)
                                }
                                onReload={onRetry}
                                onSettings={
                                  unknown ? undefined : () => onEdit(server)
                                }
                                disabled={rowBusy || loading}
                                labels={{ check: "核对启用结果" }}
                              />
                            }
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        保存和启用不会立即建立会话连接；测试通过只验证当时的协议与工具目录。工具需在会话配置中选中，下一次发送或应用配置时生效；正在执行的工作继续使用本轮配置。
      </p>
    </section>
  )
}
