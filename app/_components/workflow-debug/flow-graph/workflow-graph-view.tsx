"use client";

/**
 * SVG 工作流图 + 可选执行状态叠加。
 */

import { useMemo } from "react";
import type { GraphNode, NodeExecStatus, WorkflowGraph } from "./types";
import { cn } from "@/lib/utils";

const NODE_W = 150;
const NODE_H = 44;

const STATUS_FILL: Record<NodeExecStatus, string> = {
  pending: "var(--muted)",
  running: "color-mix(in oklab, var(--color-blue-500) 25%, var(--background))",
  completed:
    "color-mix(in oklab, var(--color-emerald-500) 22%, var(--background))",
  failed: "color-mix(in oklab, var(--color-red-500) 22%, var(--background))",
  skipped: "var(--background)",
  unknown: "var(--background)",
};

const STATUS_STROKE: Record<NodeExecStatus, string> = {
  pending: "var(--border)",
  running: "var(--color-blue-500)",
  completed: "var(--color-emerald-600)",
  failed: "var(--color-red-500)",
  skipped: "var(--border)",
  unknown: "var(--border)",
};

export function WorkflowGraphView({
  workflow,
  execStatus,
  className,
}: {
  readonly workflow: WorkflowGraph;
  readonly execStatus?: ReadonlyMap<string, NodeExecStatus>;
  readonly className?: string;
}) {
  const { width, height, nodes, edges } = useMemo(() => {
    const nodes = workflow.nodes;
    const edges = workflow.edges.filter((e) => e.source && e.target);
    let maxX = 400;
    let maxY = 200;
    for (const n of nodes) {
      maxX = Math.max(maxX, n.position.x + NODE_W + 40);
      maxY = Math.max(maxY, n.position.y + NODE_H + 40);
    }
    return { width: maxX, height: maxY, nodes, edges };
  }, [workflow]);

  const byId = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  if (nodes.length === 0) {
    return (
      <p className="p-4 text-muted-foreground text-sm">无图节点</p>
    );
  }

  return (
    <div className={cn("h-full w-full overflow-auto rounded-lg border bg-muted/20", className)}>
      <svg
        aria-label={workflow.workflowName}
        className="min-h-full min-w-full"
        height={height}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <defs>
          <marker
            id="wf-arrow"
            markerHeight="6"
            markerWidth="6"
            orient="auto"
            refX="5"
            refY="3"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" opacity={0.45} />
          </marker>
        </defs>

        {edges.map((e) => {
          const s = byId.get(e.source);
          const t = byId.get(e.target);
          if (!s || !t) return null;
          const x1 = s.position.x + NODE_W / 2;
          const y1 = s.position.y + NODE_H;
          const x2 = t.position.x + NODE_W / 2;
          const y2 = t.position.y;
          const midY = (y1 + y2) / 2;
          return (
            <g key={e.id}>
              <path
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                markerEnd="url(#wf-arrow)"
                opacity={0.5}
                stroke="currentColor"
                strokeWidth={1.5}
              />
              {e.label ? (
                <text
                  className="fill-muted-foreground text-[9px]"
                  textAnchor="middle"
                  x={(x1 + x2) / 2}
                  y={midY}
                >
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {nodes.map((n) => {
          const key =
            n.data.stepId ??
            n.id;
          const status: NodeExecStatus =
            execStatus?.get(key) ??
            execStatus?.get(n.id) ??
            "unknown";
          return (
            <g key={n.id} transform={`translate(${n.position.x},${n.position.y})`}>
              <rect
                fill={STATUS_FILL[status]}
                height={NODE_H}
                rx={8}
                stroke={STATUS_STROKE[status]}
                strokeWidth={status === "running" ? 2 : 1}
                width={NODE_W}
              />
              <text
                className="fill-foreground text-[10px]"
                x={10}
                y={18}
              >
                {truncate(n.data.nodeKind, 16)}
              </text>
              <text
                className="fill-foreground font-medium text-[11px]"
                x={10}
                y={34}
              >
                {truncate(n.data.label, 18)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
