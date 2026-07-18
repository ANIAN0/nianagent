/** 工作流图类型（对齐上游 workflow-graph-types 子集）。 */

export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    nodeKind: string;
    stepId?: string;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
}

export interface WorkflowGraph {
  workflowId: string;
  workflowName: string;
  filePath: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface WorkflowGraphManifest {
  version: string;
  workflows: Record<string, WorkflowGraph>;
  sourcePath?: string;
}

export type NodeExecStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "unknown";
