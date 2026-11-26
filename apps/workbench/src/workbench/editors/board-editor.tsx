"use client"

// 白板编辑器（路线 A）：对标 Obsidian Canvas 体验
// - 流畅滚轮缩放与平移（无 nowheel 拦截，minZoom=0.1, maxZoom=4）
// - NodeResizer 拖拽缩放节点与分组尺寸
// - 双击节点/分组就地多行编辑 + 非编辑态 Markdown 渲染
// - 连线标签编辑、全屏编辑（Esc 退出）、撤销/重做（Ctrl+Z / Ctrl+Shift+Z）
import "@xyflow/react/dist/style.css"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  NodeResizer,
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
import {
  Maximize2,
  Minimize2,
  Plus,
  Redo2,
  SquareDashed,
  Trash2,
  Undo2,
} from "lucide-react"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import type { BoardCanvas, BoardEdge, BoardNode } from "../v2-api"
import { CommentMarkdown } from "../comment-markdown"

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

type EditableNodeData = {
  label?: string
  color?: string
  editing?: boolean
  onCommitLabel?: (id: string, value: string) => void
  onStopEdit?: () => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
}

function InlineTextarea({
  initialValue,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  initialValue: string
  ariaLabel: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initialValue)
  return (
    <textarea
      autoFocus
      aria-label={ariaLabel}
      className="nodrag nowheel h-full w-full resize-none bg-transparent text-xs leading-relaxed outline-none"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Escape") {
          event.preventDefault()
          onCancel()
        }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          onCommit(draft)
        }
      }}
    />
  )
}

function InlineInput({
  initialValue,
  ariaLabel,
  color,
  onCommit,
  onCancel,
}: {
  initialValue: string
  ariaLabel: string
  color?: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initialValue)
  return (
    <input
      autoFocus
      aria-label={ariaLabel}
      className="nodrag nowheel w-full bg-transparent px-3 pt-2 text-xs font-medium text-primary outline-none"
      style={color ? { color } : undefined}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Escape") {
          event.preventDefault()
          onCancel()
        }
        if (event.key === "Enter") {
          event.preventDefault()
          onCommit(draft)
        }
      }}
    />
  )
}

