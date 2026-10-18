import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select"
import { callPlugin } from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import type { LogEntry, LogFilter, LogPage, LogsClient } from "./types"
import "./web.css"
const service: LogsClient = {
  query: async (input, signal) =>
    (
      await callPlugin<{ value: LogPage }>(
        "logs",
        "query",
        input,
        undefined,
        signal
      )
    ).value,
  detail: async (id, signal) =>
    (
      await callPlugin<{ value: { entry: LogEntry; issue: string } }>(
        "logs",
        "detail",
        { id },
        undefined,
        signal
      )
    ).value,
}
const blankFilter: LogFilter = {
  from: "",
  to: "",
  plugin: "",
  tool: "",
  status: "",
}
const statuses: Record<string, string> = {
  started: "开始",
  succeeded: "成功",
  failed: "失败",
  cancelled: "取消",
  rejected: "拒绝",
  error: "服务错误",
  connected: "连接",
  stopped: "停止",
  "token-reset": "token重置",
}
const label = (status: string) => statuses[status] || status
const message = (error: unknown) =>
  error instanceof Error ? error.message : "日志读取失败。"
const formatTime = (time: string) => new Date(time).toLocaleString()
export function Page({ service: source = service }: { service?: LogsClient }) {
  const [draft, setDraft] = useState(blankFilter)
  const [query, setQuery] = useState({
    filter: blankFilter,
    offset: 0,
    serial: 0,
  })
  const [value, setValue] = useState<LogPage>()
  const [pending, setPending] = useState(true)
  const [error, setError] = useState("")
  const [detailId, setDetailId] = useState("")
  const [detail, setDetail] = useState<LogEntry>()
  const [detailError, setDetailError] = useState("")
  const detailAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void source
      .query(
        { ...query.filter, offset: query.offset, limit: 50 },
        controller.signal
      )
      .then((next) => {
        if (!controller.signal.aborted) {
          setValue(next)
          setError("")
          setPending(false)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(message(error))
          setPending(false)
        }
      })
    return () => controller.abort()
  }, [source, query])
  useEffect(() => {
    if (!detailId) return
    const controller = new AbortController()
    detailAbort.current = controller
    void source
      .detail(detailId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setDetail(next.entry)
          setDetailError(next.issue)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDetailError(message(error))
      })
    return () => {
      controller.abort()
      detailAbort.current = null
    }
  }, [source, detailId])
  const load = (offset = 0, filter = draft) => {
    setPending(true)
    setValue(undefined)
    setError("")
    setDetailId("")
    setDetail(undefined)
    detailAbort.current?.abort()
    setQuery((previous) => ({ filter, offset, serial: previous.serial + 1 }))
  }
  return (
    <section className="logs-page" aria-label="MCP 与工具日志">
      <header className="logs-header">
        <div>
          <h2>MCP 与对外工具日志</h2>
          <p>
            只记录接入与共享调用。默认保留字段类型、长度或插件明确提供的安全摘要。
          </p>
        </div>
        <Button variant="outline" disabled={pending} onClick={() => load()}>
          刷新
        </Button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          load()
        }}
      >
        <FieldGroup className="logs-filters">
          {(
            [
              ["from", "开始时间"],
              ["to", "结束时间"],
              ["plugin", "插件"],
              ["tool", "工具"],
            ] as const
          ).map(([key, title]) => (
            <Field key={key}>
              <FieldLabel htmlFor={`log-${key}`}>{title}</FieldLabel>
              <Input
                id={`log-${key}`}
                type={
                  key === "from" || key === "to" ? "datetime-local" : "text"
                }
                placeholder={
                  key === "plugin"
                    ? "例如 opencli"
                    : key === "tool"
                      ? "例如 opencli__run"
                      : undefined
                }
                value={
                  key === "from" || key === "to"
                    ? draft[key]
                      ? new Date(
                          Date.parse(draft[key]) -
                            new Date(draft[key]).getTimezoneOffset() * 60000
                        )
                          .toISOString()
                          .slice(0, 16)
                      : ""
                    : draft[key]
                }
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    [key]:
                      event.target.value && (key === "from" || key === "to")
                        ? new Date(event.target.value).toISOString()
                        : event.target.value,
                  }))
                }
              />
            </Field>
          ))}
          <Field>
            <FieldLabel htmlFor="log-status">状态</FieldLabel>
            <Select
              value={draft.status || "all"}
              onValueChange={(status) =>
                setDraft((previous) => ({
                  ...previous,
                  status: status === "all" ? "" : status,
                }))
              }
            >
              <SelectTrigger id="log-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部状态</SelectItem>
                  {Object.entries(statuses).map(([key, title]) => (
                    <SelectItem key={key} value={key}>
                      {title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="logs-filter-actions">
            <Button type="submit" disabled={pending}>
              筛选
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setDraft(blankFilter)
                setPending(true)
                setValue(undefined)
                setQuery((previous) => ({
                  filter: blankFilter,
                  offset: 0,
                  serial: previous.serial + 1,
                }))
              }}
            >
              重置
            </Button>
          </div>
        </FieldGroup>
      </form>
      {(error || value?.issue) && (
        <Alert>
          <AlertTitle>日志需要处理</AlertTitle>
          <AlertDescription>{error || value?.issue}</AlertDescription>
        </Alert>
      )}
      {pending ? (
        <p role="status">正在读取日志…</p>
      ) : value?.entries.length ? (
        <Table variant="compact">
          <TableHeader>
            <TableRow>
              <TableHead>时间 / 来源</TableHead>
              <TableHead>插件 / 工具</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>耗时</TableHead>
              <TableHead>详情</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {value.entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  {formatTime(entry.time)}
                  <p>{entry.source === "tool" ? "对外工具" : "MCP 接入"}</p>
                </TableCell>
                <TableCell>
                  <span className="logs-tool">{entry.plugin || "—"}</span>
                  <p className="logs-tool">{entry.tool || "—"}</p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{label(entry.status)}</Badge>
                </TableCell>
                <TableCell>
                  {entry.durationMs === null ? "—" : `${entry.durationMs} ms`}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`查看 ${entry.tool || entry.plugin} ${label(entry.status)} 详情`}
                    onClick={() => {
                      setDetail(undefined)
                      setDetailError("")
                      setDetailId(entry.id)
                    }}
                  >
                    查看
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        !error && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>没有匹配日志</EmptyTitle>
              <EmptyDescription>
                共享工具被调用后会留下记录；也可以调整筛选条件。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      )}
      <footer className="logs-header">
        <p>
          {value
            ? `共 ${value.total} 条；${value.retention.days} 天 / ${value.retention.maxEntries} 条 / ${Math.round(value.retention.maxBytes / 1048576)} MiB，先到为准。`
            : "日志查看插件停用期间，宿主仍记录。"}
        </p>
        <div className="logs-filter-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={pending || query.offset === 0}
            onClick={() => load(Math.max(0, query.offset - 50), query.filter)}
          >
            上一页
          </Button>
          <span>{Math.floor(query.offset / 50) + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !value || query.offset + 50 >= value.total}
            onClick={() => load(query.offset + 50, query.filter)}
          >
            下一页
          </Button>
        </div>
      </footer>
      <Dialog
        open={!!detailId}
        onOpenChange={(open) => {
          if (!open) {
            detailAbort.current?.abort()
            setDetailId("")
            setDetail(undefined)
          }
        }}
      >
        <DialogContent className="logs-dialog">
          <DialogHeader>
            <DialogTitle>调用记录详情</DialogTitle>
            <DialogDescription>
              客户端名称为自报，缺少时显示“未提供”，不代表认证身份。摘要不包含原始调用内容。
            </DialogDescription>
          </DialogHeader>
          {detailError && <p role="alert">{detailError}</p>}
          {detail ? (
            <dl>
              {(
                [
                  ["时间", formatTime(detail.time)],
                  ["来源", detail.source],
                  ["插件 / 工具", `${detail.plugin} / ${detail.tool || "—"}`],
                  ["状态", label(detail.status)],
                  ["调用 ID", detail.callId || "—"],
                  ["客户端（自报）", detail.client],
                  [
                    "耗时",
                    detail.durationMs === null
                      ? "—"
                      : `${detail.durationMs} ms`,
                  ],
                  ["参数摘要", detail.input || "—"],
                  ["结果摘要", detail.result || "—"],
                  ["安全错误说明", detail.error || "—"],
                ] as const
              ).map(([name, content]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{content}</dd>
                </div>
              ))}
            </dl>
          ) : (
            !detailError && <p role="status">读取详情…</p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
export default {
  id: "logs",
  apiVersion: 1,
  pages: [{ id: "viewer", component: () => <Page /> }],
} satisfies PluginWebModule
