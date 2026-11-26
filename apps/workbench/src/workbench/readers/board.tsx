"use client"

// 白板阅读器（路线 A）：React Flow 只读渲染 JSON Canvas 1.0 子集
// - 移除节点/分组上的 nowheel 拦截，实现任意位置流畅滚轮缩放与拖拽平移
// - 支持 Markdown 卡片渲染、全屏沉浸查看（Esc 退出）
// - 点击节点/连线先选中并显示确认操作条，点击「添加评论」再弹评论框，避免误触
import "@xyflow/react/dist/style.css"
import { useEffect, useMemo, useState } from "react"
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
} from "@xyflow/react"
import { Maximize2, MessageSquare, Minimize2, X } from "lucide-react"
import { Button } from "@/ui/button"
import type { ReaderProps } from "../reader-registry"
import type { BoardCanvas } from "../v2-api"
import { CommentMarkdown } from "../comment-markdown"

// JSON Canvas 1.0 预设色（1=红 2=橙 3=黄 4=绿 5=青 6=紫）及自定义十六进制色支持
const CANVAS_PRESET_COLORS: Record<string, string> = {
  "1": "#ef4444",
  "2": "#f97316",
  "3": "#eab308",
  "4": "#22c55e",
  "5": "#06b6d4",
  "6": "#a855f7",
}

function resolveCanvasColor(color?: string): string | undefined {
  if (!color) return undefined
  if (CANVAS_PRESET_COLORS[color]) return CANVAS_PRESET_COLORS[color]
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color
  return undefined
}

const hiddenHandleClass =
  "!size-1.5 !border-0 !bg-transparent !opacity-0 !pointer-events-none"

