"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  FolderIcon,
  FolderPlusIcon,
  HistoryIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  ChatAgentId,
  StoredBinding,
} from "./chat-session-storage";

export type BindingSuccess = {
  readonly binding: StoredBinding;
  readonly capability: string;
};

type PwshPreflightState =
  | { status: "loading" }
  | { status: "ok"; path: string; major: number }
  | { status: "missing"; message: string }
  | { status: "error"; message: string };

/** 服务端 recent 条目（仅 paths + usedAt） */
type RecentRootSet = {
  readonly paths: readonly string[];
  readonly usedAt: string;
};

/**
 * 把 Windows/类 Unix 路径拆成「文件夹名 + 父路径」。
 * 用户认的是末级目录名；全路径只作次要信息，且过长时从左侧省略。
 */
function splitDisplayPath(raw: string): {
  readonly name: string;
  readonly parent: string;
} {
  const normalized = raw.replace(/\//g, "\\").replace(/\\+$/, "");
  if (!normalized) return { name: raw, parent: "" };

  // 盘符根：C:\
  if (/^[A-Za-z]:$/i.test(normalized)) {
    return { name: `${normalized}\\`, parent: "" };
  }

  const sep = normalized.lastIndexOf("\\");
  if (sep < 0) return { name: normalized, parent: "" };

  const name = normalized.slice(sep + 1) || normalized;
  let parent = normalized.slice(0, sep);
  // 保留盘符根的反斜杠：C: → C:\
  if (/^[A-Za-z]:$/i.test(parent)) parent = `${parent}\\`;
  return { name, parent };
}

/** 父路径过长时从左侧截断，保留盘符与靠近文件夹的那一段 */
function ellipsizeParent(parent: string, maxLen = 42): string {
  if (!parent || parent.length <= maxLen) return parent;
  // 尽量在分隔符处切断
  const keep = parent.slice(-(maxLen - 1));
  const cut = keep.indexOf("\\");
  const tail = cut > 0 && cut < 12 ? keep.slice(cut + 1) : keep;
  return `…\\${tail}`;
}

/** usedAt ISO → 简短相对时间；无效则空串 */
function formatUsedAt(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
  try {
    return new Date(t).toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function WorkspaceBindingForm({
  agentId,
  onSuccess,
}: {
  readonly agentId: ChatAgentId;
  readonly onSuccess: (result: BindingSuccess) => void;
}) {
  // 路径初值固定为空，挂载后由服务端 recent 回填，避免 SSR/CSR 不一致
  const [paths, setPaths] = useState<string[]>([""]);
  const [recent, setRecent] = useState<RecentRootSet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [previewRoots, setPreviewRoots] = useState<
    readonly { alias: string; displayPath: string }[] | null
  >(null);
  const [pwsh, setPwsh] = useState<PwshPreflightState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        // 本机全 agent 历史（不按 agent 过滤），换 agent 也能复用同一组路径
        const res = await fetch("/api/workspace-bindings", { method: "GET" });
        const body = (await res.json()) as {
          ok?: boolean;
          pwsh?: {
            ok?: boolean;
            path?: string;
            major?: number;
            message?: string;
          };
          recent?: { paths?: unknown; usedAt?: unknown }[];
          error?: { message?: string };
        };
        if (cancelled) return;

        const recentEntries: RecentRootSet[] = [];
        if (Array.isArray(body.recent)) {
          for (const item of body.recent) {
            if (!item || typeof item !== "object") continue;
            if (!Array.isArray(item.paths)) continue;
            const pathsList = item.paths
              .filter((p): p is string => typeof p === "string")
              .map((p) => p.trim())
              .filter((p) => p.length > 0);
            if (pathsList.length === 0) continue;
            const usedAt =
              typeof item.usedAt === "string" && item.usedAt
                ? item.usedAt
                : "";
            recentEntries.push({ paths: pathsList, usedAt });
          }
        }
        // 客户端再截一次：只回显最近 3 组（与 API 默认一致）
        const topRecent = recentEntries.slice(0, 3);
        setRecent(topRecent);
        if (topRecent[0]?.paths.length) {
          setPaths([...topRecent[0].paths]);
        }

        if (body.pwsh?.ok && body.pwsh.path && body.pwsh.major != null) {
          setPwsh({
            status: "ok",
            path: body.pwsh.path,
            major: body.pwsh.major,
          });
          return;
        }
        setPwsh({
          status: "missing",
          message:
            body.pwsh?.message ??
            body.error?.message ??
            "未检测到 PowerShell 7（pwsh）。请安装 PowerShell 7，或设置 NIANAGENT_PWSH。禁止回退到 Windows PowerShell 5.1 或 Git Bash。",
        });
      } catch (err) {
        if (cancelled) return;
        setPwsh({
          status: "error",
          message:
            err instanceof Error
              ? `无法完成 PowerShell 7 预检：${err.message}`
              : "无法完成 PowerShell 7 预检。",
        });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const updatePath = (index: number, value: string) => {
    setPaths((prev) => prev.map((p, i) => (i === index ? value : p)));
    setPreviewRoots(null);
    setError(null);
  };

  const addPath = () => {
    setPaths((prev) => [...prev, ""]);
  };

  const removePath = (index: number) => {
    setPaths((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );
  };

  const applyRecent = (entry: RecentRootSet) => {
    setPaths([...entry.paths]);
    setPreviewRoots(null);
    setError(null);
  };

  const pwshBlocked = pwsh.status === "missing" || pwsh.status === "error";
  const formDisabled = pending || pwsh.status === "loading" || pwshBlocked;

  const submit = async () => {
    if (pwshBlocked) {
      setError(
        pwsh.status === "missing" || pwsh.status === "error"
          ? pwsh.message
          : "PowerShell 7 预检未通过。",
      );
      return;
    }
    const roots = paths.map((p) => p.trim()).filter((p) => p.length > 0);
    if (roots.length === 0) {
      setError("请至少填写一个 Windows 绝对路径工作目录。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace-bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, roots }),
      });
      const body = (await res.json()) as {
        workspaceId?: string;
        agentId?: ChatAgentId;
        roots?: { alias: string; displayPath: string }[];
        capability?: string;
        error?: { message?: string; code?: string };
      };
      if (!res.ok) {
        setError(body.error?.message ?? `绑定失败（HTTP ${res.status}）`);
        if (body.error?.code === "pwsh_missing") {
          setPwsh({
            status: "missing",
            message: body.error.message ?? "未检测到 PowerShell 7。",
          });
        }
        return;
      }
      if (
        !body.workspaceId ||
        !body.capability ||
        !body.roots ||
        !Array.isArray(body.roots)
      ) {
        setError("绑定响应无效。");
        return;
      }
      // 响应不得含 canonicalPath（服务端契约）；此处只取 alias/displayPath
      const publicRoots = body.roots.map((r) => ({
        alias: r.alias,
        displayPath: r.displayPath,
      }));
      setPreviewRoots(publicRoots);
      onSuccess({
        binding: {
          workspaceId: body.workspaceId,
          agentId,
          roots: publicRoots,
        },
        capability: body.capability,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (formDisabled) return;
    void submit();
  };

  return (
    <form className="flex w-full flex-col gap-4 text-left" onSubmit={onFormSubmit}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <FolderPlusIcon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-medium text-base tracking-tight text-balance">
            选择工作目录
          </h2>
          <p className="mt-1 text-muted-foreground text-sm leading-relaxed text-pretty">
            绑定一个或多个本机目录后开始会话。工具参数使用逻辑路径{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">
              /workspace/&lt;alias&gt;/...
            </code>
            ；经你批准的 PowerShell 在本机真实目录执行（非 OS 沙箱）。
          </p>
        </div>
      </div>

      {pwsh.status === "loading" ? (
        <p
          className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground text-sm"
          role="status"
        >
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          正在预检本机 PowerShell 7（pwsh）…
        </p>
      ) : null}

      {pwsh.status === "ok" ? (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-muted-foreground text-xs leading-relaxed">
          已检测到 PowerShell {pwsh.major}：
          <code className="ml-1 break-all font-mono text-foreground">
            {pwsh.path}
          </code>
        </p>
      ) : null}

      {pwsh.status === "missing" || pwsh.status === "error" ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          role="alert"
        >
          <p className="font-medium">无法绑定：缺少运行前置条件</p>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed">
            {pwsh.message}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-destructive/90">
            安装后将{" "}
            <code className="rounded border border-destructive/20 bg-destructive/10 px-1 font-mono">
              pwsh
            </code>{" "}
            加入 PATH，或在服务端{" "}
            <code className="rounded border border-destructive/20 bg-destructive/10 px-1 font-mono">
              .env
            </code>{" "}
            设置{" "}
            <code className="rounded border border-destructive/20 bg-destructive/10 px-1 font-mono">
              NIANAGENT_PWSH
            </code>
            。不会回退到 PowerShell 5.1 或 Git Bash。
          </p>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <HistoryIcon className="size-3.5 shrink-0" aria-hidden />
            <span>最近使用（点击填入下方）</span>
          </div>
          <ul className="flex flex-col gap-1.5" role="list">
            {recent.map((entry) => {
              const key = entry.paths.join("|");
              const when = formatUsedAt(entry.usedAt);
              const parts = entry.paths.map((p) => ({
                full: p,
                ...splitDisplayPath(p),
              }));
              const multi = parts.length > 1;

              return (
                <li key={key}>
                  <button
                    className={cn(
                      "group flex w-full min-w-0 items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors",
                      "hover:border-foreground/20 hover:bg-muted/40",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                    disabled={formDisabled}
                    onClick={() => applyRecent(entry)}
                    title={entry.paths.join("\n")}
                    type="button"
                  >
                    <span
                      className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground"
                      aria-hidden
                    >
                      <FolderIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-medium text-sm text-foreground">
                          {multi
                            ? `${parts.length} 个目录`
                            : parts[0]!.name}
                        </span>
                        {when ? (
                          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                            {when}
                          </span>
                        ) : null}
                      </span>
                      {/* 每个路径：文件夹名在前、父路径次要；不再截成「…\xxx +N」 */}
                      <ul className="mt-1 space-y-1">
                        {parts.map((part) => (
                          <li
                            className="min-w-0 leading-snug"
                            key={part.full}
                          >
                            {multi ? (
                              <span className="block truncate text-xs font-medium text-foreground/90">
                                {part.name}
                              </span>
                            ) : null}
                            {part.parent ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {ellipsizeParent(part.parent, multi ? 36 : 48)}
                              </span>
                            ) : multi ? null : (
                              <span className="block truncate text-xs text-muted-foreground">
                                {part.full}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className="sr-only" htmlFor="workspace-root-0">
          工作目录路径
        </label>
        {paths.map((p, index) => (
          <div className="flex gap-2" key={`path-${index}`}>
            <Input
              aria-label={`工作目录 ${index + 1}`}
              className="font-mono text-sm"
              disabled={formDisabled}
              id={index === 0 ? "workspace-root-0" : undefined}
              onChange={(e) => updatePath(index, e.target.value)}
              placeholder="例如 C:\Users\you\project"
              value={p}
            />
            <Button
              aria-label="删除此目录"
              disabled={formDisabled || paths.length <= 1}
              onClick={() => removePath(index)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          className="self-start"
          disabled={formDisabled}
          onClick={addPath}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PlusIcon className="size-4" />
          添加目录
        </Button>
      </div>

      {previewRoots ? (
        <ul className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          {previewRoots.map((r) => (
            <li className="font-mono text-xs" key={r.alias}>
              <span className="text-foreground">/workspace/{r.alias}</span>
              <span className="text-muted-foreground"> → {r.displayPath}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Button className="w-full sm:w-auto" disabled={formDisabled} type="submit">
        {pending ? (
          <>
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
            绑定中…
          </>
        ) : pwsh.status === "loading" ? (
          "预检中…"
        ) : pwshBlocked ? (
          "需先满足 PowerShell 7 前置条件"
        ) : (
          "绑定并开始会话"
        )}
      </Button>
    </form>
  );
}
