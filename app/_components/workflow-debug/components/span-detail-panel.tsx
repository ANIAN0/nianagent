"use client";

/**
 * Span 侧栏详情：属性 / 可展开事件 / 原始 JSON，均带复制。
 */

import { useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CopyableJsonBlock,
  CopyableText,
} from "../display-utils/copyable-text";
import { RelativeTime } from "../display-utils/relative-time";
import { t } from "../i18n/zh-CN";
import {
  formatDurationFromOtel,
  otelTimeToMs,
} from "../trace/time-utils";
import type { Span, SpanEvent, WorkflowEvent } from "../trace/types";
import { filterSpanRawEvents } from "../trace/trace-builder";
import { StatusBadge } from "./status-badge";
import { cn } from "@/lib/utils";

const RESOURCE_LABEL: Record<string, string> = {
  run: "运行",
  step: "步骤",
  hook: "Hook",
  sleep: "Sleep",
};

export function SpanDetailPanel({
  span,
  allEvents,
  onClose,
}: {
  readonly span: Span | null;
  readonly allEvents: readonly WorkflowEvent[];
  readonly onClose: () => void;
}) {
  if (!span) {
    return (
      <aside className="hidden w-80 shrink-0 flex-col rounded-lg border bg-card lg:flex">
        <div className="flex h-11 items-center border-b px-3">
          <h3 className="font-medium text-sm">{t("sidePanel")}</h3>
        </div>
        <div className="flex flex-1 flex-col items-start justify-center gap-1 p-4">
          <p className="text-foreground text-sm">{t("noSelection")}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            在左侧时间线点击一个 Span 查看属性、事件与原始数据。
          </p>
        </div>
      </aside>
    );
  }

  const resource =
    (span.attributes.resource as string | undefined) ?? span.resource;
  const data = span.attributes.data as Record<string, unknown> | undefined;
  const startMs = otelTimeToMs(span.startTime);
  const endMs = otelTimeToMs(span.endTime);
  const rawEvents = filterSpanRawEvents(
    allEvents as WorkflowEvent[],
    resource,
    span.spanId,
  );
  const statusFromData =
    data && typeof data.status === "string" ? data.status : "";

  return (
    <aside className="flex w-full shrink-0 flex-col rounded-lg border bg-card lg:w-80">
      <div className="flex h-11 items-center justify-between border-b px-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-sm">{span.name}</h3>
          <p className="text-muted-foreground text-[11px]">
            {RESOURCE_LABEL[resource] ?? resource}
          </p>
        </div>
        <Button
          aria-label={t("closePanel")}
          className="h-8 w-8 shrink-0"
          onClick={onClose}
          size="icon"
          type="button"
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 text-xs">
        <section className="space-y-2">
          <h4 className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
            {t("traceAttributes")}
          </h4>
          <Row label={t("traceSpanId")}>
            <CopyableText alwaysShowCopy text={span.spanId}>
              <span className="break-all font-mono text-left">
                {span.spanId}
              </span>
            </CopyableText>
          </Row>
          <Row label={t("colStatus")}>
            {statusFromData ? (
              <StatusBadge status={statusFromData} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          <Row label={t("traceDuration")}>
            {formatDurationFromOtel(span.duration)}
          </Row>
          <Row label={t("colStarted")}>
            <RelativeTime date={startMs} />
          </Row>
          <Row label={t("colCompleted")}>
            <RelativeTime date={endMs} />
          </Row>
          {data && typeof data.attempt === "number" ? (
            <Row label={t("traceAttempt")}>{String(data.attempt)}</Row>
          ) : null}
          {data && typeof data.token === "string" ? (
            <Row label={t("colToken")}>
              <CopyableText alwaysShowCopy text={data.token}>
                <span className="break-all font-mono">{data.token}</span>
              </CopyableText>
            </Row>
          ) : null}
          {data && typeof data.stepName === "string" && data.stepName ? (
            <Row label={t("traceStepName")}>
              <CopyableText alwaysShowCopy text={data.stepName}>
                <span className="break-all font-mono">{data.stepName}</span>
              </CopyableText>
            </Row>
          ) : null}
        </section>

        <section className="space-y-2">
          <h4 className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
            {t("traceSpanEvents")}（{span.events.length}）
          </h4>
          {span.events.length === 0 ? (
            <p className="text-muted-foreground">{t("emptyEvents")}</p>
          ) : (
            <ul className="space-y-1">
              {span.events.map((ev, i) => (
                <ExpandableSpanEvent
                  event={ev}
                  key={`${ev.name}-${i}-${otelTimeToMs(ev.timestamp)}`}
                />
              ))}
            </ul>
          )}
        </section>

        {rawEvents.length > 0 ? (
          <section className="space-y-2">
            <h4 className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
              {t("traceRawEvents")}（{rawEvents.length}）
            </h4>
            <ul className="max-h-72 space-y-1 overflow-auto">
              {rawEvents.map((ev, i) => (
                <ExpandableRawEvent
                  event={ev}
                  key={String(ev.eventId ?? i)}
                />
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-1">
          <h4 className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
            {t("rawJson")}
          </h4>
          <CopyableJsonBlock
            maxHeightClass="max-h-64"
            value={{ span, attributes: span.attributes, data }}
          />
        </section>
      </div>
    </aside>
  );
}

function ExpandableSpanEvent({ event }: { readonly event: SpanEvent }) {
  const [open, setOpen] = useState(false);
  const eventId =
    event.attributes?.eventId != null
      ? String(event.attributes.eventId)
      : "";

  return (
    <li className="rounded border">
      <div className="flex items-start gap-1 px-2 py-1.5">
        <button
          aria-expanded={open}
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {open ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          )}
        </button>
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          <span className="font-mono text-[11px]">{event.name}</span>
          <div className="text-[10px] text-muted-foreground">
            <RelativeTime date={otelTimeToMs(event.timestamp)} />
          </div>
        </button>
        {eventId ? (
          <CopyableText alwaysShowCopy text={eventId}>
            <span className="max-w-[5rem] truncate font-mono text-[10px] text-muted-foreground">
              id
            </span>
          </CopyableText>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-1 border-t px-2 py-1.5">
          {eventId ? (
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-muted-foreground">eventId</span>
              <CopyableText alwaysShowCopy text={eventId} />
            </div>
          ) : null}
          <CopyableJsonBlock maxHeightClass="max-h-40" value={event} />
        </div>
      ) : null}
    </li>
  );
}

function ExpandableRawEvent({ event }: { readonly event: WorkflowEvent }) {
  const [open, setOpen] = useState(false);
  const eventId = event.eventId ? String(event.eventId) : "";

  return (
    <li className="rounded border">
      <div className="flex items-start gap-1 px-2 py-1.5">
        <button
          aria-expanded={open}
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {open ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          )}
        </button>
        <button
          className="min-w-0 flex-1 truncate text-left font-mono text-[10px]"
          onClick={() => setOpen((v) => !v)}
          title={eventId}
          type="button"
        >
          <span>{event.eventType}</span>
          {eventId ? (
            <span className="text-muted-foreground"> · {eventId}</span>
          ) : null}
        </button>
        {eventId ? <CopyableText alwaysShowCopy text={eventId} /> : null}
      </div>
      {open ? (
        <div className="border-t px-2 py-1.5">
          <CopyableJsonBlock maxHeightClass="max-h-48" value={event} />
        </div>
      ) : null}
    </li>
  );
}

function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-2", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}
