"use client";

import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * 相对时间展示（对齐上游 RelativeTime 交互；不依赖 date-fns）。
 * type=distance →「3 分钟前」；type=relative → 更口语的相对描述。
 */
export function RelativeTime({
  date,
  className,
  type = "relative",
}: {
  readonly date: Date | string | number;
  readonly className?: string;
  readonly type?: "relative" | "distance";
}) {
  const [, setTick] = useState(0);
  const d = toDate(date);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!d) {
    return <span className={className}>—</span>;
  }

  const label =
    type === "distance" ? formatDistanceZh(d) : formatRelativeZh(d);
  const absolute = d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "cursor-help border-border border-b border-dotted",
            className,
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{absolute}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function toDate(value: Date | string | number): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDistanceZh(date: Date): string {
  const sec = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(sec, "second");
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return rtf.format(min, "minute");
  const hour = Math.round(sec / 3600);
  if (Math.abs(hour) < 48) return rtf.format(hour, "hour");
  const day = Math.round(sec / 86400);
  if (Math.abs(day) < 30) return rtf.format(day, "day");
  const month = Math.round(sec / (86400 * 30));
  if (Math.abs(month) < 12) return rtf.format(month, "month");
  return rtf.format(Math.round(sec / (86400 * 365)), "year");
}

function formatRelativeZh(date: Date): string {
  // 当天/昨天用口语，更远退回 distance
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfThat = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const dayDiff = Math.round((startOfThat - startOfToday) / 86400000);
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (dayDiff === 0) return `今天 ${time}`;
  if (dayDiff === -1) return `昨天 ${time}`;
  if (dayDiff === 1) return `明天 ${time}`;
  return formatDistanceZh(date);
}