function TextNode({ data, selected }: NodeProps) {
  const { label, color } = data as { label?: string; color?: string }
  const resolved = resolveCanvasColor(color)
  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-shadow ${
        selected ? "ring-2 ring-primary" : ""
      }`}
      style={
        resolved
          ? {
              borderColor: resolved,
              backgroundColor: `color-mix(in srgb, ${resolved} 10%, var(--card))`,
            }
          : undefined
      }
    >
      <Handle
        id="top"
        type="target"
        position={Position.Top}
        className={hiddenHandleClass}
      />
      <Handle
        id="left"
        type="target"
        position={Position.Left}
        className={hiddenHandleClass}
      />
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className={hiddenHandleClass}
      />
      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        className={hiddenHandleClass}
      />
      <div className="h-full overflow-hidden">
        {label ? (
          <CommentMarkdown content={label} className="text-xs leading-relaxed" />
        ) : (
          <p className="text-xs text-muted-foreground">（空节点）</p>
        )}
      </div>
    </div>
  )
}

function GroupNode({ data, selected }: NodeProps) {
  const { label, color } = data as { label?: string; color?: string }
  const resolved = resolveCanvasColor(color)
  return (
    <div
      className={`h-full w-full rounded-xl border border-dashed border-primary/35 bg-primary/5 ${
        selected ? "ring-2 ring-primary" : ""
      }`}
      style={
        resolved
          ? {
              borderColor: `color-mix(in srgb, ${resolved} 55%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${resolved} 8%, transparent)`,
            }
          : undefined
      }
    >
      {label && (
        <p
          className="max-h-full overflow-hidden px-3 pt-2 text-xs font-medium break-words whitespace-pre-wrap text-primary"
          style={resolved ? { color: resolved } : undefined}
        >
          {label}
        </p>
      )}
    </div>
  )
}

const nodeTypes = { text: TextNode, group: GroupNode }

type SelectedBoardObject = {
  objectId: string
  objectType: "node" | "edge" | "group"
  title: string
}

function BoardFlow({
  canvas,
  commented,
  onSelectObject,
  focusRequest,
  onReport,
  canvasVersionId,
  fullscreen,
}: {
  canvas: BoardCanvas
  commented: Set<string>
  onSelectObject: (selected: SelectedBoardObject | null) => void
  focusRequest?: ReaderProps["focusRequest"]
  onReport?: (
    requestId: string,
    outcome: "delivered" | "failed",
    message?: string
  ) => void
  canvasVersionId: string
  fullscreen: boolean
}) {
  const flow = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([])
  useEffect(() => {
    setNodes((current) =>
      canvas.nodes.map((node) => {
        const prev = current.find((item) => item.id === node.id)
        return {
          id: node.id,
          type: node.type === "group" ? "group" : "text",
          position: { x: node.x, y: node.y },
          style: {
            width: node.width,
            height: node.height,
            border: "none",
            padding: 0,
            background: "transparent",
            zIndex: node.type === "group" ? -1 : 0,
            ...(commented.has(node.id)
              ? { outline: "2px solid var(--status-warning)" }
              : {}),
          },
          data: { label: node.text, color: node.color },
          measured: prev?.measured,
        }
      })
    )
    setEdges(
      canvas.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        style: commented.has(edge.id)
          ? { stroke: "var(--status-warning)", strokeWidth: 2 }
          : undefined,
      }))
    )
  }, [canvas, commented, setNodes, setEdges])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void flow.fitView({ duration: 200, padding: 0.16 })
    })
    return () => cancelAnimationFrame(id)
  }, [fullscreen, flow])

  useEffect(() => {
    if (
      !focusRequest ||
      focusRequest.status !== "pending" ||
      focusRequest.versionId !== canvasVersionId
    )
      return
    if (!focusRequest.target.objectId) return
    const objectId = focusRequest.target.objectId
    const node = canvas.nodes.find((item) => item.id === objectId)
    const edge = canvas.edges.find((item) => item.id === objectId)
    if (node) {
      flow.setCenter(node.x + node.width / 2, node.y + node.height / 2, {
        zoom: 1.1,
        duration: 300,
      })
      onReport?.(focusRequest.requestId, "delivered")
    } else if (edge) {
      const source = canvas.nodes.find((item) => item.id === edge.from)
      const target = canvas.nodes.find((item) => item.id === edge.to)
      if (source && target)
        flow.setCenter(
          (source.x + target.x + source.width / 2 + target.width / 2) / 2,
          (source.y + target.y + source.height / 2 + target.height / 2) / 2,
          { zoom: 1.1, duration: 300 }
        )
      onReport?.(focusRequest.requestId, "delivered")
    } else {
      onReport?.(
        focusRequest.requestId,
        "failed",
        "定位对象在该版本画布中不存在，无法定位。"
      )
    }
  }, [focusRequest, canvas, canvasVersionId, flow, onReport])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      deleteKeyCode={null}
      elementsSelectable={true}
      minZoom={0.1}
      maxZoom={4}
      zoomOnScroll={true}
      zoomOnPinch={true}
      zoomOnDoubleClick={false}
      panOnDrag={true}
      fitView
      fitViewOptions={{ padding: 0.16 }}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => {
        const target = canvas.nodes.find((item) => item.id === node.id)
        const objectType = target?.type === "group" ? "group" : "node"
        onSelectObject({
          objectId: node.id,
          objectType,
          title: boardAnchorTitle(node.id, objectType, target?.text ?? ""),
        })
      }}
      onEdgeClick={(_, edge) => {
        const target = canvas.edges.find((item) => item.id === edge.id)
        onSelectObject({
          objectId: edge.id,
          objectType: "edge",
          title: boardAnchorTitle(edge.id, "edge", target?.label ?? ""),
        })
      }}
      onPaneClick={() => onSelectObject(null)}
    >
      <Background gap={20} size={1} color="var(--border)" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) =>
          resolveCanvasColor((node.data as { color?: string })?.color) ||
          "var(--muted-foreground)"
        }
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      />
    </ReactFlow>
  )
}

export function BoardReader({
  version,
  threads,
  onTargetSelect,
  focusRequest,
  onReport,
}: ReaderProps) {
  const canvas: BoardCanvas = version.canvas ?? { nodes: [], edges: [] }
  const [fullscreen, setFullscreen] = useState(false)
  const [selected, setSelected] = useState<SelectedBoardObject | null>(null)

  const commented = useMemo(() => {
    const ids = new Set<string>()
    for (const thread of threads) {
      const anchor = thread.anchor
      if (anchor.kind === "board" && "objectId" in anchor)
        ids.add(anchor.objectId)
    }
    return ids
  }, [threads])

  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [fullscreen])

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-40 flex flex-col bg-background"
          : "relative h-full min-h-0 min-w-0 flex-1 bg-background"
      }
    >
      <ReactFlowProvider>
        <BoardFlow
          canvas={canvas}
          commented={commented}
          onSelectObject={setSelected}
          focusRequest={focusRequest}
          onReport={onReport}
          canvasVersionId={version.versionId}
          fullscreen={fullscreen}
        />
      </ReactFlowProvider>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-card/90 shadow-xs backdrop-blur-xs"
          aria-label={fullscreen ? "退出全屏" : "全屏查看白板"}
          onClick={() => setFullscreen((value) => !value)}
        >
          {fullscreen ? (
            <>
              <Minimize2 data-icon="inline-start" />
              退出全屏
            </>
          ) : (
            <>
              <Maximize2 data-icon="inline-start" />
              全屏
            </>
          )}
        </Button>
      </div>
      {selected && onTargetSelect && (
        <div
          role="toolbar"
          aria-label="白板对象操作"
          className="absolute bottom-4 left-1/2 z-10 flex max-w-[min(460px,calc(100%-32px))] -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover/95 px-3 py-1.5 shadow-lg backdrop-blur-xs"
        >
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {selected.title}
          </span>
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 px-2.5 text-xs"
            onClick={() => {
              onTargetSelect({
                kind: "board",
                objectId: selected.objectId,
                objectType: selected.objectType,
              })
              setSelected(null)
            }}
          >
            <MessageSquare className="size-3.5" />
            添加评论
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="取消选中"
            onClick={() => setSelected(null)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

/** board 定位引文展示（讨论面板/比较侧）。 */
export const boardAnchorTitle = (
  objectId: string,
  objectType: string,
  quote: string
) =>
  `${objectType === "edge" ? "连线" : objectType === "group" ? "分组" : "节点"} ${quote || objectId.slice(0, 8)}`
