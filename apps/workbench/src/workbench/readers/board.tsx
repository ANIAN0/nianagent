"use client"

// 白板阅读器（T12）：React Flow 只读渲染 JSON Canvas 子集（含 node.color、四向连接桩、缩放控制与小地图）。
// 组 = 背景容器（zIndex -1，无父子变换，E3 结论）；点击节点/边建立评论目标。
import "@xyflow/react/dist/style.css"
import { useEffect, useMemo } from "react"
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
import type { ReaderProps } from "../reader-registry"
import type { BoardCanvas } from "../v2-api"

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

function TextNode({ data }: NodeProps) {
  const { label, color } = data as { label?: string; color?: string }
  const resolved = resolveCanvasColor(color)
  return (
    <div
      className="relative h-full w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-sm"
      style={
        resolved
          ? {
              borderColor: resolved,
              backgroundColor: `color-mix(in srgb, ${resolved} 10%, var(--card))`,
            }
          : undefined
      }
    >
      <Handle id="top" type="target" position={Position.Top} className={hiddenHandleClass} />
      <Handle id="left" type="target" position={Position.Left} className={hiddenHandleClass} />
      <Handle id="right" type="source" position={Position.Right} className={hiddenHandleClass} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={hiddenHandleClass} />
      <p className="nowheel nodrag h-full overflow-auto leading-relaxed break-words whitespace-pre-wrap">
        {label || "（空节点）"}
      </p>
    </div>
  )
}

function GroupNode({ data }: NodeProps) {
  const { label, color } = data as { label?: string; color?: string }
  const resolved = resolveCanvasColor(color)
  return (
    <div
      className="h-full w-full rounded-xl border border-dashed border-primary/35 bg-primary/5"
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
          className="nowheel nodrag max-h-full overflow-auto px-3 pt-2 text-xs font-medium break-words whitespace-pre-wrap text-primary"
          style={resolved ? { color: resolved } : undefined}
        >
          {label}
        </p>
      )}
    </div>
  )
}

const nodeTypes = { text: TextNode, group: GroupNode }

function BoardFlow({
  canvas,
  commented,
  onTargetSelect,
  focusRequest,
  onReport,
  canvasVersionId,
}: {
  canvas: BoardCanvas
  commented: Set<string>
  onTargetSelect?: (target: Record<string, unknown>) => void
  focusRequest?: ReaderProps["focusRequest"]
  onReport?: (
    requestId: string,
    outcome: "delivered" | "failed",
    message?: string
  ) => void
  canvasVersionId: string
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
      fitView
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => {
        const target = canvas.nodes.find((item) => item.id === node.id)
        onTargetSelect?.({
          kind: "board",
          objectId: node.id,
          objectType: target?.type === "group" ? "group" : "node",
        })
      }}
      onEdgeClick={(_, edge) => {
        onTargetSelect?.({
          kind: "board",
          objectId: edge.id,
          objectType: "edge",
        })
      }}
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
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
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
  const commented = useMemo(() => {
    const ids = new Set<string>()
    for (const thread of threads) {
      const anchor = thread.anchor
      if (anchor.kind === "board" && "objectId" in anchor)
        ids.add(anchor.objectId)
    }
    return ids
  }, [threads])

  return (
    <div className="relative h-full min-h-0 min-w-0 flex-1 bg-background">
      <ReactFlowProvider>
        <BoardFlow
          canvas={canvas}
          commented={commented}
          onTargetSelect={onTargetSelect}
          focusRequest={focusRequest}
          onReport={onReport}
          canvasVersionId={version.versionId}
        />
      </ReactFlowProvider>
      <p className="pointer-events-none absolute top-2.5 left-3 rounded-md border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground shadow-xs backdrop-blur-xs">
        点击节点或连线可评论；拖动平移，滚轮缩放
      </p>
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
