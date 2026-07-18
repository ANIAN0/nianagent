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
  return (
    <aside
      aria-hidden={!open}
      className={cn(
        "hidden shrink-0 flex-col rounded-lg border bg-card lg:flex",
        wide ? "w-[min(36rem,42vw)]" : "w-80",
        open ? "opacity-100" : "opacity-60",
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
