"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangleIcon, FolderOpenIcon, Loader2Icon } from "lucide-react";
import { ToolInput } from "@/components/ai-elements/tool";
import type { EveDynamicToolPart } from "eve/react";
import { cn } from "@/lib/utils";

function readFilePath(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  if (typeof o.filePath === "string") return o.filePath;
  if (typeof o.path === "string") return o.path;
  return "";
}

function isWriteOrEditTool(toolName: string): boolean {
  const bare = toolName.includes("__")
    ? toolName.slice(toolName.lastIndexOf("__") + 2)
    : toolName;
  return bare === "write_file" || bare === "edit_file";
}

export function isFileSensitiveTool(toolName: string): boolean {
  return isWriteOrEditTool(toolName);
}

/**
 * write_file / edit_file 审批信息区：逻辑路径 + 宿主预览 + 非沙箱说明。
 */
export function FileToolApprovalBody({
  agentId,
  capability,
  onHostPathVerifiedChange,
  part,
}: {
  readonly agentId: string;
  readonly capability: string;
  readonly onHostPathVerifiedChange: (verified: boolean) => void;
  readonly part: EveDynamicToolPart;
}) {
  const filePath = readFilePath(part.input);
  const needsPreview =
    part.state === "approval-requested" ||
    part.state === "approval-responded" ||
    part.state === "input-available" ||
    part.state === "output-available" ||
    part.state === "output-error";

  const [hostPath, setHostPath] = useState<string | null>(null);
  const [alias, setAlias] = useState<string | null>(null);
  const [displayRoot, setDisplayRoot] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    onHostPathVerifiedChange(false);
    if (!needsPreview || !filePath || !capability) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPreviewError(null);
    void (async () => {
      try {
        const res = await fetch("/api/workspace-path-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agentId,
            capability,
            logicalPath: filePath,
          }),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          preview?: {
            hostPath?: string;
            alias?: string;
            displayRoot?: string;
          };
          error?: { message?: string };
        };
        if (cancelled) return;
        if (!res.ok || !body.ok || !body.preview?.hostPath) {
          setHostPath(null);
          setAlias(null);
          setDisplayRoot(null);
          setPreviewError(body.error?.message ?? "无法解析宿主路径");
          return;
        }
        setHostPath(body.preview.hostPath);
        setAlias(body.preview.alias ?? null);
        setDisplayRoot(body.preview.displayRoot ?? null);
        setPreviewError(null);
        onHostPathVerifiedChange(true);
      } catch (err) {
        if (cancelled) return;
        setPreviewError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    agentId,
    capability,
    filePath,
    needsPreview,
    onHostPathVerifiedChange,
    part.toolCallId,
  ]);

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <PathField label="逻辑路径" value={filePath || "（未指定）"} mono />
        <PathField
          label="解析后的宿主路径"
          loading={loading}
          error={previewError}
          value={hostPath}
          mono
        />
      </div>

      {alias || displayRoot ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {alias ? (
            <span className="inline-flex items-center gap-1">
              <FolderOpenIcon className="size-3 shrink-0" aria-hidden />
              alias{" "}
              <code className="rounded bg-muted px-1 py-px font-mono text-foreground">
                {alias}
              </code>
            </span>
          ) : null}
          {displayRoot ? (
            <span className="min-w-0 break-all">
              绑定根{" "}
              <code className="rounded bg-muted px-1 py-px font-mono text-foreground">
                {displayRoot}
              </code>
            </span>
          ) : null}
        </div>
      ) : null}

      <Callout tone="warning">
        这不是操作系统沙箱。批准后将以当前 Windows 用户权限写入解析后的宿主路径。
      </Callout>

      <details className="group text-[12px] text-muted-foreground">
        <summary className="cursor-pointer select-none list-none font-medium outline-none focus-visible:underline [&::-webkit-details-marker]:hidden">
          <span className="underline-offset-2 group-open:underline">
            原始工具输入
          </span>
        </summary>
        <div className="mt-2">
          <ToolInput input={part.input} />
        </div>
      </details>
    </div>
  );
}

export function PathField({
  label,
  value,
  mono,
  loading,
  error,
}: {
  readonly label: string;
  readonly value?: string | null;
  readonly mono?: boolean;
  readonly loading?: boolean;
  readonly error?: string | null;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <p className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" aria-hidden />
          解析中…
        </p>
      ) : error ? (
        <p className="text-[12px] text-destructive leading-relaxed" role="alert">
          {error}
        </p>
      ) : (
        <p
          className={cn(
            "break-all text-[12px] leading-relaxed",
            mono && "font-mono",
            !value && "text-muted-foreground",
          )}
        >
          {value || "—"}
        </p>
      )}
    </div>
  );
}

export function Callout({
  tone,
  children,
}: {
  readonly tone: "warning" | "danger";
  readonly children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex gap-2 rounded-md border px-3 py-2 text-[12px] leading-relaxed",
        tone === "warning" &&
          "border-amber-500/25 bg-amber-500/5 text-amber-950 dark:text-amber-100/90",
        tone === "danger" &&
          "border-destructive/30 bg-destructive/5 text-destructive",
      )}
      role={tone === "danger" ? "status" : undefined}
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
