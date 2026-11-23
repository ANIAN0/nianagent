import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react"
import {
  ArrowLeft,
  ArrowUpRight,
  GitBranch,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react"
import type { ConversationSummary } from "@/contracts/rpc.generated"
import { rpcCall } from "@/lib/rpc/client"
import { feedbackFromError } from "@/lib/operation-issue"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  buildLineageGraph,
  LINEAGE_NODE_HEIGHT,
  LINEAGE_NODE_WIDTH,
} from "./lineage-graph"
import "./conversation-lineage-canvas.css"

const MIN_SCALE = 0.45
const MAX_SCALE = 1.6

function formatShortTime(iso: string): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function ConversationLineageCanvas({
  sessionId,
  onReturn,
  onOpenConversation,
}: {
  sessionId: string
  onReturn: () => void
  onOpenConversation: (id: string) => void
}) {
  const [conversations, setConversations] = useState<
    readonly ConversationSummary[]
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [selectedId, setSelectedId] = useState(sessionId)

  const viewportRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState({ x: 48, y: 48, scale: 1 })
  const [panning, setPanning] = useState(false)
  const panOrigin = useRef<{
    pointerX: number
    pointerY: number
    startX: number
    startY: number
  } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void rpcCall(
      "conversationList",
      { filter: { archived: "all" } },
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setConversations(result)
          setError(null)
        }
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        setError(feedbackFromError(cause, "未能读取分支关系。").message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [refreshNonce])

  function reload() {
    setLoading(true)
    setError(null)
    setRefreshNonce((n) => n + 1)
  }

  const graph = useMemo(
    () => buildLineageGraph(sessionId, conversations),
    [sessionId, conversations]
  )

  const fitViewport = useCallback(() => {
    if (!graph || !viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const padding = 64
    const availableW = Math.max(120, rect.width - padding * 2)
    const availableH = Math.max(120, rect.height - padding * 2)
    const scale = clamp(
      Math.min(availableW / graph.width, availableH / graph.height, 1),
      MIN_SCALE,
      MAX_SCALE
    )
    const x = Math.round((rect.width - graph.width * scale) / 2)
    const y = Math.round((rect.height - graph.height * scale) / 2)
    setTransform({ x, y, scale })
  }, [graph])

  useLayoutEffect(() => {
    if (!loading && !error) fitViewport()
  }, [error, fitViewport, loading])

  const highlightedAncestors = useMemo(() => {
    if (!graph) return new Set<string>()
    return graph.ancestorsById.get(selectedId) ?? new Set<string>([sessionId])
  }, [graph, selectedId, sessionId])

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest("[data-lineage-node]")) return
    event.currentTarget.setPointerCapture(event.pointerId)
    panOrigin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: transform.x,
      startY: transform.y,
    }
    setPanning(true)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = panOrigin.current
    if (!origin) return
    setTransform((prev) => ({
      ...prev,
      x: origin.startX + (event.clientX - origin.pointerX),
      y: origin.startY + (event.clientY - origin.pointerY),
    }))
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!panOrigin.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    panOrigin.current = null
    setPanning(false)
  }

  function zoomAroundCenter(nextScale: number) {
    const rect = viewportRef.current?.getBoundingClientRect()
    const clamped = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    if (!rect) {
      setTransform((prev) => ({ ...prev, scale: clamped }))
      return
    }
    const cx = rect.width / 2
    const cy = rect.height / 2
    setTransform((prev) => {
      const ratio = clamped / prev.scale
      return {
        x: cx - (cx - prev.x) * ratio,
        y: cy - (cy - prev.y) * ratio,
        scale: clamped,
      }
    })
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const factor = event.deltaY < 0 ? 1.1 : 0.9
    const nextScale = clamp(transform.scale * factor, MIN_SCALE, MAX_SCALE)
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const ratio = nextScale / transform.scale
    setTransform((prev) => ({
      x: pointerX - (pointerX - prev.x) * ratio,
      y: pointerY - (pointerY - prev.y) * ratio,
      scale: nextScale,
    }))
  }

  return (
    <section
      className="lineage-canvas-page"
      aria-label="分支关系画板"
      aria-busy={loading || undefined}
    >
      <header className="lineage-canvas-header">
        <div className="lineage-canvas-header-left">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="返回对话"
                onClick={onReturn}
              >
                <ArrowLeft />
              </Button>
            </TooltipTrigger>
            <TooltipContent>返回对话</TooltipContent>
          </Tooltip>
          <div className="lineage-canvas-title">
            <GitBranch className="size-4 text-muted-foreground" />
            <h1>分支关系</h1>
            {graph && (
              <span className="lineage-canvas-summary">
                {graph.nodes.length} 个会话 · {graph.edges.length} 条派生
              </span>
            )}
          </div>
        </div>
        <div className="lineage-canvas-header-right">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="缩小"
                onClick={() => zoomAroundCenter(transform.scale - 0.15)}
              >
                <Minus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>缩小</TooltipContent>
          </Tooltip>
          <span className="lineage-canvas-zoom">
            {Math.round(transform.scale * 100)}%
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="放大"
                onClick={() => zoomAroundCenter(transform.scale + 0.15)}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>放大</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="适应画布"
                onClick={fitViewport}
              >
                <Maximize2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>适应画布</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="刷新分支关系"
                disabled={loading}
                onClick={reload}
              >
                <RefreshCw className={loading ? "animate-spin" : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {loading && !graph ? (
        <div className="lineage-canvas-state">
          <Spinner aria-label="正在读取分支关系" />
        </div>
      ) : error ? (
        <div className="lineage-canvas-state">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>未能加载分支关系</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reload}
              >
                重试
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : !graph ? (
        <div className="lineage-canvas-state">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>当前会话暂无分支记录</EmptyTitle>
              <EmptyDescription>
                返回对话后，可在任意回复底部点击分支图标创建派生会话。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onReturn}
              >
                返回对话
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <div
          ref={viewportRef}
          className="lineage-canvas-viewport"
          data-panning={panning}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          <div
            className="lineage-canvas-stage"
            style={{
              width: graph.width,
              height: graph.height,
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            }}
          >
            <svg
              className="lineage-canvas-edges"
              width={graph.width}
              height={graph.height}
              aria-hidden="true"
            >
              {graph.edges.map((edge) => {
                const highlighted =
                  highlightedAncestors.has(edge.fromId) &&
                  highlightedAncestors.has(edge.toId)
                return (
                  <path
                    key={edge.id}
                    d={edge.path}
                    className="lineage-edge-path"
                    data-highlighted={highlighted}
                  />
                )
              })}
            </svg>

            {graph.nodes.map((node) => {
              const isCurrent = node.id === sessionId
              const isSelected = node.id === selectedId
              return (
                <div
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  data-lineage-node={node.id}
                  data-current={isCurrent}
                  data-selected={isSelected}
                  data-missing={node.missing || undefined}
                  className="lineage-node-card"
                  style={{
                    left: node.x,
                    top: node.y,
                    width: LINEAGE_NODE_WIDTH,
                    height: LINEAGE_NODE_HEIGHT,
                  }}
                  onClick={() => setSelectedId(node.id)}
                  onDoubleClick={() => {
                    if (!node.missing) onOpenConversation(node.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !node.missing) {
                      onOpenConversation(node.id)
                    }
                  }}
                >
                  <div className="lineage-node-head">
                    <span className="lineage-node-title" title={node.title}>
                      {node.title}
                    </span>
                    {isCurrent && <Badge variant="secondary">当前</Badge>}
                    {node.archived && <Badge variant="outline">已归档</Badge>}
                  </div>
                  <p className="lineage-node-snippet">
                    {node.missing
                      ? "来源会话已不存在"
                      : node.lastMessage.trim() || "暂无消息摘要"}
                  </p>
                  <div className="lineage-node-foot">
                    <span className="lineage-node-model" title={node.modelId}>
                      {node.modelId || formatShortTime(node.updatedAt) || "—"}
                    </span>
                    {!node.missing && !isCurrent && (
                      <button
                        type="button"
                        className="lineage-node-open"
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenConversation(node.id)
                        }}
                      >
                        进入会话
                        <ArrowUpRight className="size-3" />
                      </button>
                    )}
                    {isCurrent && (
                      <span>{formatShortTime(node.updatedAt)}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="lineage-canvas-hint">
            {graph.nodes.length <= 1
              ? "当前会话暂无派生分支 · 在任意回复底部点击分支图标可创建"
              : "拖拽平移 · 滚轮缩放 · 点击节点高亮血缘路径 · 双击或点「进入会话」切换"}
          </div>
        </div>
      )}
    </section>
  )
}
