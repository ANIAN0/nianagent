"use client"

import "@xyflow/react/dist/style.css"
import { useCallback, useMemo, useState } from "react"
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
} from "@xyflow/react"
import { Plus, SquareDashed, Trash2 } from "lucide-react"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import type { BoardCanvas, BoardEdge, BoardNode } from "../v2-api"

const COLOR_OPTIONS: { value: string; label: string; hex: string }[] = [
  { value: "", label: "默认", hex: "var(--border)" },
  { value: "1", label: "红", hex: "#ef4444" },
  { value: "2", label: "橙", hex: "#f97316" },
  { value: "3", label: "黄", hex: "#eab308" },
  { value: "4", label: "绿", hex: "#22c55e" },
  { value: "5", label: "青", hex: "#06b6d4" },
  { value: "6", label: "紫", hex: "#a855f7" },
]

function resolveHex(color?: string) {
  return COLOR_OPTIONS.find((item) => item.value === color)?.hex
}

const handleClass = "!size-2.5 !border-2 !border-card !bg-primary"

function EditableTextNode({ data, selected }: NodeProps) {
  const { label, color } = data as { label?: string; color?: string }
  const hex = color ? resolveHex(color) : undefined
  return (
    <div
      className={`relative h-full w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-sm ${
        selected ? "ring-2 ring-primary" : ""
      }`}
      style={
        hex
          ? {
              borderColor: hex,
              backgroundColor: `color-mix(in srgb, ${hex} 10%, var(--card))`,
            }
          : undefined
      }
    >
      <Handle id="top" type="target" position={Position.Top} className={handleClass} />
      <Handle id="left" type="target" position={Position.Left} className={handleClass} />
      <Handle id="right" type="source" position={Position.Right} className={handleClass} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={handleClass} />
      <p className="nowheel h-full overflow-auto leading-relaxed break-words whitespace-pre-wrap">
        {label || "（空节点）"}
      </p>
    </div>
  )
}

function EditableGroupNode({ data, selected }: NodeProps) {
  const { label, color } = data as { label?: string; color?: string }
  const hex = color ? resolveHex(color) : undefined
  return (
    <div
      className={`h-full w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 ${
        selected ? "ring-2 ring-primary" : ""
      }`}
      style={
        hex
          ? {
              borderColor: `color-mix(in srgb, ${hex} 60%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${hex} 8%, transparent)`,
            }
          : undefined
      }
    >
      <p
        className="nowheel max-h-full overflow-auto px-3 pt-2 text-xs font-medium break-words whitespace-pre-wrap text-primary"
        style={hex ? { color: hex } : undefined}
      >
        {label || "分组"}
      </p>
    </div>
  )
}

const nodeTypes = { text: EditableTextNode, group: EditableGroupNode }

function toFlowNodes(canvas: BoardCanvas): FlowNode[] {
  return canvas.nodes.map((node) => ({
    id: node.id,
    type: node.type === "group" ? "group" : "text",
    position: { x: node.x, y: node.y },
    style: {
      width: node.width,
      height: node.height,
      zIndex: node.type === "group" ? -1 : 0,
    },
    data: { label: node.text, color: node.color ?? "" },
  }))
}

function toFlowEdges(canvas: BoardCanvas): FlowEdge[] {
  return canvas.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.label,
  }))
}

