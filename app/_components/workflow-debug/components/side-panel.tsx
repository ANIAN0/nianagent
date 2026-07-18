"use client";

import type { ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "../i18n/zh-CN";
import { cn } from "@/lib/utils";

export function SidePanel({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** 图浏览等场景加宽侧栏 */
  readonly wide?: boolean;
}) {
  // 关闭时完全收起：禁止半透明占位（易误认为可交互灰态）
  if (!open) {
    return null;
  }

  return (
    <aside
      aria-label={title}
      className={cn(
        "flex w-full shrink-0 flex-col rounded-lg border bg-card lg:flex",
        wide ? "lg:w-[min(36rem,42vw)]" : "lg:w-80",
      )}
    >
      <div className="flex h-11 items-center justify-between border-b px-3">
        <h3 className="font-medium text-sm">{title}</h3>
        <Button
          aria-label={t("closePanel")}
          className="h-8 w-8"
          onClick={onClose}
          size="icon"
          type="button"
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </aside>
  );
}