function EditableTextNode({ id, data, selected }: NodeProps) {
  const {
    label,
    color,
    editing,
    onCommitLabel,
    onStopEdit,
    onResizeStart,
    onResizeEnd,
  } = data as EditableNodeData
  const hex = color ? resolveHex(color) : undefined

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={64}
        lineClassName="!border-primary"
        handleClassName="!size-2.5 !rounded-xs !border-primary !bg-card"
        onResizeStart={() => onResizeStart?.()}
        onResizeEnd={() => onResizeEnd?.()}
      />
      <div
        className={`relative h-full w-full overflow-hidden rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-sm ${
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
        <Handle
          id="top"
          type="target"
          position={Position.Top}
          className={handleClass}
        />
        <Handle
          id="left"
          type="target"
          position={Position.Left}
          className={handleClass}
        />
        <Handle
          id="right"
          type="source"
          position={Position.Right}
          className={handleClass}
        />
        <Handle
          id="bottom"
          type="source"
          position={Position.Bottom}
          className={handleClass}
        />
        {editing ? (
          <InlineTextarea
            initialValue={label ?? ""}
            ariaLabel="编辑卡片内容"
            onCommit={(value) => {
              onCommitLabel?.(id, value)
              onStopEdit?.()
            }}
            onCancel={() => onStopEdit?.()}
          />
        ) : (
          <div className="h-full overflow-hidden">
            {label ? (
              <CommentMarkdown
                content={label}
                className="text-xs leading-relaxed"
              />
            ) : (
              <p className="text-xs text-muted-foreground">双击输入内容…</p>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function EditableGroupNode({ id, data, selected }: NodeProps) {
  const {
    label,
    color,
    editing,
    onCommitLabel,
    onStopEdit,
    onResizeStart,
    onResizeEnd,
  } = data as EditableNodeData
  const hex = color ? resolveHex(color) : undefined

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={120}
        lineClassName="!border-primary"
        handleClassName="!size-2.5 !rounded-xs !border-primary !bg-card"
        onResizeStart={() => onResizeStart?.()}
        onResizeEnd={() => onResizeEnd?.()}
      />
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
        {editing ? (
          <InlineInput
            initialValue={label ?? ""}
            ariaLabel="编辑分组名称"
            color={hex}
            onCommit={(value) => {
              onCommitLabel?.(id, value)
              onStopEdit?.()
            }}
            onCancel={() => onStopEdit?.()}
          />
        ) : (
          <p
            className="max-h-full overflow-hidden px-3 pt-2 text-xs font-medium break-words whitespace-pre-wrap text-primary"
            style={hex ? { color: hex } : undefined}
          >
            {label || "分组"}
          </p>
        )}
      </div>
    </>
  )
}

const nodeTypes = { text: EditableTextNode, group: EditableGroupNode }

function toFlowNodes(canvas: BoardCanvas): FlowNode[] {
  return canvas.nodes.map((node) => ({
    id: node.id,
    type: node.type === "group" ? "group" : "text",
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
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

type HistorySnapshot = {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

const stripNodeCallbacks = (nodes: FlowNode[]): FlowNode[] =>
  nodes.map((node) => {
    const data = node.data as EditableNodeData
    return {
      ...node,
      data: { label: data.label ?? "", color: data.color ?? "" },
    }
  })

const canvasSignature = (nodes: FlowNode[], edges: FlowEdge[]): string =>
  JSON.stringify({
    nodes: nodes.map((node) => {
      const data = node.data as EditableNodeData
      return {
        id: node.id,
        type: node.type ?? "",
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        w: Math.round(
          node.measured?.width ??
            (typeof node.style?.width === "number"
              ? node.style.width
              : (node.width ?? 0))
        ),
        h: Math.round(
          node.measured?.height ??
            (typeof node.style?.height === "number"
              ? node.style.height
              : (node.height ?? 0))
        ),
        label: data.label ?? "",
        color: data.color ?? "",
      }
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: typeof edge.label === "string" ? edge.label : "",
    })),
  })

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
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [summary, setSummary] = useState("")

  // 撤销/重做历史栈（统一在“一次编辑完成且产生实际变化”时提交一条记录）
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  useLayoutEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges])

  const historyRef = useRef<{
    past: HistorySnapshot[]
    future: HistorySnapshot[]
  }>({ past: [], future: [] })
  const pendingHistoryRef = useRef<{
    snapshot: HistorySnapshot
    signature: string
  } | null>(null)
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 })

  const pushHistory = useCallback(
    (prevNodes: FlowNode[], prevEdges: FlowEdge[]) => {
      const nextPast = [
        ...historyRef.current.past.slice(-39),
        { nodes: stripNodeCallbacks(prevNodes), edges: prevEdges },
      ]
      historyRef.current = { past: nextPast, future: [] }
      setHistoryCounts({ past: nextPast.length, future: 0 })
    },
    []
  )

  const beginHistoryTransaction = useCallback(() => {
    if (pendingHistoryRef.current) return
    pendingHistoryRef.current = {
      snapshot: {
        nodes: stripNodeCallbacks(nodesRef.current),
        edges: edgesRef.current,
      },
      signature: canvasSignature(nodesRef.current, edgesRef.current),
    }
  }, [])

  const commitHistoryTransaction = useCallback(() => {
    const pending = pendingHistoryRef.current
    if (!pending) return
    pendingHistoryRef.current = null
    if (
      canvasSignature(nodesRef.current, edgesRef.current) !== pending.signature
    ) {
      pushHistory(pending.snapshot.nodes, pending.snapshot.edges)
    }
  }, [pushHistory])

  const undo = useCallback(() => {
    commitHistoryTransaction()
    const { past, future } = historyRef.current
    if (past.length === 0) return
    const previous = past[past.length - 1]
    const nextPast = past.slice(0, -1)
    const nextFuture = [
      { nodes: stripNodeCallbacks(nodesRef.current), edges: edgesRef.current },
      ...future.slice(0, 39),
    ]
    historyRef.current = { past: nextPast, future: nextFuture }
    setNodes(previous.nodes)
    setEdges(previous.edges)
    setEditingNodeId(null)
    setHistoryCounts({ past: nextPast.length, future: nextFuture.length })
  }, [commitHistoryTransaction, setNodes, setEdges])

  const redo = useCallback(() => {
    commitHistoryTransaction()
    const { past, future } = historyRef.current
    if (future.length === 0) return
    const next = future[0]
    const nextPast = [
      ...past,
      { nodes: stripNodeCallbacks(nodesRef.current), edges: edgesRef.current },
    ]
    const nextFuture = future.slice(1)
    historyRef.current = { past: nextPast, future: nextFuture }
    setNodes(next.nodes)
    setEdges(next.edges)
    setEditingNodeId(null)
    setHistoryCounts({ past: nextPast.length, future: nextFuture.length })
  }, [commitHistoryTransaction, setNodes, setEdges])

  const commitNodeLabel = useCallback(
    (nodeId: string, label: string) => {
      const target = nodesRef.current.find((node) => node.id === nodeId)
      const currentLabel = (target?.data as EditableNodeData)?.label ?? ""
      if (currentLabel === label) return
      pushHistory(nodesRef.current, edgesRef.current)
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, label } } : node
        )
      )
    },
    [pushHistory, setNodes]
  )

  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          editing: node.id === editingNodeId,
          onCommitLabel: commitNodeLabel,
          onStopEdit: () => setEditingNodeId(null),
          onResizeStart: beginHistoryTransaction,
          onResizeEnd: commitHistoryTransaction,
        },
      })),
    [
      nodes,
      editingNodeId,
      commitNodeLabel,
      beginHistoryTransaction,
      commitHistoryTransaction,
    ]
  )

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  )
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      pushHistory(nodes, edges)
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
    [nodes, edges, pushHistory, setEdges]
  )

  const addNode = (kind: "text" | "group") => {
    pushHistory(nodes, edges)
    const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`
    const offset = (nodes.length % 6) * 28
    const width = kind === "group" ? 320 : 240
    const height = kind === "group" ? 220 : 120
    const next: FlowNode = {
      id,
      type: kind,
      position: { x: 120 + offset, y: 100 + offset },
      width,
      height,
      style: {
        width,
        height,
        zIndex: kind === "group" ? -1 : 0,
      },
      data: { label: kind === "group" ? "新建分组" : "新卡片", color: "" },
    }
    setNodes((prev) => [...prev, next])
    setSelectedNodeId(id)
    setSelectedEdgeId(null)
    setEditingNodeId(id)
  }

  const updateSelectedNode = (patch: { label?: string; color?: string }) => {
    if (!selectedNodeId) return
    const target = nodesRef.current.find((node) => node.id === selectedNodeId)
    const current = (target?.data ?? {}) as EditableNodeData
    if (
      (patch.label === undefined || patch.label === (current.label ?? "")) &&
      (patch.color === undefined || patch.color === (current.color ?? ""))
    ) {
      return
    }
    pushHistory(nodesRef.current, edgesRef.current)
    setNodes((prev) =>
      prev.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, ...patch } }
          : node
      )
    )
  }

  const updateSelectedEdgeLabel = (label: string) => {
    if (!selectedEdgeId) return
    beginHistoryTransaction()
    setEdges((prev) =>
      prev.map((edge) =>
        edge.id === selectedEdgeId
          ? { ...edge, label: label || undefined }
          : edge
      )
    )
  }

  const deleteSelected = useCallback(() => {
    if (!selectedNodeId && !selectedEdgeId) return
    pushHistory(nodes, edges)
    if (selectedNodeId) {
      setNodes((prev) => prev.filter((node) => node.id !== selectedNodeId))
      setEdges((prev) =>
        prev.filter(
          (edge) =>
            edge.source !== selectedNodeId && edge.target !== selectedNodeId
        )
      )
      setSelectedNodeId(null)
      if (editingNodeId === selectedNodeId) setEditingNodeId(null)
    } else if (selectedEdgeId) {
      setEdges((prev) => prev.filter((edge) => edge.id !== selectedEdgeId))
      setSelectedEdgeId(null)
    }
  }, [
    selectedNodeId,
    selectedEdgeId,
    editingNodeId,
    nodes,
    edges,
    pushHistory,
    setNodes,
    setEdges,
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      if (event.key === "Escape" && fullscreen && !typing) {
        setFullscreen(false)
        return
      }
      if (typing) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedNodeId || selectedEdgeId) {
          event.preventDefault()
          deleteSelected()
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [fullscreen, undo, redo, deleteSelected, selectedNodeId, selectedEdgeId])

  const handleSave = () => {
    const nextNodes: BoardNode[] = nodes.map((node) => ({
      id: node.id,
      type: node.type === "group" ? "group" : "text",
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      width: Math.round(
        Number(node.measured?.width ?? node.width ?? node.style?.width ?? 220)
      ),
      height: Math.round(
        Number(
          node.measured?.height ?? node.height ?? node.style?.height ?? 100
        )
      ),
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

  const canUndo = historyCounts.past > 0
  const canRedo = historyCounts.future > 0

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-40 flex flex-col bg-background"
          : "flex min-h-0 flex-1 flex-col bg-background"
      }
    >
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="撤销"
          title="撤销 (Ctrl+Z)"
          disabled={saving || !canUndo}
          onClick={undo}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="重做"
          title="重做 (Ctrl+Shift+Z)"
          disabled={saving || !canRedo}
          onClick={redo}
        >
          <Redo2 className="size-4" />
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
            variant="outline"
            size="sm"
            aria-label={fullscreen ? "退出全屏" : "全屏编辑"}
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
            value={String(
              (selectedNode.data as { label?: string }).label ?? ""
            )}
            onChange={(event) =>
              updateSelectedNode({ label: event.target.value })
            }
          />
          <div className="flex items-center gap-1.5">
            {COLOR_OPTIONS.map((option) => {
              const active =
                String(
                  (selectedNode.data as { color?: string }).color ?? ""
                ) === option.value
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
          <span className="ml-auto text-[11px] text-muted-foreground">
            双击节点可多行编辑（支持 Markdown），拖动边角调整大小
          </span>
        </div>
      )}

      {selectedEdge && !selectedNode && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs">
          <span className="font-medium text-muted-foreground">连线标签</span>
          <Input
            aria-label="连线标签"
            placeholder="输入连线说明…"
            className="h-7 max-w-xs text-xs"
            value={
              typeof selectedEdge.label === "string" ? selectedEdge.label : ""
            }
            onFocus={beginHistoryTransaction}
            onChange={(event) => updateSelectedEdgeLabel(event.target.value)}
            onBlur={commitHistoryTransaction}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                commitHistoryTransaction()
                event.currentTarget.blur()
              }
            }}
          />
        </div>
      )}

      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <ReactFlow
            nodes={renderedNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={beginHistoryTransaction}
            onNodeDragStop={commitHistoryTransaction}
            nodeTypes={nodeTypes}
            minZoom={0.1}
            maxZoom={4}
            zoomOnScroll={true}
            zoomOnPinch={true}
            zoomOnDoubleClick={false}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id)
              setSelectedEdgeId(null)
            }}
            onNodeDoubleClick={(_, node) => {
              setSelectedNodeId(node.id)
              setSelectedEdgeId(null)
              setEditingNodeId(node.id)
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id)
              setSelectedNodeId(null)
              setEditingNodeId(null)
            }}
            onPaneClick={() => {
              setSelectedNodeId(null)
              setSelectedEdgeId(null)
              setEditingNodeId(null)
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
