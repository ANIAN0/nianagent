/**
 * 从 World 事件构造 OTEL 风格 Span（移植自 web-shared workflow-traces）。
 */

import {
  isHookLifecycleEventType,
  isTerminalStepEventType,
} from "./event-types";
import { shortName } from "./parse-name";
import { calculateDuration, dateToOtelTime } from "./time-utils";
import type { Span, SpanEvent, WorkflowEvent, WorkflowRunLike } from "./types";

export const WORKFLOW_LIBRARY = {
  name: "workflow-development-kit",
  version: "4.0.0",
};

const MARKER_EVENT_TYPES = new Set([
  "hook_created",
  "hook_received",
  "hook_disposed",
  "step_started",
  "step_retrying",
  "step_failed",
  "run_failed",
  "wait_created",
  "wait_completed",
  "attr_set",
]);

export function getEventTimestamp(
  event: WorkflowEvent | undefined,
): Date | undefined {
  const value = event?.occurredAt ?? event?.createdAt;
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function shouldShowVerticalLine(eventType: string): boolean {
  return isHookLifecycleEventType(eventType);
}

export function convertEventsToSpanEvents(
  events: WorkflowEvent[],
  filterTypes = true,
  options: { preferOccurredAt?: boolean } = {},
): SpanEvent[] {
  return events
    .filter((event) =>
      filterTypes ? MARKER_EVENT_TYPES.has(event.eventType) : true,
    )
    .map((event) => ({
      name: event.eventType,
      timestamp: dateToOtelTime(
        options.preferOccurredAt
          ? (getEventTimestamp(event) ?? event.createdAt)
          : event.createdAt,
      ),
      attributes: {
        eventId: event.eventId,
        correlationId: event.correlationId,
        eventData: "eventData" in event ? event.eventData : undefined,
      },
      showVerticalLine: shouldShowVerticalLine(event.eventType),
    }));
}

export function waitEventsToWaitEntity(events: WorkflowEvent[]) {
  const startEvent = events.find((e) => e.eventType === "wait_created");
  if (!startEvent?.correlationId) return null;
  const completedEvent = events.find((e) => e.eventType === "wait_completed");
  const resumeAtRaw = startEvent.eventData?.resumeAt;
  return {
    waitId: startEvent.correlationId,
    runId: String(startEvent.runId ?? ""),
    createdAt: getEventTimestamp(startEvent) ?? toDate(startEvent.createdAt)!,
    resumeAt: resumeAtRaw ? new Date(String(resumeAtRaw)) : undefined,
    completedAt: getEventTimestamp(completedEvent),
  };
}

export function waitToSpan(
  events: WorkflowEvent[],
  maxEndTime: Date,
  fallbackEndTime = maxEndTime,
): Span | null {
  const wait = waitEventsToWaitEntity(events);
  if (!wait) return null;
  const startTime = wait.createdAt;
  const startMs = startTime.getTime();
  let endTime = wait.completedAt;
  if (!endTime) {
    const fallbackCap =
      wait.resumeAt && wait.resumeAt.getTime() < fallbackEndTime.getTime()
        ? wait.resumeAt
        : fallbackEndTime;
    endTime =
      maxEndTime.getTime() > startMs &&
      maxEndTime.getTime() < fallbackCap.getTime()
        ? maxEndTime
        : fallbackCap;
  }
  return {
    spanId: wait.waitId,
    name: "sleep",
    kind: 1,
    resource: "sleep",
    library: WORKFLOW_LIBRARY,
    status: { code: 0 },
    traceFlags: 1,
    attributes: { resource: "sleep" as const, data: wait },
    links: [],
    events: convertEventsToSpanEvents(events, false),
    duration: calculateDuration(startTime, endTime),
    startTime: dateToOtelTime(startTime),
    endTime: dateToOtelTime(endTime),
  };
}

export function stepEventsToStepEntity(events: WorkflowEvent[]) {
  const createdEvent = events.find((e) => e.eventType === "step_created");
  const anchorEvent = createdEvent ?? events[0];
  if (!anchorEvent) return null;

  let status: "pending" | "running" | "completed" | "failed" | "cancelled" =
    "pending";
  let attempt = 0;
  let startedAt: Date | undefined;
  let completedAt: Date | undefined;

  for (const e of events) {
    switch (e.eventType) {
      case "step_started":
        status = "running";
        attempt += 1;
        if (!startedAt) startedAt = getEventTimestamp(e) ?? toDate(e.createdAt);
        completedAt = undefined;
        break;
      case "step_completed":
        status = "completed";
        completedAt = getEventTimestamp(e) ?? toDate(e.createdAt);
        break;
      case "step_failed":
        status = "failed";
        completedAt = getEventTimestamp(e) ?? toDate(e.createdAt);
        break;
      case "step_retrying":
        status = "pending";
        completedAt = undefined;
        break;
    }
  }
  if (attempt === 0) attempt = 1;
  const lastEvent = events[events.length - 1];

  return {
    stepId: String(anchorEvent.correlationId ?? ""),
    runId: String(anchorEvent.runId ?? ""),
    stepName: String(createdEvent?.eventData?.stepName ?? ""),
    status,
    attempt,
    createdAt: getEventTimestamp(anchorEvent) ?? toDate(anchorEvent.createdAt)!,
    updatedAt:
      getEventTimestamp(lastEvent) ??
      toDate(lastEvent?.createdAt) ??
      toDate(anchorEvent.createdAt)!,
    startedAt,
    completedAt,
    specVersion: anchorEvent.specVersion,
  };
}

export function stepToSpan(
  stepEvents: WorkflowEvent[],
  maxEndTime: Date,
): Span | null {
  const step = stepEventsToStepEntity(stepEvents);
  if (!step) return null;

  const events = convertEventsToSpanEvents(stepEvents, false, {
    preferOccurredAt: true,
  });
  const spanStartEvent =
    stepEvents.find((e) => e.eventType === "step_created") ?? stepEvents[0];
  const spanStartTime =
    getEventTimestamp(spanStartEvent) ?? new Date(step.createdAt);
  let activeStartTime = step.startedAt
    ? new Date(step.startedAt)
    : undefined;
  const firstStartEvent = stepEvents.find((e) => e.eventType === "step_started");
  if (firstStartEvent) {
    activeStartTime =
      getEventTimestamp(firstStartEvent) ??
      toDate(firstStartEvent.createdAt) ??
      undefined;
  }

  let endTime = new Date(maxEndTime);
  if (step.completedAt) {
    const completedEvent = stepEvents
      .slice()
      .reverse()
      .find((e) => isTerminalStepEventType(e.eventType));
    endTime = getEventTimestamp(completedEvent) ?? new Date(step.completedAt);
  }

  return {
    spanId: String(step.stepId),
    name: shortName(String(step.stepName)) || String(step.stepName) || step.stepId,
    kind: 1,
    resource: "step",
    library: WORKFLOW_LIBRARY,
    status: { code: 0 },
    traceFlags: 1,
    attributes: { resource: "step" as const, data: step },
    links: [],
    events,
    startTime: dateToOtelTime(spanStartTime),
    endTime: dateToOtelTime(endTime),
    duration: calculateDuration(spanStartTime, endTime),
    activeStartTime:
      activeStartTime && activeStartTime.getTime() > spanStartTime.getTime()
        ? dateToOtelTime(activeStartTime)
        : undefined,
  };
}

export function hookEventsToHookEntity(events: WorkflowEvent[]) {
  const createdEvent = events.find((e) => e.eventType === "hook_created");
  if (!createdEvent?.correlationId) return null;
  const receivedEvents = events.filter((e) => e.eventType === "hook_received");
  const disposedEvents = events.filter((e) => e.eventType === "hook_disposed");
  const lastReceived = receivedEvents.at(-1);
  return {
    hookId: createdEvent.correlationId,
    runId: String(createdEvent.runId ?? ""),
    token:
      typeof createdEvent.eventData?.token === "string"
        ? createdEvent.eventData.token
        : undefined,
    createdAt:
      getEventTimestamp(createdEvent) ?? toDate(createdEvent.createdAt)!,
    receivedCount: receivedEvents.length,
    lastReceivedAt: getEventTimestamp(lastReceived),
    disposedAt: getEventTimestamp(disposedEvents.at(-1)),
  };
}

export function hookToSpan(
  hookEvents: WorkflowEvent[],
  maxEndTime: Date,
): Span | null {
  const hook = hookEventsToHookEntity(hookEvents);
  if (!hook) return null;
  const endTime = hook.disposedAt || maxEndTime;
  return {
    spanId: String(hook.hookId),
    name: hook.token ?? String(hook.hookId),
    kind: 1,
    resource: "hook",
    library: WORKFLOW_LIBRARY,
    status: { code: 1 },
    traceFlags: 1,
    attributes: { resource: "hook" as const, data: hook },
    links: [],
    events: convertEventsToSpanEvents(hookEvents, false),
    startTime: dateToOtelTime(hook.createdAt),
    endTime: dateToOtelTime(endTime),
    duration: calculateDuration(hook.createdAt, endTime),
  };
}

export function runToSpan(
  run: WorkflowRunLike,
  runEvents: WorkflowEvent[],
  nowTime?: Date,
): Span {
  const now = nowTime ?? new Date();
  const runCreatedEvent = runEvents.find((e) => e.eventType === "run_created");
  const runStartedEvent = runEvents.find((e) => e.eventType === "run_started");
  const terminalEvent = runEvents
    .slice()
    .reverse()
    .find(
      (e) =>
        e.eventType === "run_completed" ||
        e.eventType === "run_failed" ||
        e.eventType === "run_cancelled",
    );
  const spanStartTime =
    getEventTimestamp(runCreatedEvent) ??
    toDate(run.createdAt) ??
    now;
  const activeStartTime =
    getEventTimestamp(runStartedEvent) ??
    (run.startedAt ? toDate(run.startedAt) : undefined);
  const completedAt =
    getEventTimestamp(terminalEvent) ??
    (run.completedAt ? toDate(run.completedAt) : undefined);
  const endTime = completedAt ?? now;

  const { input: _i, output: _o, error: _e, ...runIdentity } = run;
  return {
    spanId: String(run.runId),
    name: shortName(run.workflowName),
    kind: 1,
    resource: "run",
    library: WORKFLOW_LIBRARY,
    status: { code: 0 },
    traceFlags: 1,
    attributes: {
      resource: "run" as const,
      data: {
        ...runIdentity,
        createdAt: spanStartTime,
        startedAt: activeStartTime,
        completedAt,
      },
    },
    links: [],
    events: convertEventsToSpanEvents(runEvents, false, {
      preferOccurredAt: true,
    }),
    startTime: dateToOtelTime(spanStartTime),
    endTime: dateToOtelTime(endTime),
    duration: calculateDuration(spanStartTime, endTime),
    activeStartTime:
      activeStartTime && activeStartTime.getTime() > spanStartTime.getTime()
        ? dateToOtelTime(activeStartTime)
        : undefined,
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
