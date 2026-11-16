// @ts-check
// 白板 ContentKind/Reader（T11）：JSON Canvas 1.0 明确子集（text/group 节点 + edge）。
// - 导入校验：恰一个根级 .canvas；子集外类型（file/link/image 等）明确拒绝
// - 派生：校验后的画布随包封存为 .moon/reading.json（管线版本固定，历史阅读不重新解释）
// - diff：对象按 id 匹配（同 id 移动不新建对象），五分类 added/removed/content/connection/layout
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { WorkbenchError } from "../errors.mjs"

export const BOARD_PIPELINE_VERSION = 1

const FINITE = (value) => typeof value === "number" && Number.isFinite(value)
const ID = (value) =>
  typeof value === "string" && value.length >= 1 && value.length <= 128

/** 校验 JSON Canvas 子集；返回规范化 {nodes, edges}（节点顺序稳定：输入序）。 */
export function parseCanvas(raw) {
  let canvas
  try {
    canvas = JSON.parse(raw)
  } catch (error) {
    throw new WorkbenchError(
      "unsupported_artifact",
      `画布文件不是有效 JSON：${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!canvas || typeof canvas !== "object" || Array.isArray(canvas))
    throw new WorkbenchError("unsupported_artifact", "画布结构无效。")
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : []
  const edges = Array.isArray(canvas.edges) ? canvas.edges : []
  if (nodes.length === 0)
    throw new WorkbenchError("unsupported_artifact", "画布没有节点。")
  const nodeIds = new Set()
  for (const node of nodes) {
    if (!node || typeof node !== "object")
      throw new WorkbenchError("unsupported_artifact", "节点结构无效。")
    if (!ID(node.id))
      throw new WorkbenchError(
        "unsupported_artifact",
        `节点 id 无效：${JSON.stringify(node.id)?.slice(0, 40)}`
      )
    if (nodeIds.has(node.id))
      throw new WorkbenchError(
        "unsupported_artifact",
        `节点 id 重复：${node.id}`
      )
    nodeIds.add(node.id)
    if (node.type !== undefined && !["text", "group"].includes(node.type))
      throw new WorkbenchError(
        "unsupported_artifact",
        `不支持的节点类型：${node.type}（子集仅 text/group）`
      )
    if (
      !FINITE(node.x) ||
      !FINITE(node.y) ||
      !FINITE(node.width) ||
      !FINITE(node.height)
    )
      throw new WorkbenchError(
        "unsupported_artifact",
        `节点几何无效（需有限数值）：${node.id}`
      )
    if (node.type !== "group" && typeof node.text !== "string")
      throw new WorkbenchError(
        "unsupported_artifact",
        `text 节点缺少文本：${node.id}`
      )
    if (typeof node.text === "string" && node.text.length > 2000)
      throw new WorkbenchError(
        "limit_exceeded",
        `节点文本超过 2000 字符：${node.id}`
      )
    // AC08：JSON Canvas 组的标准标签为 label；导入映射到内部 text（读回保留）
    if (
      node.type === "group" &&
      node.label !== undefined &&
      typeof node.label !== "string"
    )
      throw new WorkbenchError("unsupported_artifact", `组标签无效：${node.id}`)
    if (typeof node.label === "string" && node.label.length > 2000)
      throw new WorkbenchError(
        "limit_exceeded",
        `组标签超过 2000 字符：${node.id}`
      )
  }
  const edgeIds = new Set()
  const resolvedEdges = []
  for (const edge of edges) {
    if (!edge || typeof edge !== "object")
      throw new WorkbenchError("unsupported_artifact", "连线结构无效。")
    if (!ID(edge.id))
      throw new WorkbenchError(
        "unsupported_artifact",
        `连线 id 无效：${JSON.stringify(edge.id)?.slice(0, 40)}`
      )
    if (edgeIds.has(edge.id) || nodeIds.has(edge.id))
      throw new WorkbenchError(
        "unsupported_artifact",
        `画布对象 id 重复：${edge.id}`
      )
    edgeIds.add(edge.id)
    // AC08-二轮：校验与规范化必须同一来源——此前只改校验、edges.map 仍读 edge.from/to，
    // 标准包导入后端点丢失（read_version 边只剩 id/label）。标准端点在此一并映射。
    const from = edge.fromNode ?? edge.from
    const to = edge.toNode ?? edge.to
    if (!ID(from) || !ID(to) || !nodeIds.has(from) || !nodeIds.has(to))
      throw new WorkbenchError(
        "unsupported_artifact",
        `连线端点无效或不存在：${edge.id}`
      )
    if (typeof edge.label === "string" && edge.label.length > 2000)
      throw new WorkbenchError(
        "limit_exceeded",
        `连线标签超过 2000 字符：${edge.id}`
      )
    resolvedEdges.push({
      id: edge.id,
      from,
      to,
      label: typeof edge.label === "string" ? edge.label : undefined,
    })
  }
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type === "group" ? "group" : "text",
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      text:
        node.type === "group"
          ? typeof node.label === "string"
            ? node.label
            : typeof node.text === "string"
              ? node.text
              : ""
          : node.text,
      color: typeof node.color === "string" ? node.color : undefined,
    })),
    edges: resolvedEdges,
  }
}

const nodeLabel = (node) =>
  node.type === "group" ? node.text || node.id : node.text || node.id
const edgeLabel = (edge) => edge.label || `${edge.from} → ${edge.to}`

/** 组归属唯一规则：节点完全包含于组几何内才归属；相交不算（E3 结论）。 */
export function groupMembership(canvas) {
  const groups = canvas.nodes.filter((node) => node.type === "group")
  const membership = new Map()
  for (const node of canvas.nodes) {
    if (node.type === "group") continue
    const containing = groups.filter(
      (group) =>
        node.x >= group.x &&
        node.y >= group.y &&
        node.x + node.width <= group.x + group.width &&
        node.y + node.height <= group.y + group.height
    )
    if (containing.length === 0) continue
    // 嵌套组取面积最小的最内层
    const innermost = containing.sort(
      (left, right) => left.width * left.height - right.width * right.height
    )[0]
    membership.set(node.id, innermost.id)
  }
  return membership
}

/** 定位目标：节点/连线（含组归属上下文）。 */
export function boardTargets(canvas) {
  const membership = groupMembership(canvas)
  const nodeById = new Map(canvas.nodes.map((node) => [node.id, node]))
  const items = []
  for (const node of canvas.nodes) {
    const group = membership.get(node.id)
    items.push({
      objectId: node.id,
      objectType: node.type,
      text: nodeLabel(node),
      context: group
        ? { group: group, groupText: nodeById.get(group)?.text ?? "" }
        : {},
    })
  }
  for (const edge of canvas.edges) {
    items.push({
      objectId: edge.id,
      objectType: "edge",
      text: edgeLabel(edge),
      context: { from: edge.from, to: edge.to },
    })
  }
  return items
}

/** 两版画布对象 diff：added/removed/content/connection/layout 五类（T11/A5）。 */
export function diffCanvas(leftCanvas, rightCanvas) {
  const leftById = new Map(leftCanvas.nodes.map((node) => [node.id, node]))
  const rightById = new Map(rightCanvas.nodes.map((node) => [node.id, node]))
  const leftEdgeById = new Map(leftCanvas.edges.map((edge) => [edge.id, edge]))
  const rightEdgeById = new Map(
    rightCanvas.edges.map((edge) => [edge.id, edge])
  )
  const added = rightCanvas.nodes
    .filter((node) => !leftById.has(node.id))
    .map((node) => ({
      id: node.id,
      objectType: node.type,
      text: nodeLabel(node),
      after: node,
    }))
  const removed = leftCanvas.nodes
    .filter((node) => !rightById.has(node.id))
    .map((node) => ({
      id: node.id,
      objectType: node.type,
      text: nodeLabel(node),
      before: node,
    }))
  const contentChanged = []
  const layoutChanged = []
  for (const [id, right] of rightById) {
    const left = leftById.get(id)
    if (!left) continue
    const geometryChanged =
      left.x !== right.x ||
      left.y !== right.y ||
      left.width !== right.width ||
      left.height !== right.height
    const textChanged = left.text !== right.text || left.color !== right.color
    if (textChanged)
      contentChanged.push({
        id,
        objectType: right.type,
        text: nodeLabel(right),
        before: { text: left.text },
        after: { text: right.text },
      })
    if (geometryChanged)
      layoutChanged.push({
        id,
        objectType: right.type,
        text: nodeLabel(right),
        before: {
          x: left.x,
          y: left.y,
          width: left.width,
          height: left.height,
        },
        after: {
          x: right.x,
          y: right.y,
          width: right.width,
          height: right.height,
        },
      })
  }
  const addedEdges = rightCanvas.edges
    .filter((edge) => !leftEdgeById.has(edge.id))
    .map((edge) => ({
      id: edge.id,
      objectType: "edge",
      text: edgeLabel(edge),
      after: edge,
    }))
  const removedEdges = leftCanvas.edges
    .filter((edge) => !rightEdgeById.has(edge.id))
    .map((edge) => ({
      id: edge.id,
      objectType: "edge",
      text: edgeLabel(edge),
      before: edge,
    }))
  const connectionChanged = []
  for (const [id, right] of rightEdgeById) {
    const left = leftEdgeById.get(id)
    if (!left) continue
    if (
      left.from !== right.from ||
      left.to !== right.to ||
      left.label !== right.label
    )
      connectionChanged.push({
        id,
        objectType: "edge",
        text: edgeLabel(right),
        before: { from: left.from, to: left.to, label: left.label },
        after: { from: right.from, to: right.to, label: right.label },
      })
  }
  return {
    added: [...added, ...addedEdges],
    removed: [...removed, ...removedEdges],
    contentChanged,
    connectionChanged,
    layoutChanged,
  }
}

export const boardReader = {
  /** board 包必须恰有一个根级 .canvas 画布文件。 */
  validateEntries(entries) {
    const names = entries
      .filter(
        (entry) =>
          !entry.path.includes("/") &&
          entry.path.toLowerCase().endsWith(".canvas")
      )
      .map((entry) => entry.path)
    if (names.length === 0)
      throw new WorkbenchError(
        "validation_failed",
        "board 包缺少根级 .canvas 画布文件。"
      )
    if (names.length > 1)
      throw new WorkbenchError(
        "validation_failed",
        `画布入口不唯一（${names.join("、")}）。`
      )
  },
  /** 封存前派生：解析并校验子集，规范化画布写入 .moon/reading.json。 */
  async derive(stagingDir) {
    const names = (await readdirRoot(stagingDir)).filter((name) =>
      name.toLowerCase().endsWith(".canvas")
    )
    if (names.length !== 1)
      throw new WorkbenchError(
        "validation_failed",
        "board 正文入口不唯一或缺失。"
      )
    const entry = names[0]
    const canvas = parseCanvas(await readFile(join(stagingDir, entry), "utf8"))
    await mkdir(join(stagingDir, ".moon"), { recursive: true })
    const reading = {
      pipeline: BOARD_PIPELINE_VERSION,
      kind: "board",
      entry,
      canvas,
    }
    await writeFile(
      join(stagingDir, ".moon", "reading.json"),
      JSON.stringify(reading)
    )
    return { entry: ".moon/reading.json", reading }
  },
}

async function readdirRoot(dir) {
  const { readdir } = await import("node:fs/promises")
  return readdir(dir)
}
