// 白板阅读器（T12）：React Flow 只读渲染 JSON Canvas 子集。
// 组 = 背景容器（zIndex -1，无父子变换，E3 结论）；text 节点渲染 Handle（否则边不绘制）。
// 点击节点/边建立评论目标（白板只读，无业务点击，无需模式切换）。
import "@xyflow/react/dist/style.css"
import { useEffect, useMemo } from "react"
import {
  Background,
  Handle,
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

function TextNode({ data }: NodeProps) {
  const text = (data as { label?: string }).label ?? ""
  return (
    <div className="relative h-full w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-sm">
      <Handle type="target" position={Position.Top} />
      <p className="nowheel nodrag h-full overflow-auto leading-relaxed break-words whitespace-pre-wrap">
        {text || "（空节点）"}
      </p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function GroupNode({ data }: NodeProps) {
  const label = (data as { label?: string }).label ?? ""
  return (
    <div className="h-full w-full rounded-xl border border-dashed border-primary/30 bg-primary/5">
      {label && (
        <p className="nowheel nodrag max-h-full overflow-auto px-3 pt-2 text-xs font-medium break-words whitespace-pre-wrap text-primary">
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
  // AC12/⑫：受控只读画布——nodes/edges 经 state 持有并应用 onNodesChange，
  // React Flow 的 measured/handle 状态在评论提交等重渲染间保持（不再 visibility:hidden）；
  // 用户节点仍不可拖改（nodesDraggable=false，position 恒由数据决定）。
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
            ...(commented.has(node.id) ? { outline: "2px solid #f59e0b" } : {}),
          },
          data: { label: node.text },
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
          ? { stroke: "#f59e0b", strokeWidth: 2 }
          : undefined,
      }))
    )
  }, [canvas, commented, setNodes, setEdges])
  // AC19-七轮：跳转请求由父层持有（requestId 身份）——请求 pending 且绑定当前画布
  // 版本时定位；对象存在即视口定位并回报 delivered，不存在回报 failed（不冒充定位）
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
      <Background />
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
    <div className="relative h-full min-h-0 min-w-0 flex-1">
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
      <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-neutral-400">
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
