/**
 * 将 bridge 返回的 raw manifest 适配为可渲染 WorkflowGraphManifest。
 * 布局：有 edges 时按拓扑分层；否则网格。
 */

import type {
  GraphEdge,
  GraphNode,
  WorkflowGraph,
  WorkflowGraphManifest,
} from "./types";

const LAYOUT = {
  NODE_W: 160,
  NODE_H: 48,
  H_GAP: 40,
  V_GAP: 72,
  START_X: 40,
  START_Y: 40,
};

export function adaptManifest(raw: unknown): WorkflowGraphManifest {
  if (!raw || typeof raw !== "object") {
    return { version: "0", workflows: {} };
  }
  const m = raw as Record<string, unknown>;
  const version = String(m.version ?? "1");
  const sourcePath =
    typeof m.sourcePath === "string" ? m.sourcePath : undefined;

  const workflows: Record<string, WorkflowGraph> = {};
  const rawWorkflows = m.workflows;

  if (rawWorkflows && typeof rawWorkflows === "object" && !Array.isArray(rawWorkflows)) {
    for (const [key, value] of Object.entries(
      rawWorkflows as Record<string, unknown>,
    )) {
      const g = adaptOneWorkflow(key, value);
      if (g) workflows[g.workflowId] = g;
    }
  } else if (Array.isArray(rawWorkflows)) {
    rawWorkflows.forEach((value, i) => {
      const g = adaptOneWorkflow(`wf-${i}`, value);
      if (g) workflows[g.workflowId] = g;
    });
  } else if (Array.isArray(m.data)) {
    (m.data as unknown[]).forEach((value, i) => {
      const g = adaptOneWorkflow(`wf-${i}`, value);
      if (g) workflows[g.workflowId] = g;
    });
  }

  return { version, workflows, sourcePath };
}

function adaptOneWorkflow(
  key: string,
  value: unknown,
): WorkflowGraph | null {
  if (typeof value === "string") {
    return {
      workflowId: key,
      workflowName: value,
      filePath: "",
      nodes: layoutNodes([
        {
          id: "start",
          type: "start",
          data: { label: value, nodeKind: "workflow_start" },
        },
      ]),
      edges: [],
    };
  }
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;

  const workflowId = String(o.workflowId ?? o.id ?? key);
  const workflowName = String(
    o.workflowName ?? o.name ?? o.workflowId ?? key,
  );
  const filePath = String(o.filePath ?? o.path ?? o.file ?? "");

  let rawNodes = Array.isArray(o.nodes) ? (o.nodes as unknown[]) : [];
  let rawEdges = Array.isArray(o.edges) ? (o.edges as unknown[]) : [];

  // 部分 manifest 把图嵌在 graph 字段
  if (rawNodes.length === 0 && o.graph && typeof o.graph === "object") {
    const g = o.graph as Record<string, unknown>;
    if (Array.isArray(g.nodes)) rawNodes = g.nodes;
    if (Array.isArray(g.edges)) rawEdges = g.edges;
  }

  // steps map → 简易节点
  if (rawNodes.length === 0 && o.steps && typeof o.steps === "object") {
    const steps = Object.entries(o.steps as Record<string, unknown>);
    rawNodes = [
      {
        id: `${workflowId}-start`,
        type: "start",
        data: { label: "start", nodeKind: "workflow_start" },
      },
      ...steps.map(([stepKey, stepVal], i) => {
        const s =
          stepVal && typeof stepVal === "object"
            ? (stepVal as Record<string, unknown>)
            : {};
        return {
          id: String(s.stepId ?? stepKey ?? `step-${i}`),
          type: "step",
          data: {
            label: String(s.stepName ?? s.name ?? stepKey),
            nodeKind: "step",
            stepId: String(s.stepId ?? stepKey),
          },
        };
      }),
      {
        id: `${workflowId}-end`,
        type: "end",
        data: { label: "end", nodeKind: "workflow_end" },
      },
    ];
    rawEdges = [];
    for (let i = 0; i < rawNodes.length - 1; i++) {
      const a = rawNodes[i] as { id: string };
      const b = rawNodes[i + 1] as { id: string };
      rawEdges.push({
        id: `e-${i}`,
        source: a.id,
        target: b.id,
      });
    }
  }

  const nodesWithoutPos: Omit<GraphNode, "position">[] = rawNodes.map(
    (n, i) => {
      if (!n || typeof n !== "object") {
        return {
          id: `n-${i}`,
          type: "unknown",
          data: { label: String(n), nodeKind: "primitive" },
        };
      }
      const node = n as Record<string, unknown>;
      const data =
        node.data && typeof node.data === "object"
          ? (node.data as Record<string, unknown>)
          : {};
      return {
        id: String(node.id ?? `n-${i}`),
        type: String(node.type ?? "default"),
        data: {
          label: String(data.label ?? node.label ?? node.id ?? `node-${i}`),
          nodeKind: String(data.nodeKind ?? node.nodeKind ?? "step"),
          stepId:
            data.stepId != null
              ? String(data.stepId)
              : node.stepId != null
                ? String(node.stepId)
                : undefined,
        },
      };
    },
  );

  const edges: GraphEdge[] = rawEdges.map((e, i) => {
    if (!e || typeof e !== "object") {
      return { id: `e-${i}`, source: "", target: "" };
    }
    const edge = e as Record<string, unknown>;
    return {
      id: String(edge.id ?? `e-${i}`),
      source: String(edge.source ?? ""),
      target: String(edge.target ?? ""),
      type: edge.type != null ? String(edge.type) : undefined,
      label: edge.label != null ? String(edge.label) : undefined,
    };
  });

  // 若节点已带 position 则保留
  const hasPos = rawNodes.some(
    (n) =>
      n &&
      typeof n === "object" &&
      (n as Record<string, unknown>).position &&
      typeof (n as Record<string, unknown>).position === "object",
  );

  let nodes: GraphNode[];
  if (hasPos) {
    nodes = rawNodes.map((n, i) => {
      const node = (n ?? {}) as Record<string, unknown>;
      const pos = (node.position ?? {}) as { x?: number; y?: number };
      const base = nodesWithoutPos[i]!;
      return {
        ...base,
        position: {
          x: typeof pos.x === "number" ? pos.x : LAYOUT.START_X,
          y: typeof pos.y === "number" ? pos.y : LAYOUT.START_Y + i * LAYOUT.V_GAP,
        },
      };
    });
  } else {
    nodes = layoutNodes(nodesWithoutPos, edges);
  }

  return { workflowId, workflowName, filePath, nodes, edges };
}

