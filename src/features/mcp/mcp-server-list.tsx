import { Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import type { McpServer } from "./mcp-service"
export type McpServerListProps = {
  servers: McpServer[]
  loading: boolean
  error: string
  busy?: boolean
  query: string
  onQuery(value: string): void
  onAdd(): void
  onEdit(server: McpServer): void
  onRemove(server: McpServer): void
  onToggle(server: McpServer, enabled: boolean): void
  onRetry(): void
}
export function McpServerList({
  servers,
  loading,
  error,
  busy,
  query,
  onQuery,
  onAdd,
  onEdit,
  onRemove,
  onToggle,
  onRetry,
}: McpServerListProps) {
  const matching = servers.filter(({ configuration }) =>
    `${configuration.name} ${configuration.description} ${configuration.command} ${configuration.url}`
      .toLowerCase()
      .includes(query.toLowerCase().trim())
  )
  return (
    <section
      className="model-page flex flex-col gap-4"
      aria-label="MCP 服务目录"
    >
      <header className="model-head mb-0">
        <div>
          <h2>MCP 服务</h2>
          <p>连接工具服务，在会话配置中选择本次可用工具。</p>
        </div>
        <Button disabled={busy || loading} onClick={onAdd}>
          <Plus />
          添加服务
        </Button>
      </header>
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            {error}
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={busy}
            >
              重新读取
            </Button>
          </AlertDescription>
        </Alert>
      )}
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
          disabled={loading || busy}
        >
          <RefreshCw />
          刷新状态
        </Button>
      </div>
      {loading ? (
        <div
          className="flex flex-col gap-3"
          role="status"
          aria-label="正在读取 MCP 服务"
        >
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : !matching.length ? (
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
                <TableHead>连接与工具</TableHead>
                <TableHead>启用</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matching.map((server) => (
                <TableRow key={server.configuration.name}>
                  <TableCell className="max-w-xs min-w-44">
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      disabled={busy}
                      onClick={() => onEdit(server)}
                    >
                      {server.configuration.name}
                    </Button>
                    <p className="mt-1 text-xs break-words text-muted-foreground">
                      {server.configuration.description ||
                        (server.configuration.transport === "stdio"
                          ? server.configuration.command
                          : server.configuration.url)}
                    </p>
                    <Badge variant="outline" className="mt-2">
                      {server.configuration.transport === "stdio"
                        ? "本地 · stdio"
                        : "Streamable HTTP"}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-52">
                    <p className="text-sm">
                      {!server.configuration.enabled
                        ? "已停用"
                        : server.runtime
                          ? server.runtime.state === "connected"
                            ? `已连接 · ${server.runtime.connections} 个会话`
                            : {
                                connecting: "连接中",
                                disconnected: "连接已断开",
                                "needs-auth": "需要授权",
                                failed: "运行连接失败",
                              }[server.runtime.state] || "等待连接"
                          : "未建立会话连接"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {server.runtime?.error ||
                        (server.test
                          ? server.test.state === "connected"
                            ? `最近验证 ${server.test.tools.length} 个工具 · ${new Date(server.test.testedAt).toLocaleString()}`
                            : server.test.error
                          : "尚未测试")}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`启用 ${server.configuration.name}`}
                      checked={server.configuration.enabled}
                      disabled={busy}
                      onCheckedChange={(checked) => onToggle(server, checked)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onEdit(server)}
                    >
                      配置
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={`删除 ${server.configuration.name}`}
                      onClick={() => onRemove(server)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        保存、启停和删除在会话空闲后的下一次发送或应用配置时生效；正在执行的工作继续使用本轮配置。
      </p>
    </section>
  )
}
