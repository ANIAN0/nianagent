import type { ConversationSummary } from "@/contracts/rpc.generated"

export const LINEAGE_NODE_WIDTH = 264
export const LINEAGE_NODE_HEIGHT = 124
const LAYER_GAP_X = 88
const SIBLING_GAP_Y = 24

export interface LineageGraphNode {
  id: string
  title: string
  lastMessage: string
  cwd: string
  modelId: string
  updatedAt: string
  archived: boolean
  status: ConversationSummary["status"]
  missing?: boolean
  parentId?: string
  depth: number
  x: number
  y: number
}

export interface LineageGraphEdge {
  id: string
  fromId: string
  toId: string
  path: string
}

export interface LineageGraph {
  rootId: string
  nodes: LineageGraphNode[]
  edges: LineageGraphEdge[]
  width: number
  height: number
  ancestorsById: Map<string, Set<string>>
}

function buildMissingParent(id: string, title: string): ConversationSummary {
  return {
    id,
    title: title || "原会话已不可用",
    cwd: "",
    workspaceId: "",
    createdAt: "",
    updatedAt: "",
    status: "idle",
    unread: false,
    revision: 0,
    modelId: "",
    thinking: "",
    pinned: false,
    archived: false,
    lastMessage: "",
    lastError: "",
    runId: "",
  }
}

/**
 * Computes a left-to-right tree layout for the conversation lineage family
 * containing `currentSessionId`.
 */
export function buildLineageGraph(
  currentSessionId: string,
  conversations: readonly ConversationSummary[]
): LineageGraph | null {
  const byId = new Map<string, ConversationSummary>()
  for (const item of conversations) {
    byId.set(item.id, item)
  }

  const current = byId.get(currentSessionId)
  if (!current) return null

  // Walk upward to the root ancestor while guarding against cycles.
  const visitedUp = new Set<string>([currentSessionId])
  let rootId = currentSessionId
  let cursor: ConversationSummary | undefined = current
  const virtualParents = new Map<string, ConversationSummary>()

  while (cursor?.lineage?.sourceSessionId) {
    const parentId = cursor.lineage.sourceSessionId
    if (visitedUp.has(parentId)) break
    visitedUp.add(parentId)
    rootId = parentId
    const parent = byId.get(parentId)
    if (parent) {
      cursor = parent
    } else {
      virtualParents.set(
        parentId,
        buildMissingParent(parentId, cursor.lineage.sourceTitle)
      )
      break
    }
  }

  const allNodes = new Map<string, ConversationSummary>(byId)
  for (const [id, node] of virtualParents) {
    allNodes.set(id, node)
  }

  const childrenByParent = new Map<string, string[]>()
  for (const item of allNodes.values()) {
    const parentId = item.lineage?.sourceSessionId
    if (!parentId || parentId === item.id) continue
    const list = childrenByParent.get(parentId) ?? []
    list.push(item.id)
    childrenByParent.set(parentId, list)
  }

  // Sort siblings deterministically by creation time, then title.
  for (const ids of childrenByParent.values()) {
    ids.sort((a, b) => {
      const left = allNodes.get(a)
      const right = allNodes.get(b)
      const timeCompare = (left?.createdAt ?? "").localeCompare(
        right?.createdAt ?? ""
      )
      if (timeCompare !== 0) return timeCompare
      return (left?.title ?? "").localeCompare(right?.title ?? "")
    })
  }

  // Build tree structure from rootId downward.
  const treeIds = new Set<string>()
  const childMap = new Map<string, string[]>()
  const parentMap = new Map<string, string>()
  const depthMap = new Map<string, number>()

  function collect(id: string, depth: number) {
    if (treeIds.has(id)) return
    treeIds.add(id)
    depthMap.set(id, depth)
    const rawChildren = childrenByParent.get(id) ?? []
    const validChildren: string[] = []
    for (const childId of rawChildren) {
      if (!treeIds.has(childId)) {
        validChildren.push(childId)
        parentMap.set(childId, id)
        collect(childId, depth + 1)
      }
    }
    childMap.set(id, validChildren)
  }

  collect(rootId, 0)

  // Compute leaf-slot vertical layout so parents center over their children.
  const unitHeight = LINEAGE_NODE_HEIGHT + SIBLING_GAP_Y
  const yCenterMap = new Map<string, number>()
  let nextLeafIndex = 0

  function assignY(id: string): number {
    const children = childMap.get(id) ?? []
    if (children.length === 0) {
      const center = nextLeafIndex * unitHeight + LINEAGE_NODE_HEIGHT / 2
      nextLeafIndex += 1
      yCenterMap.set(id, center)
      return center
    }
    const childCenters = children.map(assignY)
    const center = (childCenters[0] + childCenters[childCenters.length - 1]) / 2
    yCenterMap.set(id, center)
    return center
  }

  assignY(rootId)

  const nodes: LineageGraphNode[] = []
  const nodeById = new Map<string, LineageGraphNode>()
  let maxRight = LINEAGE_NODE_WIDTH
  let maxBottom = LINEAGE_NODE_HEIGHT

  for (const id of treeIds) {
    const item = allNodes.get(id)
    if (!item) continue
    const depth = depthMap.get(id) ?? 0
    const x = depth * (LINEAGE_NODE_WIDTH + LAYER_GAP_X)
    const y =
      (yCenterMap.get(id) ?? LINEAGE_NODE_HEIGHT / 2) - LINEAGE_NODE_HEIGHT / 2
    maxRight = Math.max(maxRight, x + LINEAGE_NODE_WIDTH)
    maxBottom = Math.max(maxBottom, y + LINEAGE_NODE_HEIGHT)

    const node: LineageGraphNode = {
      id,
      title: item.title.trim() || "新会话",
      lastMessage: item.lastMessage,
      cwd: item.cwd,
      modelId: item.modelId,
      updatedAt: item.updatedAt,
      archived: item.archived,
      status: item.status,
      missing: virtualParents.has(id),
      parentId: parentMap.get(id),
      depth,
      x,
      y,
    }
    nodes.push(node)
    nodeById.set(id, node)
  }

  const edges: LineageGraphEdge[] = []
  for (const node of nodes) {
    if (!node.parentId) continue
    const parent = nodeById.get(node.parentId)
    if (!parent) continue
    const x1 = parent.x + LINEAGE_NODE_WIDTH
    const y1 = parent.y + LINEAGE_NODE_HEIGHT / 2
    const x2 = node.x
    const y2 = node.y + LINEAGE_NODE_HEIGHT / 2
    const dx = Math.max(36, (x2 - x1) * 0.5)
    edges.push({
      id: `${parent.id}->${node.id}`,
      fromId: parent.id,
      toId: node.id,
      path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    })
  }

  const ancestorsById = new Map<string, Set<string>>()
  for (const node of nodes) {
    const ancestors = new Set<string>()
    let walk: string | undefined = node.id
    while (walk && !ancestors.has(walk)) {
      ancestors.add(walk)
      walk = parentMap.get(walk)
    }
    ancestorsById.set(node.id, ancestors)
  }

  return {
    rootId,
    nodes,
    edges,
    width: maxRight,
    height: maxBottom,
    ancestorsById,
  }
}
