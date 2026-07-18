"use client";

import { useState } from "react";
import {
  CheckCircle2Icon,
  Loader2Icon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AgentInputResponse } from "./agent-message";

export type TrustScopeChoice = "once" | "session_tool" | "persistent";

export type ApprovalSubmitPayload = {
  readonly responses: readonly AgentInputResponse[];
  /** 仅本次不带头；本会话/记住带 X-Nian-Trust-Scope */
  readonly trustScope?: "session_tool" | "persistent";
  /**
   * Eve 工具 callId（动态工具 part.toolCallId）。
   * 与 requestId（approvalId）可能不同；扩大授权/清理 pending 时必填以精确绑定。
   */
  readonly toolCallId?: string;
  /** 拒绝说明 → send.message */
  readonly message?: string;
};

const SCOPE_OPTIONS: readonly {
  readonly id: TrustScopeChoice;
  readonly label: string;
  readonly description: string;
  readonly powerShellDescription?: string;
}[] = [
  {
    id: "once",
    label: "仅本次",
    description: "只批准这一次调用，不记住",
  },
  {
    id: "session_tool",
    label: "本会话允许该工具",
    description: "本对话内同名工具后续免批",
  },
  {
    id: "persistent",
    label: "记住到本工作区",
    description: "写入持久规则，可在工具信任页管理",
    powerShellDescription: "相同命令且相同逻辑目录时自动放行",
  },
];

/**
 * 分级审批卡：仅本次 / 本会话 / 记住 / 拒绝+说明。
 * 浏览器只发 approve±意图头；不写 trust API。
 */
