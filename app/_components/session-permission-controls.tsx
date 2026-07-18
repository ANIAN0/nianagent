"use client";

import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  ShieldCheckIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type SessionModes = {
  readonly acceptEdits: boolean;
  readonly globalBypass: boolean;
};

/** 输入区展示的有效权限模式（互斥；映射到 acceptEdits / globalBypass） */
export type SessionPermissionMode = "default" | "accept_edits" | "global_bypass";

const MODE_OPTIONS: ReadonlyArray<{
  value: SessionPermissionMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: "default",
    label: "逐次审批",
    shortLabel: "审批",
    description: "敏感工具每次询问；本会话已授权与已记住规则仍生效",
  },
  {
    value: "accept_edits",
    label: "自动批准编辑",
    shortLabel: "自动编辑",
    description: "本会话 write_file / edit_file 免批；powershell 仍需审批",
  },
  {
    value: "global_bypass",
    label: "全局放行",
    shortLabel: "全局放行",
    description: "本会话敏感工具均免批（非沙箱，当前 Windows 用户权限）",
  },
];

export function modesToPermissionMode(modes: SessionModes): SessionPermissionMode {
  if (modes.globalBypass) return "global_bypass";
  if (modes.acceptEdits) return "accept_edits";
  return "default";
}

export function permissionModeToModes(mode: SessionPermissionMode): SessionModes {
  switch (mode) {
    case "accept_edits":
      return { acceptEdits: true, globalBypass: false };
    case "global_bypass":
      return { acceptEdits: false, globalBypass: true };
    default:
      return { acceptEdits: false, globalBypass: false };
  }
}

/**
 * 会话权限模式：输入区工具栏内的单一模式菜单（与模型选择并列）。
 * 用 DropdownMenu 而非 Select，避免 SelectValue 把选项长文案回填进触发器。
 */
export function SessionPermissionControls({
  modes,
  syncing,
  syncError,
  onChange,
  onRetrySync,
  disabled,
}: {
  readonly modes: SessionModes;
  readonly syncing: boolean;
  readonly syncError: string | null;
  readonly onChange: (next: SessionModes) => void;
  readonly onRetrySync?: () => void;
  readonly disabled?: boolean;
}) {
  const current = modesToPermissionMode(modes);
  const currentMeta =
    MODE_OPTIONS.find((o) => o.value === current) ?? MODE_OPTIONS[0];
  const isDanger = current === "global_bypass";
  const isDisabled = Boolean(disabled || syncing);

  const selectMode = (next: SessionPermissionMode) => {
    if (next === current) return;
    if (next === "global_bypass") {
      const ok = window.confirm(
        "开启「全局放行」后，本会话内 write_file、edit_file、powershell 将不再询问审批。\n\n这不是沙箱：命令以当前 Windows 用户权限执行。确定开启？",
      );
      if (!ok) return;
    }
    onChange(permissionModeToModes(next));
  };

  return (
    <div
      className="flex min-w-0 items-center gap-1"
      role="group"
      aria-label="会话权限模式"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isDisabled}
            aria-label={`权限模式：${currentMeta.label}`}
            title={currentMeta.description}
            className={cn(
              "inline-flex h-8 max-w-[10.5rem] shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors sm:max-w-[12.5rem] sm:text-sm",
              "text-muted-foreground hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              "disabled:pointer-events-none disabled:opacity-50",
              isDanger &&
                "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive",
            )}
          >
            <ModeIcon mode={current} className="size-3.5 shrink-0 opacity-80" />
            <span className="min-w-0 truncate">
              <span className="hidden sm:inline">{currentMeta.label}</span>
              <span className="sm:hidden">{currentMeta.shortLabel}</span>
            </span>
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[min(18rem,calc(100vw-2rem))]"
          side="top"
          sideOffset={6}
        >
          {MODE_OPTIONS.map((opt) => {
            const selected = opt.value === current;
            return (
              <DropdownMenuItem
                key={opt.value}
                className="cursor-pointer items-start gap-2 py-2"
                onSelect={() => selectMode(opt.value)}
              >
                <ModeIcon
                  mode={opt.value}
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0 opacity-80",
                    opt.value === "global_bypass" && "text-destructive",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-sm font-medium leading-none",
                      opt.value === "global_bypass" && "text-destructive",
                    )}
                  >
                    {opt.label}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
                <CheckIcon
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {syncing ? (
        <span className="px-0.5 text-[11px] whitespace-nowrap text-muted-foreground">
          同步中
        </span>
      ) : null}

      {syncError ? (
        <span
          className="flex max-w-[9rem] items-center gap-0.5 text-[11px] text-destructive sm:max-w-none"
          role="alert"
          title={syncError}
        >
          <AlertTriangleIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">同步失败</span>
          {onRetrySync ? (
            <Button
              className="h-6 px-1.5 text-[11px]"
              size="xs"
              type="button"
              variant="ghost"
              onClick={onRetrySync}
            >
              重试
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function ModeIcon({
  mode,
  className,
}: {
  readonly mode: SessionPermissionMode;
  readonly className?: string;
}) {
  if (mode === "global_bypass") {
    return <ZapIcon className={className} aria-hidden />;
  }
  if (mode === "accept_edits") {
    return <FilePenLineIcon className={className} aria-hidden />;
  }
  return <ShieldCheckIcon className={className} aria-hidden />;
}
