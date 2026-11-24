import { useEffect, useRef, useState } from "react"
import {
  ChevronRight,
  Copy,
  Download,
  Filter,
  GitBranch,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { notifyToast } from "@/components/ui/notification-toast"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
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
import type {
  LogEntry,
  LogFilter,
  LogPage,
  LogsClient,
  TransportLogPage,
  TransportLogRecord,
} from "./types"

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
  operationQuery: async (input, signal) =>
    (
      await callPlugin<{ value: TransportLogPage }>(
        "logs",
        "operationQuery",
        input,
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
  start_failed: "启动失败",
  cancelled: "取消",
  rejected: "拒绝",
  error: "服务错误",
  connected: "连接",
  stopped: "停止",
  "token-reset": "token重置",
}

const statusLabel = (status: string) => statuses[status] || status

const outcomes: Record<string, string> = {
  committed: "已提交",
  rejected: "已拒绝",
  unknown: "结果未知",
}

const transportLevels = ["debug", "info", "warn", "error"]

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : "日志读取失败。"

const formatFullTime = (time: string) => new Date(time).toLocaleString()

const formatShortTime = (time: string) => {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return time
  return date.toTimeString().slice(0, 8)
}

const formatDuration = (durationMs?: number | null) => {
  if (durationMs === undefined || durationMs === null) return "—"
  if (durationMs >= 10_000) return `${(durationMs / 1000).toFixed(1)} s`
  return `${durationMs} ms`
}

const toLocalInputValue = (iso: string) => {
  if (!iso) return ""
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return ""
  return new Date(parsed - new Date(parsed).getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

function LevelIndicator({ level }: { level: string }) {
  const dot =
    level === "error"
      ? "bg-destructive"
      : level === "warn"
        ? "bg-status-warning"
        : "bg-muted-foreground/45"
  const text =
    level === "error"
      ? "text-destructive font-medium"
      : level === "warn"
        ? "text-status-warning font-medium"
        : "text-muted-foreground"
  return (
    <span className="inline-flex w-12 shrink-0 items-center gap-1.5 font-mono text-xs leading-5">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${dot}`}
      />
      <span className={text}>{level}</span>
    </span>
  )
}

function StatusIndicator({ status }: { status: string }) {
  const isError =
    status === "failed" ||
    status === "error" ||
    status === "rejected" ||
    status.endsWith("_failed")
  const isOk = status === "succeeded" || status === "connected"
  const dot = isError
    ? "bg-destructive"
    : isOk
      ? "bg-emerald-500"
      : "bg-muted-foreground/45"
  const text = isError
    ? "text-destructive font-medium"
    : isOk
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground"
  return (
    <span className="inline-flex w-20 shrink-0 items-center gap-1.5 text-xs leading-5">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${dot}`}
      />
      <span className={`truncate ${text}`}>{statusLabel(status)}</span>
    </span>
  )
}

type TransportDraft = {
  traceId: string
  level: string
  module: string
  errorId: string
  from: string
  to: string
}

const blankTransport: TransportDraft = {
  traceId: "",
  level: "",
  module: "",
  errorId: "",
  from: "",
  to: "",
}

type TransportPreset = "all" | "error" | "slow" | "startup"

const TRANSPORT_PAGE_SIZE = 20
const ACTIVITY_PAGE_SIZE = 20

const TRANSPORT_PRESETS: ReadonlyArray<readonly [TransportPreset, string]> = [
  ["all", "全部"],
  ["error", "异常"],
  ["slow", "慢操作"],
  ["startup", "宿主启动"],
]

export function Page({ service: source = service }: { service?: LogsClient }) {
  const [activeTab, setActiveTab] = useState<"diagnostics" | "activity">(
    "diagnostics"
  )

  // 工具活动状态
  const [draft, setDraft] = useState(blankFilter)
  const [query, setQuery] = useState({
    filter: blankFilter,
    offset: 0,
    serial: 0,
  })
  const [showActivityTime, setShowActivityTime] = useState(false)
  const [value, setValue] = useState<LogPage>()
  const [pending, setPending] = useState(true)
  const [error, setError] = useState("")
  const [detailId, setDetailId] = useState("")
  const [detail, setDetail] = useState<LogEntry>()
  const [detailError, setDetailError] = useState("")
  const detailAbort = useRef<AbortController | null>(null)

  // 诊断日志状态
  const [transportDraft, setTransportDraft] =
    useState<TransportDraft>(blankTransport)
  const [transportQuery, setTransportQuery] =
    useState<TransportDraft>(blankTransport)
  const [transportPreset, setTransportPreset] = useState<TransportPreset>("all")
  const [showTransportFilters, setShowTransportFilters] = useState(false)
  const [transportPage, setTransportPage] = useState(1)
  const [transport, setTransport] = useState<TransportLogPage>()
  const [transportPending, setTransportPending] = useState(true)
  const [transportError, setTransportError] = useState("")
  const [selectedTransport, setSelectedTransport] =
    useState<TransportLogRecord | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void source
      .operationQuery(
        {
          ...transportQuery,
          from: transportQuery.from
            ? new Date(transportQuery.from).toISOString()
            : "",
          to: transportQuery.to
            ? new Date(transportQuery.to).toISOString()
            : "",
          limit: 200,
        },
        controller.signal
      )
      .then((next) => {
        if (!controller.signal.aborted) {
          setTransport(next)
          setTransportError("")
          setTransportPending(false)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setTransportError(message(reason))
          setTransportPending(false)
        }
      })
    return () => controller.abort()
  }, [source, transportQuery])

  const loadTransport = (filter: TransportDraft) => {
    setTransportPending(true)
    setTransportError("")
    setTransportPage(1)
    setTransportQuery({
      ...filter,
      module: filter.module.trim(),
      errorId: filter.errorId.trim(),
      traceId: filter.traceId.trim(),
      level: filter.level,
    })
  }

  const resetTransport = () => {
    setTransportPreset("all")
    setTransportDraft(blankTransport)
    loadTransport(blankTransport)
  }

  const applyPreset = (preset: TransportPreset) => {
    setTransportPreset(preset)
    if (preset === "error") {
      const next = { ...blankTransport, level: "error" }
      setTransportDraft(next)
      loadTransport(next)
    } else if (preset === "startup") {
      const next = { ...blankTransport, module: "plugin-host" }
      setTransportDraft(next)
      loadTransport(next)
    } else {
      setTransportDraft(blankTransport)
      loadTransport(blankTransport)
    }
  }

  const filterByTraceId = (traceId: string) => {
    if (!traceId) return
    const next = { ...blankTransport, traceId }
    setTransportPreset("all")
    setTransportDraft(next)
    setSelectedTransport(null)
    loadTransport(next)
  }

  const visibleTransportRecords = (transport?.records ?? []).filter(
    (record) => {
      if (transportPreset === "slow") {
        return (record.durationMs ?? 0) >= 1000
      }
      return true
    }
  )

  const transportTotalPages = Math.max(
    1,
    Math.ceil(visibleTransportRecords.length / TRANSPORT_PAGE_SIZE)
  )
  const currentTransportPage = Math.min(transportPage, transportTotalPages)
  const pagedTransportRecords = visibleTransportRecords.slice(
    (currentTransportPage - 1) * TRANSPORT_PAGE_SIZE,
    currentTransportPage * TRANSPORT_PAGE_SIZE
  )

  const hasCustomTransportFilter = Boolean(
    transportQuery.traceId ||
    transportQuery.errorId ||
    (transportQuery.module && transportPreset !== "startup") ||
    (transportQuery.level && transportPreset !== "error")
  )

  const exportRecords = () => {
    const records = visibleTransportRecords
    if (!records.length) return
    const body =
      records.map((record) => JSON.stringify(record)).join("\n") + "\n"
    const url = URL.createObjectURL(
      new Blob([body], { type: "application/x-ndjson" })
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `moon-diagnostics-${new Date()
      .toISOString()
      .replace(/[:TZ]/g, "")
      .slice(0, 14)}.jsonl`
    anchor.click()
    URL.revokeObjectURL(url)
    notifyToast("已导出脱敏诊断日志", { tone: "success" })
  }

  useEffect(() => {
    const controller = new AbortController()
    void source
      .query(
        { ...query.filter, offset: query.offset, limit: ACTIVITY_PAGE_SIZE },
        controller.signal
      )
      .then((next) => {
        if (!controller.signal.aborted) {
          setValue(next)
          setError("")
          setPending(false)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(message(reason))
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
      .catch((reason) => {
        if (!controller.signal.aborted) setDetailError(message(reason))
      })
    return () => {
      controller.abort()
      detailAbort.current = null
    }
  }, [source, detailId])

  const loadActivity = (offset = 0, filter = draft) => {
    setPending(true)
    setValue(undefined)
    setError("")
    setDetailId("")
    setDetail(undefined)
    detailAbort.current?.abort()
    setQuery((previous) => ({ filter, offset, serial: previous.serial + 1 }))
  }

  const hasActivityFilter = Boolean(
    query.filter.from ||
    query.filter.to ||
    query.filter.plugin ||
    query.filter.tool ||
    query.filter.status
  )

  const copyText = (text: string, labelText: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => notifyToast(`已复制${labelText}`, { tone: "success" }))
      .catch(() => notifyToast("复制失败", { tone: "warning" }))
  }

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="日志">
      <Tabs
        value={activeTab}
        onValueChange={(next) =>
          setActiveTab(next as "diagnostics" | "activity")
        }
        className="gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList aria-label="日志类型">
            <TabsTrigger value="diagnostics">诊断日志</TabsTrigger>
            <TabsTrigger value="activity">工具活动</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {activeTab === "diagnostics" && (
              <Button
                variant="outline"
                className="text-xs"
                disabled={transportPending || !visibleTransportRecords.length}
                onClick={exportRecords}
              >
                <Download className="size-3.5" />
                导出
              </Button>
            )}
            <Button
              variant="outline"
              className="text-xs"
              disabled={
                activeTab === "diagnostics" ? transportPending : pending
              }
              onClick={() =>
                activeTab === "diagnostics"
                  ? loadTransport(transportDraft)
                  : loadActivity(query.offset, query.filter)
              }
            >
              <RefreshCw className="size-3.5" />
              刷新
            </Button>
          </div>
        </div>

        <TabsContent value="diagnostics">
          <div
            className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card"
            aria-label="诊断日志"
          >
            <div className="flex flex-col gap-2.5 border-b bg-muted/20 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="group"
                  aria-label="诊断快捷筛选"
                  className="flex flex-wrap items-center gap-1"
                >
                  {TRANSPORT_PRESETS.map(([key, caption]) => {
                    const active =
                      transportPreset === key && !transportQuery.traceId
                    return (
                      <Button
                        key={key}
                        type="button"
                        size="sm"
                        variant={active ? "secondary" : "ghost"}
                        disabled={transportPending}
                        aria-pressed={active}
                        onClick={() => applyPreset(key)}
                      >
                        {caption}
                      </Button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-1.5">
                  {transportQuery.traceId && (
                    <Badge
                      variant="secondary"
                      className="h-7 gap-1 pr-1 font-mono text-xs font-normal"
                    >
                      链路 {transportQuery.traceId.slice(0, 8)}
                      <button
                        type="button"
                        aria-label="清除链路筛选"
                        className="rounded p-0.5 hover:bg-background/60"
                        onClick={resetTransport}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      showTransportFilters || hasCustomTransportFilter
                        ? "secondary"
                        : "ghost"
                    }
                    onClick={() =>
                      setShowTransportFilters((previous) => !previous)
                    }
                  >
                    <SlidersHorizontal className="size-3.5" />
                    筛选
                  </Button>
                </div>
              </div>

              {showTransportFilters && (
                <form
                  className="flex flex-wrap items-center gap-2 border-t pt-2.5"
                  onSubmit={(event) => {
                    event.preventDefault()
                    loadTransport(transportDraft)
                  }}
                >
                  <Input
                    id="log-trace"
                    aria-label="链路追踪 ID"
                    className="min-w-[140px] flex-1 font-mono text-xs"
                    placeholder="链路 traceId"
                    value={transportDraft.traceId}
                    onChange={(event) =>
                      setTransportDraft((previous) => ({
                        ...previous,
                        traceId: event.target.value,
                      }))
                    }
                  />
                  <Input
                    id="log-transport-module"
                    aria-label="模块"
                    className="w-24 text-xs"
                    placeholder="模块"
                    value={transportDraft.module}
                    onChange={(event) =>
                      setTransportDraft((previous) => ({
                        ...previous,
                        module: event.target.value,
                      }))
                    }
                  />
                  <Input
                    id="log-transport-errorId"
                    aria-label="错误编号"
                    className="w-24 font-mono text-xs"
                    placeholder="errorId"
                    value={transportDraft.errorId}
                    onChange={(event) =>
                      setTransportDraft((previous) => ({
                        ...previous,
                        errorId: event.target.value,
                      }))
                    }
                  />
                  <Select
                    value={transportDraft.level || "all"}
                    onValueChange={(level) =>
                      setTransportDraft((previous) => ({
                        ...previous,
                        level: level === "all" ? "" : level,
                      }))
                    }
                  >
                    <SelectTrigger
                      id="log-transport-level"
                      className="w-24 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">全部级别</SelectItem>
                        {transportLevels.map((level) => (
                          <SelectItem key={level} value={level}>
                            {level}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    type="submit"
                    className="text-xs"
                    disabled={transportPending}
                  >
                    应用
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs"
                    disabled={transportPending}
                    onClick={resetTransport}
                  >
                    重置
                  </Button>
                </form>
              )}
            </div>

            {(transportError || transport?.issue) && (
              <div className="border-b p-3">
                <Alert>
                  <AlertTitle>日志需要处理</AlertTitle>
                  <AlertDescription>
                    {transportError || transport?.issue}
                  </AlertDescription>
                </Alert>
              </div>
            )}

            {transportPending ? (
              <div
                className="flex flex-col gap-2 p-4"
                aria-label="正在读取诊断日志"
              >
                <Skeleton className="h-8 w-full rounded-md" />
                <Skeleton className="h-8 w-full rounded-md" />
                <Skeleton className="h-8 w-full rounded-md" />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            ) : pagedTransportRecords.length ? (
              <div className="divide-y">
                {pagedTransportRecords.map((record, index) => {
                  const hasNonNormalOutcome =
                    record.outcome && record.outcome !== "committed"
                  return (
                    <button
                      key={`${record.timestamp}-${record.operationId}-${index}`}
                      type="button"
                      onClick={() => setSelectedTransport(record)}
                      className="group flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                    >
                      <span
                        title={formatFullTime(record.timestamp)}
                        className="w-16 shrink-0 font-mono text-xs leading-5 text-muted-foreground tabular-nums"
                      >
                        {formatShortTime(record.timestamp)}
                      </span>
                      <LevelIndicator level={record.level} />
                      <div className="min-w-0 flex-1 leading-5">
                        <div className="flex items-baseline gap-1.5">
                          <span className="truncate font-mono text-xs font-medium text-foreground">
                            {record.module}
                            <span className="text-muted-foreground"> / </span>
                            {record.event}
                          </span>
                          {record.repeated && (
                            <Badge
                              variant="outline"
                              className="h-4 shrink-0 px-1 font-mono text-[10px] font-normal"
                            >
                              ×{record.repeated}
                            </Badge>
                          )}
                        </div>
                        {record.error && (
                          <p className="mt-0.5 truncate font-mono text-xs text-destructive">
                            {record.error.errorId}
                            {record.error.code ? ` · ${record.error.code}` : ""}
                            {record.error.cause
                              ? `：${record.error.cause}`
                              : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                        {hasNonNormalOutcome && (
                          <Badge
                            variant="outline"
                            className="h-5 px-1.5 text-[11px] font-normal"
                          >
                            {outcomes[record.outcome] || record.outcome}
                          </Badge>
                        )}
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {formatDuration(record.durationMs)}
                        </span>
                        <ChevronRight className="size-3.5 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              !transportError && (
                <div className="p-6">
                  <Empty className="border-0 py-4">
                    <EmptyHeader>
                      <EmptyTitle>没有匹配的诊断记录</EmptyTitle>
                      <EmptyDescription>
                        可切换筛选条件或按链路追踪 ID 查询。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </div>
              )
            )}

            {transport && (
              <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground tabular-nums">
                <span>
                  {transportPreset === "slow"
                    ? `匹配 ${visibleTransportRecords.length} / ${transport.records.length} 条（≥1s）`
                    : `共 ${transport.records.length} 条`}
                  {transport.queued > 0 ? ` · 队列 ${transport.queued}` : ""}
                  {transport.dropped > 0 ? ` · 挤出 ${transport.dropped}` : ""}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={transportPending || currentTransportPage <= 1}
                    onClick={() =>
                      setTransportPage(Math.max(1, currentTransportPage - 1))
                    }
                  >
                    上一页
                  </Button>
                  <span>
                    {currentTransportPage} / {transportTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      transportPending ||
                      currentTransportPage >= transportTotalPages
                    }
                    onClick={() =>
                      setTransportPage(
                        Math.min(transportTotalPages, currentTransportPage + 1)
                      )
                    }
                  >
                    下一页
                  </Button>
                </div>
              </footer>
            )}
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <div
            className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card"
            aria-label="工具活动日志"
          >
            <form
              className="flex flex-col gap-2.5 border-b bg-muted/20 px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault()
                loadActivity(0, draft)
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="log-plugin"
                  aria-label="插件"
                  className="min-w-[110px] flex-1 text-xs"
                  placeholder="插件（如 opencli）"
                  value={draft.plugin}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      plugin: event.target.value,
                    }))
                  }
                />
                <Input
                  id="log-tool"
                  aria-label="工具"
                  className="min-w-[130px] flex-1 text-xs"
                  placeholder="工具（如 opencli__run）"
                  value={draft.tool}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      tool: event.target.value,
                    }))
                  }
                />
                <Select
                  value={draft.status || "all"}
                  onValueChange={(status) => {
                    const next = {
                      ...draft,
                      status: status === "all" ? "" : status,
                    }
                    setDraft(next)
                    loadActivity(0, next)
                  }}
                >
                  <SelectTrigger id="log-status" className="w-28 text-xs">
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
                <Button
                  type="button"
                  variant={
                    showActivityTime || draft.from || draft.to
                      ? "secondary"
                      : "outline"
                  }
                  className="text-xs"
                  onClick={() => setShowActivityTime((previous) => !previous)}
                >
                  <Filter className="size-3.5" />
                  时间
                </Button>
                <Button type="submit" className="text-xs" disabled={pending}>
                  筛选
                </Button>
                {hasActivityFilter && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-xs"
                    disabled={pending}
                    onClick={() => {
                      setDraft(blankFilter)
                      loadActivity(0, blankFilter)
                    }}
                  >
                    重置
                  </Button>
                )}
              </div>

              {showActivityTime && (
                <div className="grid gap-2 border-t pt-2.5 sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="log-from"
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      开始
                    </label>
                    <Input
                      id="log-from"
                      type="datetime-local"
                      className="text-xs"
                      value={toLocalInputValue(draft.from)}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          from: event.target.value
                            ? new Date(event.target.value).toISOString()
                            : "",
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="log-to"
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      结束
                    </label>
                    <Input
                      id="log-to"
                      type="datetime-local"
                      className="text-xs"
                      value={toLocalInputValue(draft.to)}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          to: event.target.value
                            ? new Date(event.target.value).toISOString()
                            : "",
                        }))
                      }
                    />
                  </div>
                </div>
              )}
            </form>

            {(error || value?.issue) && (
              <div className="border-b p-3">
                <Alert>
                  <AlertTitle>日志需要处理</AlertTitle>
                  <AlertDescription>{error || value?.issue}</AlertDescription>
                </Alert>
              </div>
            )}

            {pending ? (
              <div
                className="flex flex-col gap-2 p-4"
                aria-label="正在读取工具活动日志"
              >
                <Skeleton className="h-8 w-full rounded-md" />
                <Skeleton className="h-8 w-full rounded-md" />
                <Skeleton className="h-8 w-full rounded-md" />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            ) : value?.entries.length ? (
              <div className="divide-y">
                {value.entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-label={`查看 ${entry.tool || entry.plugin} ${statusLabel(entry.status)} 详情`}
                    onClick={() => {
                      setDetail(undefined)
                      setDetailError("")
                      setDetailId(entry.id)
                    }}
                    className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  >
                    <span
                      title={formatFullTime(entry.time)}
                      className="w-16 shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                    >
                      {formatShortTime(entry.time)}
                    </span>
                    <StatusIndicator status={entry.status} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                      {entry.plugin || "—"}
                      {entry.tool ? (
                        <>
                          <span className="text-muted-foreground"> / </span>
                          {entry.tool}
                        </>
                      ) : null}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {entry.source === "tool" ? "对外工具" : "MCP"}
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatDuration(entry.durationMs)}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                  </button>
                ))}
              </div>
            ) : (
              !error && (
                <div className="p-6">
                  <Empty className="border-0 py-4">
                    <EmptyHeader>
                      <EmptyTitle>没有匹配日志</EmptyTitle>
                      <EmptyDescription>
                        共享工具被调用后会留下记录，也可调整筛选条件。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </div>
              )
            )}

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground tabular-nums">
              <span>
                {value
                  ? `共 ${value.total} 条 · 保留 ${value.retention.days} 天 / ${value.retention.maxEntries} 条 / ${Math.round(value.retention.maxBytes / 1048576)} MiB`
                  : "停用插件期间宿主仍继续记录"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || query.offset === 0}
                  onClick={() =>
                    loadActivity(
                      Math.max(0, query.offset - ACTIVITY_PAGE_SIZE),
                      query.filter
                    )
                  }
                >
                  上一页
                </Button>
                <span>
                  {Math.floor(query.offset / ACTIVITY_PAGE_SIZE) + 1} /{" "}
                  {Math.max(
                    1,
                    Math.ceil((value?.total ?? 0) / ACTIVITY_PAGE_SIZE)
                  )}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    pending ||
                    !value ||
                    query.offset + ACTIVITY_PAGE_SIZE >= value.total
                  }
                  onClick={() =>
                    loadActivity(
                      query.offset + ACTIVITY_PAGE_SIZE,
                      query.filter
                    )
                  }
                >
                  下一页
                </Button>
              </div>
            </footer>
          </div>
        </TabsContent>
      </Tabs>

      {/* 诊断记录详情弹窗 */}
      <Dialog
        open={!!selectedTransport}
        onOpenChange={(open) => {
          if (!open) setSelectedTransport(null)
        }}
      >
        <DialogContent className="max-h-[min(90dvh,800px)] overflow-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {selectedTransport
                ? `${selectedTransport.module} / ${selectedTransport.event}`
                : "诊断记录详情"}
            </DialogTitle>
            <DialogDescription>
              {selectedTransport
                ? `${formatFullTime(selectedTransport.timestamp)} · ${selectedTransport.process}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {selectedTransport && (
            <div className="flex flex-col gap-3">
              <dl className="divide-y text-xs">
                {(
                  [
                    ["级别", selectedTransport.level],
                    [
                      "终态",
                      selectedTransport.outcome
                        ? outcomes[selectedTransport.outcome] ||
                          selectedTransport.outcome
                        : "—",
                    ],
                    ["耗时", formatDuration(selectedTransport.durationMs)],
                    ["进程", selectedTransport.process || "—"],
                    ["操作 ID", selectedTransport.operationId || "—"],
                  ] as const
                ).map(([name, content]) => (
                  <div
                    key={name}
                    className="grid gap-1 py-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-3"
                  >
                    <dt className="text-muted-foreground">{name}</dt>
                    <dd className="font-mono break-all text-foreground">
                      {content}
                    </dd>
                  </div>
                ))}
                {selectedTransport.traceId && (
                  <div className="grid gap-1 py-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-3">
                    <dt className="text-muted-foreground">链路 ID</dt>
                    <dd className="flex flex-col gap-2">
                      <span className="font-mono break-all text-foreground">
                        {selectedTransport.traceId}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            copyText(selectedTransport.traceId, "链路 ID")
                          }
                        >
                          <Copy className="size-3" />
                          复制
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            filterByTraceId(selectedTransport.traceId)
                          }
                        >
                          <GitBranch className="size-3" />
                          追踪此链路
                        </Button>
                      </div>
                    </dd>
                  </div>
                )}
                {selectedTransport.repeated && (
                  <div className="grid gap-1 py-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-3">
                    <dt className="text-muted-foreground">重复次数</dt>
                    <dd className="tabular-nums">
                      同类后台故障重复 {selectedTransport.repeated} 次
                    </dd>
                  </div>
                )}
                {selectedTransport.error && (
                  <div className="grid gap-1 py-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-3">
                    <dt className="text-muted-foreground">错误信息</dt>
                    <dd className="font-mono break-all text-destructive">
                      {selectedTransport.error.errorId}
                      {selectedTransport.error.code
                        ? ` · ${selectedTransport.error.code}`
                        : ""}
                      {selectedTransport.error.cause
                        ? `：${selectedTransport.error.cause}`
                        : ""}
                    </dd>
                  </div>
                )}
              </dl>
              {selectedTransport.error?.frames && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">调用栈</span>
                  <pre className="max-h-52 overflow-auto rounded-lg border bg-muted/40 p-2.5 font-mono text-[11px] break-all whitespace-pre-wrap">
                    {selectedTransport.error.frames}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 工具活动详情弹窗 */}
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
        <DialogContent className="max-h-[min(90dvh,800px)] overflow-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>调用记录详情</DialogTitle>
            <DialogDescription>
              摘要不包含原始调用内容；客户端名称为自报，不代表认证身份。
            </DialogDescription>
          </DialogHeader>
          {detailError && (
            <Alert>
              <AlertDescription>{detailError}</AlertDescription>
            </Alert>
          )}
          {detail ? (
            <dl className="divide-y text-xs">
              {(
                [
                  ["时间", formatFullTime(detail.time)],
                  ["来源", detail.source],
                  ["插件 / 工具", `${detail.plugin} / ${detail.tool || "—"}`],
                  ["状态", statusLabel(detail.status)],
                  ["调用 ID", detail.callId || "—"],
                  ["客户端（自报）", detail.client],
                  ["认证作者", detail.actorId || "—"],
                  ["凭据记录", detail.credentialId || "—"],
                  ["耗时", formatDuration(detail.durationMs)],
                  ["参数摘要", detail.input || "—"],
                  ["结果摘要", detail.result || "—"],
                  ["安全错误说明", detail.error || "—"],
                ] as const
              ).map(([name, content]) => (
                <div
                  key={name}
                  className="grid gap-1 py-2 sm:grid-cols-[108px_minmax(0,1fr)] sm:gap-3"
                >
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="font-mono break-all whitespace-pre-wrap text-foreground">
                    {content}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            !detailError && (
              <div className="flex flex-col gap-2 py-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-5 w-3/4" />
              </div>
            )
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

export default {
  id: "logs",
  apiVersion: 1,
  ownsConfiguration: true,
  pages: [{ id: "viewer", component: () => <Page /> }],
} satisfies PluginWebModule
