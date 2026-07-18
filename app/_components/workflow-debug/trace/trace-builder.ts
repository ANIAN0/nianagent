/**
 * 由 WorkflowRun + Events 构建完整 Trace（移植自 web-shared trace-builder）。
 */

import {
  isHookLifecycleEventType,
  isStepEventType,
  isWaitEventType,
} from "./event-types";
import {
  getEventTimestamp,
  hookToSpan,
  runToSpan,
  stepToSpan,
  waitToSpan,
  WORKFLOW_LIBRARY,
} from "./span-construction";
import { otelTimeToMs } from "./time-utils";
import type {
  Span,
  TraceWithMeta,
  WorkflowEvent,
  WorkflowRunLike,
} from "./types";

/** 归属于 run 根 span 的事件（无 correlation，或非 step/timer/hook）。 */
export function isRunLevelEvent(event: WorkflowEvent): boolean {
  return (
    !event.correlationId ||
    (!isWaitEventType(event.eventType) &&
      !isHookLifecycleEventType(event.eventType) &&
      !isStepEventType(event.eventType))
  );
}

export function filterSpanRawEvents(
  events: WorkflowEvent[],
  resource: string | undefined,
  spanId: string | undefined,
): WorkflowEvent[] {
  if (resource === "run") return events.filter(isRunLevelEvent);
  if (!spanId) return [];
  return events.filter((e) => e.correlationId === spanId);
}

export type GroupedEvents = {
  eventsByStepId: Map<string, WorkflowEvent[]>;
  runLevelEvents: WorkflowEvent[];
  timerEvents: Map<string, WorkflowEvent[]>;
  hookEvents: Map<string, WorkflowEvent[]>;
};

function pushEvent(
  map: Map<string, WorkflowEvent[]>,
  correlationId: string,
  event: WorkflowEvent,
) {
  const existing = map.get(correlationId);
  if (existing) {
    existing.push(event);
    return;
  }
  map.set(correlationId, [event]);
}

export function groupEventsByCorrelation(
  events: WorkflowEvent[],
): GroupedEvents {
  const eventsByStepId = new Map<string, WorkflowEvent[]>();
  const runLevelEvents: WorkflowEvent[] = [];
  const timerEvents = new Map<string, WorkflowEvent[]>();
  const hookEvents = new Map<string, WorkflowEvent[]>();

  for (const event of events) {
    const correlationId = event.correlationId;
    if (!correlationId) {
      runLevelEvents.push(event);
      continue;
    }
    if (isWaitEventType(event.eventType)) {
      pushEvent(timerEvents, correlationId, event);
      continue;
    }
    if (isHookLifecycleEventType(event.eventType)) {
      pushEvent(hookEvents, correlationId, event);
      continue;
    }
    if (isStepEventType(event.eventType)) {
      pushEvent(eventsByStepId, correlationId, event);
      continue;
    }
    runLevelEvents.push(event);
  }

  return { eventsByStepId, runLevelEvents, timerEvents, hookEvents };
}

function computeLatestKnownTime(
  events: WorkflowEvent[],
  run: WorkflowRunLike,
): Date {
  let latest = (toDate(run.createdAt) ?? new Date()).getTime();
  for (const event of events) {
    const t = (
      getEventTimestamp(event) ??
      toDate(event.createdAt) ??
      new Date(0)
    ).getTime();
    if (t > latest) latest = t;
  }
  return new Date(latest);
}

function buildSpans(
  run: WorkflowRunLike,
  groupedEvents: GroupedEvents,
  now: Date,
  latestKnownTime: Date,
) {
  const childMaxEnd = latestKnownTime;
  const runMaxEnd = toDate(run.completedAt) ?? now;

  const stepSpans = Array.from(groupedEvents.eventsByStepId.values())
    .map((evs) => stepToSpan(evs, childMaxEnd))
    .filter((s): s is Span => s !== null);

  const hookSpans = Array.from(groupedEvents.hookEvents.values())
    .map((evs) => hookToSpan(evs, childMaxEnd))
    .filter((s): s is Span => s !== null);

  const waitSpans = Array.from(groupedEvents.timerEvents.values())
    .map((evs) => waitToSpan(evs, childMaxEnd, runMaxEnd))
    .filter((s): s is Span => s !== null);

  return {
    runSpan: runToSpan(run, groupedEvents.runLevelEvents, now),
    spans: [...stepSpans, ...hookSpans, ...waitSpans],
  };
}

function cascadeSpans(runSpan: Span, spans: Span[]): Span[] {
  const sortedSpans = [
    runSpan,
    ...spans.slice().sort((a, b) => {
      return otelTimeToMs(a.startTime) - otelTimeToMs(b.startTime);
    }),
  ];
  return sortedSpans.map((span, index) => ({
    ...span,
    parentSpanId:
      index === 0 ? undefined : String(sortedSpans[index - 1]!.spanId),
  }));
}

export function buildTrace(
  run: WorkflowRunLike,
  events: WorkflowEvent[],
  now: Date,
): TraceWithMeta {
  const groupedEvents = groupEventsByCorrelation(events);
  const latestKnownTime = computeLatestKnownTime(events, run);
  const { runSpan, spans } = buildSpans(
    run,
    groupedEvents,
    now,
    latestKnownTime,
  );
  const sortedCascadingSpans = cascadeSpans(runSpan, spans);
  const traceStartMs = otelTimeToMs(runSpan.startTime);
  const knownDurationMs = latestKnownTime.getTime() - traceStartMs;

  return {
    traceId: run.runId,
    rootSpanId: run.runId,
    spans: sortedCascadingSpans,
    resources: [
      {
        name: "workflow",
        attributes: { "service.name": WORKFLOW_LIBRARY.name },
      },
    ],
    knownDurationMs: Math.max(0, knownDurationMs),
  };
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}