export function ApprovalDecisionCard({
  approvalBlocked,
  canRespond,
  isPowerShell,
  prompt,
  requestId,
  toolCallId,
  alreadyResponded,
  respondedSummary,
  onSubmit,
}: {
  readonly approvalBlocked: boolean;
  readonly canRespond: boolean;
  readonly isPowerShell: boolean;
  readonly prompt: string;
  readonly requestId: string;
  /** 与 execute 屏障 callId 对齐 */
  readonly toolCallId: string;
  readonly alreadyResponded: boolean;
  readonly respondedSummary?: string;
  readonly onSubmit: (payload: ApprovalSubmitPayload) => void | Promise<void>;
}) {
  const [scope, setScope] = useState<TrustScopeChoice>("once");
  const [denyNote, setDenyNote] = useState("");
  const [showDenyNote, setShowDenyNote] = useState(false);
  const [phase, setPhase] = useState<"idle" | "submitting" | "done" | "fail">(
    alreadyResponded ? "done" : "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "submitting";
  const approveDisabled =
    !canRespond || busy || approvalBlocked || phase === "done";
  const denyDisabled = !canRespond || busy || phase === "done";

  const run = async (payload: ApprovalSubmitPayload) => {
    setPhase("submitting");
    setError(null);
    try {
      await onSubmit(payload);
      setPhase("done");
    } catch (err) {
      setPhase("fail");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (alreadyResponded || phase === "done") {
    return (
      <section
        aria-label="审批结果"
        className="rounded-md border border-border bg-card p-4 shadow-[0_2px_2px_rgba(0,0,0,0.04)]"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <CheckCircle2Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-sm leading-snug">
              {respondedSummary ?? "已提交审批决策"}
            </p>
            {prompt ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {prompt}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="工具审批"
      className="overflow-hidden rounded-md border border-border bg-card shadow-[0_2px_2px_rgba(0,0,0,0.04)]"
    >
      {/* 标题区：状态 + 提示 */}
      <header className="flex items-start gap-3 border-b border-border/80 px-4 py-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
            approvalBlocked
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-500/10 text-amber-800 dark:text-amber-200",
          )}
        >
          {approvalBlocked ? (
            <ShieldAlertIcon className="size-4" aria-hidden />
          ) : (
            <ShieldCheckIcon className="size-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-sm leading-none">需要审批</h3>
            <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px] text-muted-foreground">
              非沙箱执行
            </span>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {prompt}
          </p>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            批准后以本机当前用户权限运行，不是操作系统沙箱。
          </p>
        </div>
      </header>

      <div className="space-y-4 p-4">
        <fieldset disabled={approveDisabled && denyDisabled} className="space-y-2">
          <legend className="mb-2 text-[12px] font-medium text-muted-foreground">
            批准范围
          </legend>
          <div
            className="grid gap-2"
            role="radiogroup"
            aria-label="批准范围"
          >
            {SCOPE_OPTIONS.map((opt) => {
              const selected = scope === opt.id;
              const description =
                opt.id === "persistent" && isPowerShell
                  ? (opt.powerShellDescription ?? opt.description)
                  : opt.description;
              // 用 button role=radio，避免 sr-only input 获焦时浏览器把滚动容器拽飞
              // （对齐 ai-elements Confirmation 的按钮式操作，不用隐藏 radio）
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={approveDisabled}
                  onClick={() => setScope(opt.id)}
                  className={cn(
                    "group flex w-full cursor-pointer gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                    selected
                      ? "border-foreground/20 bg-muted/50"
                      : "border-border/70 bg-background hover:border-border hover:bg-muted/30",
                    approveDisabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                      selected
                        ? "border-foreground bg-foreground"
                        : "border-muted-foreground/40 bg-background",
                    )}
                    aria-hidden
                  >
                    {selected ? (
                      <span className="size-1.5 rounded-full bg-background" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-sm leading-snug">
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground leading-relaxed">
                      {description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {approvalBlocked ? (
          <p
            className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-destructive text-xs leading-relaxed"
            role="alert"
          >
            宿主路径尚未验证成功，已禁用全部批准操作。仍可拒绝，或修正路径后重试。
          </p>
        ) : null}

        {/* 操作区：主操作批准，次操作拒绝 */}
        <div className="flex flex-col gap-3 border-t border-border/70 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={approveDisabled}
              size="sm"
              type="button"
              className="min-w-[5.5rem]"
              onClick={() => {
                void run({
                  responses: [{ requestId, optionId: "approve" }],
                  toolCallId,
                  trustScope: scope === "once" ? undefined : scope,
                });
              }}
            >
              {busy ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin" />
                  提交中…
                </>
              ) : (
                "批准执行"
              )}
            </Button>
            <Button
              disabled={denyDisabled}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                if (!showDenyNote) {
                  setShowDenyNote(true);
                  return;
                }
                const note = denyNote.trim();
                void run({
                  responses: [{ requestId, optionId: "deny" }],
                  toolCallId,
                  message: note.length > 0 ? note : undefined,
                });
              }}
            >
              {busy ? "提交中…" : showDenyNote ? "确认拒绝" : "拒绝"}
            </Button>
            {showDenyNote ? (
              <Button
                disabled={denyDisabled}
                size="sm"
                type="button"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => {
                  setShowDenyNote(false);
                  setDenyNote("");
                }}
              >
                取消
              </Button>
            ) : null}
          </div>

          {showDenyNote ? (
            <div className="space-y-1.5">
              <label
                className="text-[12px] font-medium text-muted-foreground"
                htmlFor={`deny-note-${requestId}`}
              >
                拒绝说明（可选，会作为消息发给模型）
              </label>
              <Textarea
                id={`deny-note-${requestId}`}
                className="min-h-[4.5rem] resize-y text-sm"
                disabled={denyDisabled}
                placeholder="例如：路径不在工作区内，请改到绑定目录后再试"
                value={denyNote}
                autoFocus
                onChange={(e) => setDenyNote(e.target.value)}
              />
            </div>
          ) : null}
        </div>

        {phase === "fail" && error ? (
          <p
            className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-destructive text-xs leading-relaxed"
            role="alert"
          >
            提交失败：{error}。可重试；尚未扩大授权。
          </p>
        ) : null}
      </div>
    </section>
  );
}