export function BoardEditor({
  initialCanvas,
  saving,
  onSave,
  onCancel,
}: {
  initialCanvas: BoardCanvas
  saving: boolean
  onSave: (canvas: BoardCanvas, summary: string) => Promise<void>
  onCancel: () => void
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
    toFlowNodes(initialCanvas)
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(
    toFlowEdges(initialCanvas)
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [summary, setSummary] = useState("")

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `edge-${crypto.randomUUID().slice(0, 8)}`,
          },
          eds
        )
      )
    },
    [setEdges]
  )

  const addNode = (kind: "text" | "group") => {
    const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`
    const offset = (nodes.length % 6) * 28
    const next: FlowNode = {
      id,
      type: kind,
      position: { x: 120 + offset, y: 100 + offset },
      style: {
        width: kind === "group" ? 320 : 220,
        height: kind === "group" ? 220 : 100,
        zIndex: kind === "group" ? -1 : 0,
      },
      data: { label: kind === "group" ? "新建分组" : "新卡片", color: "" },
    }
    setNodes((prev) => [...prev, next])
    setSelectedNodeId(id)
    setSelectedEdgeId(null)
  }

  const updateSelectedNode = (patch: { label?: string; color?: string }) => {
    if (!selectedNodeId) return
    setNodes((prev) =>
      prev.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, ...patch } }
          : node
      )
    )
  }

  const deleteSelected = () => {
    if (selectedNodeId) {
      setNodes((prev) => prev.filter((node) => node.id !== selectedNodeId))
      setEdges((prev) =>
        prev.filter(
          (edge) =>
            edge.source !== selectedNodeId && edge.target !== selectedNodeId
        )
      )
      setSelectedNodeId(null)
    } else if (selectedEdgeId) {
      setEdges((prev) => prev.filter((edge) => edge.id !== selectedEdgeId))
      setSelectedEdgeId(null)
    }
  }

  const handleSave = () => {
    const nextNodes: BoardNode[] = nodes.map((node) => ({
      id: node.id,
      type: node.type === "group" ? "group" : "text",
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      width: Number(node.style?.width ?? node.measured?.width ?? 220),
      height: Number(node.style?.height ?? node.measured?.height ?? 100),
      text: String((node.data as { label?: string }).label ?? ""),
      color: String((node.data as { color?: string }).color ?? "") || undefined,
    }))
    const nextEdges: BoardEdge[] = edges.map((edge) => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      label: typeof edge.label === "string" ? edge.label : undefined,
    }))
    void onSave({ nodes: nextNodes, edges: nextEdges }, summary.trim())
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => addNode("text")}
        >
          <Plus />
          添加卡片
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => addNode("group")}
        >
          <SquareDashed />
          添加分组
        </Button>
        {(selectedNodeId || selectedEdgeId) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={saving}
            onClick={deleteSelected}
          >
            <Trash2 />
            删除选中
          </Button>
        )}
        <Input
          aria-label="版本说明"
          placeholder="版本说明（可选）…"
          className="h-7 max-w-52 text-xs"
          value={summary}
          disabled={saving}
          onChange={(event) => setSummary(event.target.value)}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || nodes.length === 0}
            onClick={handleSave}
          >
            {saving ? "发布中…" : "发布新版本"}
          </Button>
        </div>
      </div>

      {selectedNode && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs">
          <span className="font-medium text-muted-foreground">
            {selectedNode.type === "group" ? "分组" : "卡片"}属性
          </span>
          <Input
            aria-label="节点文本"
            className="h-7 max-w-sm text-xs"
            value={String((selectedNode.data as { label?: string }).label ?? "")}
            onChange={(event) =>
              updateSelectedNode({ label: event.target.value })
            }
          />
          <div className="flex items-center gap-1.5">
            {COLOR_OPTIONS.map((option) => {
              const active =
                String((selectedNode.data as { color?: string }).color ?? "") ===
                option.value
              return (
                <button
                  key={option.label}
                  type="button"
                  title={option.label}
                  aria-label={`颜色 ${option.label}`}
                  className={`size-5 rounded-full border transition-transform ${
                    active ? "scale-110 ring-2 ring-primary ring-offset-1" : ""
                  }`}
                  style={{ backgroundColor: option.hex }}
                  onClick={() => updateSelectedNode({ color: option.value })}
                />
              )
            })}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id)
              setSelectedEdgeId(null)
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id)
              setSelectedNodeId(null)
            }}
            onPaneClick={() => {
              setSelectedNodeId(null)
              setSelectedEdgeId(null)
            }}
          >
            <Background gap={20} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              style={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
              }}
            />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  )
}
