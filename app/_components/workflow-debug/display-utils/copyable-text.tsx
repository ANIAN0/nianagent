"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "../i18n/zh-CN";

/**
 * 可复制文本（对齐上游 CopyableText / CopyableCell）。
 * - 默认始终露出复制图标（避免「看不见」）；hover 加强
 * - 禁止放在外层 <button> 内（嵌套 button 会破坏展开点击）
 */
export function CopyableText({
  text,
  children,
  className,
  overlay,
  /** 始终显示复制按钮（默认 true，避免仅 hover 才出现） */
  alwaysShowCopy = true,
}: {
  readonly text: string;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly overlay?: boolean;
  readonly alwaysShowCopy?: boolean;
}) {
  if (!text) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        {children ?? "—"}
      </span>
    );
  }

  if (overlay) {
    return (
      <span
        className={cn("group/copy relative inline-block max-w-full", className)}
      >
        {children ?? (
          <span className="font-mono text-xs break-all">{text}</span>
        )}
        <span className="absolute top-1/2 right-0 -translate-y-1/2">
          <CopyIconButton
            alwaysShow={alwaysShowCopy}
            className="rounded bg-background/90 p-1 shadow-sm"
            text={text}
          />
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "group/copy inline-flex max-w-full items-center gap-1",
        className,
      )}
    >
      <span className="min-w-0 truncate">
        {children ?? <span className="font-mono text-xs">{text}</span>}
      </span>
      <CopyIconButton alwaysShow={alwaysShowCopy} text={text} />
    </span>
  );
}

/** 独立复制按钮：可放在 JSON 块、工具栏；带文案或仅图标 */
export function CopyIconButton({
  text,
  label,
  alwaysShow = true,
  className,
}: {
  readonly text: string;
  readonly label?: boolean;
  readonly alwaysShow?: boolean;
  readonly className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        // 剪贴板不可用时静默
      }
    },
    [text],
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={copied ? t("copied") : t("copy")}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded p-0.5 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground",
            alwaysShow
              ? "opacity-70 hover:opacity-100"
              : "opacity-0 group-hover/copy:opacity-100 group-hover/payload:opacity-100",
            className,
          )}
          onClick={handleCopy}
          type="button"
        >
          {copied ? (
            <CheckIcon className="size-3 text-emerald-600" />
          ) : (
            <CopyIcon className="size-3" />
          )}
          {label ? (
            <span className="text-[11px]">
              {copied ? t("copied") : t("copy")}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{copied ? t("copied") : t("copy")}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** JSON / 多行文本块 + 右上角复制（对齐上游 PayloadBlock Copy） */
export function CopyableJsonBlock({
  value,
  className,
  maxHeightClass = "max-h-64",
}: {
  readonly value: unknown;
  readonly className?: string;
  readonly maxHeightClass?: string;
}) {
  const text = safeStringify(value);
  return (
    <div
      className={cn(
        "group/payload relative rounded border bg-muted/20",
        className,
      )}
    >
      <div className="absolute top-1.5 right-1.5 z-10">
        <CopyIconButton
          alwaysShow
          className="bg-background/90 px-1.5 py-1 shadow-sm"
          label
          text={text}
        />
      </div>
      <pre
        className={cn(
          "overflow-auto whitespace-pre-wrap break-all p-2 pr-16 font-mono text-[11px]",
          maxHeightClass,
        )}
      >
        {text}
      </pre>
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