function layoutNodes(
  raw: Omit<GraphNode, "position">[],
  edges: GraphEdge[] = [],
): GraphNode[] {
  if (raw.length === 0) return [];

  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    const list = outgoing.get(e.source) ?? [];
    list.push(e.target);
    outgoing.set(e.source, list);
  }

  const start =
    raw.find((n) => n.data.nodeKind === "workflow_start") ?? raw[0]!;
  const layers = new Map<string, number>();
  const visited = new Set<string>();
  const queue = [start.id];
  layers.set(start.id, 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const layer = layers.get(id) ?? 0;
    for (const t of outgoing.get(id) ?? []) {
      if (visited.has(t)) continue;
      const next = layer + 1;
      if (!layers.has(t) || next > (layers.get(t) ?? 0)) {
        layers.set(t, next);
      }
      if (!queue.includes(t)) queue.push(t);
    }
  }

  let maxLayer = 0;
  for (const n of raw) {
    if (!layers.has(n.id)) {
      maxLayer += 1;
      layers.set(n.id, maxLayer);
    } else {
      maxLayer = Math.max(maxLayer, layers.get(n.id)!);
    }
  }

  const byLayer = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    const list = byLayer.get(layer) ?? [];
    list.push(id);
    byLayer.set(layer, list);
  }

  const pos = new Map<string, { x: number; y: number }>();
  for (const [layer, ids] of byLayer) {
    ids.forEach((id, i) => {
      const count = ids.length;
      const totalW =
        count * LAYOUT.NODE_W + (count - 1) * LAYOUT.H_GAP;
      const startX = LAYOUT.START_X + Math.max(0, (800 - totalW) / 4);
      pos.set(id, {
        x: startX + i * (LAYOUT.NODE_W + LAYOUT.H_GAP),
        y: LAYOUT.START_Y + layer * LAYOUT.V_GAP,
      });
    });
  }

  return raw.map((n) => ({
    ...n,
    position: pos.get(n.id) ?? { x: LAYOUT.START_X, y: LAYOUT.START_Y },
  }));
}

/** 从 run 的 workflowName 匹配 manifest 中的图。 */
export function findWorkflowGraph(
  manifest: WorkflowGraphManifest | null,
  workflowName: string | undefined,
): WorkflowGraph | null {
  if (!manifest || !workflowName) return null;
  const name = workflowName.trim();
  if (manifest.workflows[name]) return manifest.workflows[name]!;

  const short = name.includes("//")
    ? name.split("//").filter(Boolean).pop()
    : name.includes("#")
      ? name.split("#").pop()
      : name.split("/").pop();

  for (const wf of Object.values(manifest.workflows)) {
    if (wf.workflowId === name || wf.workflowName === name) return wf;
    if (short && (wf.workflowName === short || wf.workflowName.endsWith(short))) {
      return wf;
    }
    if (short && wf.workflowName.includes(short)) return wf;
  }
  return null;
}
