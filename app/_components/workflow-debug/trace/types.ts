/** Trace/Span 类型（对齐上游 web-shared trace-viewer/types 子集）。 */

export type OtelTime = [number, number];

export interface SpanEvent {
  name: string;
  timestamp: OtelTime;
  attributes: Record<string, unknown>;
  showVerticalLine?: boolean;
}

export interface Span {
  name: string;
  kind: number;
  resource: string;
  library: { name: string; version?: string };
  spanId: string;
  parentSpanId?: string;
  status: { code: number };
  traceFlags: number;
  attributes: Record<string, unknown>;
  links: Record<string, unknown>[];
  events: SpanEvent[];
  startTime: OtelTime;
  endTime: OtelTime;
  duration: OtelTime;
  /** 真正开始执行时间；若晚于 startTime 则中间为排队段 */
  activeStartTime?: OtelTime;
}

export interface TraceWithMeta {
  traceId: string;
  rootSpanId: string;
  spans: Span[];
  resources: { name: string; attributes: Record<string, string> }[];
  /** 从 trace 起点到最新已知事件的毫秒数 */
  knownDurationMs: number;
}

/** World 事件的宽松形状（RPC 反序列化后）。 */
export type WorkflowEvent = {
  eventId?: string;
  eventType: string;
  runId?: string;
  correlationId?: string;
  createdAt?: string | number | Date;
  occurredAt?: string | number | Date;
  eventData?: Record<string, unknown>;
  specVersion?: number;
  [key: string]: unknown;
};

/** World 运行的宽松形状。 */
export type WorkflowRunLike = {
  runId: string;
  workflowName?: string;
  status?: string;
  createdAt?: string | number | Date;
  startedAt?: string | number | Date;
  completedAt?: string | number | Date;
  expiredAt?: string | number | Date;
  executionContext?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  [key: string]: unknown;
};
