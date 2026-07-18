"use client";

import { cn } from "@/lib/utils";

export type SectionTabItem = {
  readonly id: string;
  readonly label: string;
};

/**
 * 分区标签：与聊天 Agent 切换器同一套 segment 样式，
 * 避免 debug 壳层用「半截边框 tab」造成风格漂移。
 */
export function SectionTabs({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  readonly items: readonly SectionTabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly ariaLabel: string;
  readonly className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg bg-muted/80 p-0.5 ring-1 ring-border/60",
        className,
      )}
      role="tablist"
    >
      {items.map((item) => {
        const selected = value === item.id;
        return (
          <button
            aria-selected={selected}
            className={cn(
              "inline-flex h-8 items-center rounded-md px-3 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              selected
                ? "bg-background font-medium text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            id={`section-tab-${item.id}`}
            key={item.id}
            onClick={() => onChange(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
