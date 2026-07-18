"use client";

import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "../i18n/zh-CN";

/** 表格多选浮动条（移植上游 SelectionBar）。 */
export function SelectionBar({
  selectionCount,
  onClearSelection,
  actions,
  className,
}: {
  readonly selectionCount: number;
  readonly onClearSelection: () => void;
  readonly actions?: ReactNode;
  readonly className?: string;
}) {
  if (selectionCount === 0) return null;

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg bg-primary px-4 py-2.5 text-primary-foreground shadow-md",
        className,
      )}
      role="toolbar"
      aria-label={t("selectionCount").replace("{n}", String(selectionCount))}
    >
      <span className="font-medium text-sm">
        {t("selectionCount").replace("{n}", String(selectionCount))}
      </span>
      {actions ? (
        <div className="flex items-center gap-2 border-primary-foreground/20 border-s pl-3">
          {actions}
        </div>
      ) : null}
      <Button
        aria-label={t("clearSelection")}
        className="h-7 px-2 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        onClick={onClearSelection}
        size="sm"
        type="button"
        variant="ghost"
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}
