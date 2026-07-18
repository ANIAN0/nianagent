"use client";

import { useEffect, useState } from "react";
import {
  FolderPlusIcon,
  HistoryIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** 展示用短标签：单路径截断；多根显示「首路径 +N」 */
function formatRootSetLabel(paths: readonly string[], maxLen = 48): string {
  if (paths.length === 0) return "";
  if (paths.length === 1) {
    const p = paths[0]!;
    return p.length <= maxLen ? p : `…${p.slice(-(maxLen - 1))}`;
  }
  const first = paths[0]!;
  const head =
    first.length <= maxLen - 6 ? first : `…${first.slice(-(maxLen - 7))}`;
  return `${head} +${paths.length - 1}`;
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
        setRecent(recentEntries);
        if (recentEntries[0]?.paths.length) {
          setPaths([...recentEntries[0].paths]);
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
    setPaths((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
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
      // 历史由服务端 binding 表派生；成功创建后自然进入下次 GET recent
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

  return (
    <div className="flex w-full flex-col gap-4 text-left">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <FolderPlusIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-medium text-base tracking-tight">选择工作目录</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            会话创建前绑定一个或多个本机目录。工具使用逻辑路径{" "}
            <code className="rounded bg-muted px-1 text-xs">/workspace/&lt;alias&gt;/...</code>
            。逻辑路径不是磁盘挂载；PowerShell 经审批后在本机真实目录执行（非 OS 沙箱）。
          </p>
        </div>
      </div>

      {pwsh.status === "loading" ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
          正在预检本机 PowerShell 7（pwsh）…
        </p>
      ) : null}

      {pwsh.status === "ok" ? (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
          已检测到 PowerShell {pwsh.major}：
          <code className="ml-1 break-all font-mono">{pwsh.path}</code>
        </p>
      ) : null}

      {pwsh.status === "missing" || pwsh.status === "error" ? (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
          role="alert"
        >
          <p className="font-medium">无法绑定：缺少运行前置条件</p>
          <p className="mt-1 whitespace-pre-wrap">{pwsh.message}</p>
          <p className="mt-2 text-xs opacity-90">
            安装后可将可执行文件加入 PATH，或在服务端{" "}
            <code className="rounded bg-muted px-1 text-foreground">.env</code>{" "}
            中设置{" "}
            <code className="rounded bg-muted px-1 text-foreground">
              NIANAGENT_PWSH
            </code>
            。不会回退到 Windows PowerShell 5.1 或 Git Bash。
          </p>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <HistoryIcon className="size-3.5 shrink-0" />
            <span>最近绑定（来自本机服务记录，点击填入）</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {recent.map((entry) => {
              const key = entry.paths.join("|");
              const title = entry.paths.join("\n");
              return (
                <li key={key}>
                  <button
                    className="w-full min-w-0 rounded-lg border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
                    disabled={formDisabled}
                    onClick={() => applyRecent(entry)}
                    title={title}
                    type="button"
                  >
                    <span className="block truncate font-mono text-xs text-foreground">
                      {formatRootSetLabel(entry.paths, 56)}
                    </span>
                    {entry.paths.length > 1 ? (
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {entry.paths.join(" · ")}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {paths.map((p, index) => (
          <div className="flex gap-2" key={`path-${index}`}>
            <Input
              aria-label={`工作目录 ${index + 1}`}
              className="font-mono text-sm"
              disabled={formDisabled}
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

      <p className="text-muted-foreground text-xs leading-relaxed">
        绑定后工具使用逻辑路径{" "}
        <code className="rounded bg-muted px-1">/workspace/&lt;alias&gt;/...</code>
        。这不是磁盘挂载，也不是 OS 沙箱；PowerShell 命令经你批准后在本机真实目录执行。
        最近目录来自本机 Turso 中的成功绑定历史，跨浏览器一致。
      </p>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Button disabled={formDisabled} onClick={submit} type="button">
        {pending
          ? "绑定中…"
          : pwsh.status === "loading"
            ? "预检中…"
            : pwshBlocked
              ? "需先满足 PowerShell 7 前置条件"
              : "绑定并开始会话"}
      </Button>
    </div>
  );
}
