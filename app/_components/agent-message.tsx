"use client";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
} from "eve/react";
import {
  CheckCircleIcon,
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  KeyRoundIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApprovalDecisionCard } from "./approval-decision-card";
import {
  Callout,
  FileToolApprovalBody,
  isFileSensitiveTool,
  PathField,
} from "./file-tool-approval-body";

/** 失败/拒绝态必须展开卡片，避免用户只看到折叠头而看不到 errorText（DEF-013）。 */
function toolShouldForceOpen(state: EveDynamicToolPart["state"]): boolean {
  return (
    state === "approval-requested" ||
    state === "approval-responded" ||
    state === "output-error" ||
    state === "output-denied"
  );
}

/** 从 tool part 提取可见错误文案（含拒绝原因）。 */
function resolveToolErrorText(part: EveDynamicToolPart): string | undefined {
  if (part.state === "output-error") {
    const text = part.errorText?.trim();
    return text && text.length > 0 ? text : "工具执行失败（无详细错误信息）";
  }
  if (part.state === "output-denied") {
    const reason = part.approval?.reason?.trim();
    return reason && reason.length > 0
      ? `已拒绝：${reason}`
      : "用户已拒绝该工具调用";
  }
  return undefined;
}

export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

export type { ApprovalSubmitPayload } from "./approval-decision-card";

type EveFilePart = Extract<EveMessagePart, { type: "file" }>;

export function AgentMessage({
  agentId,
  canRespond,
  capability,
  isStreaming,
  message,
  onApprovalSubmit,
}: {
  readonly agentId: string;
  readonly canRespond: boolean;
  readonly capability: string;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onApprovalSubmit: (
    payload: import("./approval-decision-card").ApprovalSubmitPayload,
  ) => void | Promise<void>;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {message.parts.map((part, index) => (
          <AgentMessagePart
            agentId={agentId}
            canRespond={canRespond}
            capability={capability}
            key={partKey(part, index)}
            onApprovalSubmit={onApprovalSubmit}
            part={part}
            showCaret={isStreaming && message.role === "assistant" && index === lastTextIndex}
          />
        ))}
      </MessageContent>
    </Message>
  );
}

function AgentMessagePart({
  agentId,
  canRespond,
  capability,
  onApprovalSubmit,
  part,
  showCaret,
}: {
  readonly agentId: string;
  readonly canRespond: boolean;
  readonly capability: string;
  readonly onApprovalSubmit: (
    payload: import("./approval-decision-card").ApprovalSubmitPayload,
  ) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "file":
      return <AttachmentPart part={part} />;
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool":
      return (
        <DynamicToolPartView
          agentId={agentId}
          canRespond={canRespond}
          capability={capability}
          onApprovalSubmit={onApprovalSubmit}
          part={part}
        />
      );
  }
}

/**
 * 工具卡片：失败/审批时强制展开；错误文案走 ToolOutput role=alert。
 */
function DynamicToolPartView({
  agentId,
  canRespond,
  capability,
  onApprovalSubmit,
  part,
}: {
  readonly agentId: string;
  readonly canRespond: boolean;
  readonly capability: string;
  readonly onApprovalSubmit: (
    payload: import("./approval-decision-card").ApprovalSubmitPayload,
  ) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const forceOpen = toolShouldForceOpen(part.state);
  const powerShellTool = isPowerShellTool(part.toolName);
  const fileTool = isFileSensitiveTool(part.toolName);
  const needsHostVerify = powerShellTool || fileTool;
  const [open, setOpen] = useState(forceOpen);
  const [hostVerified, setHostVerified] = useState(!needsHostVerify);

  // 状态转入错误/审批时重新展开（defaultOpen 只在首挂生效）
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen, part.state, part.toolCallId]);

  // 每次新工具调用都要求重新解析宿主路径，不能沿用上一条的结果。
  useEffect(() => {
    setHostVerified(!needsHostVerify);
  }, [part.toolCallId, needsHostVerify]);

  const errorText = resolveToolErrorText(part);
  const output = part.state === "output-available" ? part.output : undefined;

  return (
    <Tool onOpenChange={setOpen} open={open}>
      <ToolHeader
        state={part.state}
        title={part.toolName}
        toolName={part.toolName}
        type="dynamic-tool"
      />
      <ToolContent>
        {powerShellTool ? (
          <PowerShellToolBody
            agentId={agentId}
            capability={capability}
            onHostCwdVerifiedChange={setHostVerified}
            part={part}
          />
        ) : fileTool ? (
          <FileToolApprovalBody
            agentId={agentId}
            capability={capability}
            onHostPathVerifiedChange={setHostVerified}
            part={part}
          />
        ) : (
          <ToolInput input={part.input} />
        )}
        <InputRequestActions
          approvalBlocked={needsHostVerify && !hostVerified}
          canRespond={canRespond}
          isPowerShell={powerShellTool}
          part={part}
          onApprovalSubmit={onApprovalSubmit}
        />
        <ToolOutput errorText={errorText} output={output} />
      </ToolContent>
    </Tool>
  );
}

function isPowerShellTool(toolName: string): boolean {
  return toolName === "powershell" || toolName.endsWith("__powershell");
}

function readPowerShellInput(input: unknown): {
  command: string;
  cwd: string;
  description: string;
} {
  if (!input || typeof input !== "object") {
    return { command: "", cwd: "", description: "" };
  }
  const o = input as Record<string, unknown>;
  return {
    command: typeof o.command === "string" ? o.command : "",
    cwd: typeof o.cwd === "string" ? o.cwd : "",
    description: typeof o.description === "string" ? o.description : "",
  };
}

function commandMayAccessOutsideBinding(command: string): boolean {
  return /(?:^|[\s"'`(=,[\]{])(?:[A-Za-z]:[\\/]|\\\\|\/\/)/.test(command);
}

function PowerShellToolBody({
  agentId,
  capability,
  onHostCwdVerifiedChange,
  part,
}: {
  readonly agentId: string;
  readonly capability: string;
  readonly onHostCwdVerifiedChange: (verified: boolean) => void;
  readonly part: EveDynamicToolPart;
}) {
  const { command, cwd, description } = readPowerShellInput(part.input);
  const needsPreview =
    part.state === "approval-requested" ||
    part.state === "approval-responded" ||
    part.state === "input-available" ||
    part.state === "output-available" ||
    part.state === "output-error";
  const [hostCwd, setHostCwd] = useState<string | null>(null);
  const [alias, setAlias] = useState<string | null>(null);
  const [displayRoot, setDisplayRoot] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    onHostCwdVerifiedChange(false);
    if (!needsPreview || !cwd || !capability) {
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
            logicalPath: cwd,
          }),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          preview?: {
            hostPath?: string;
            alias?: string;
            displayRoot?: string;
            logicalPath?: string;
          };
          error?: { message?: string };
        };
        if (cancelled) return;
        if (!res.ok || !body.ok || !body.preview?.hostPath) {
          setHostCwd(null);
          setAlias(null);
          setDisplayRoot(null);
          setPreviewError(body.error?.message ?? "无法解析宿主 cwd");
          return;
        }
        setHostCwd(body.preview.hostPath);
        setAlias(body.preview.alias ?? null);
        setDisplayRoot(body.preview.displayRoot ?? null);
        setPreviewError(null);
        onHostCwdVerifiedChange(true);
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
  }, [agentId, capability, cwd, needsPreview, onHostCwdVerifiedChange, part.toolCallId]);

  const outsideHint = commandMayAccessOutsideBinding(command);

  return (
    <div className="space-y-3 text-sm">
      {description ? (
        <div className="space-y-1">
          <p className="text-[12px] font-medium text-muted-foreground">目的</p>
          <p className="text-sm leading-relaxed">{description}</p>
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-[12px] font-medium text-muted-foreground">命令</p>
        <pre className="overflow-x-auto rounded-md border border-border/80 bg-muted/40 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
          {command || "（空）"}
        </pre>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <PathField label="逻辑 cwd" value={cwd || "（未指定）"} mono />
        <PathField
          label="解析后的宿主 cwd"
          loading={loading}
          error={previewError}
          value={hostCwd}
          mono
        />
      </div>
      {alias || displayRoot ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {alias ? (
            <span>
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
        这不是操作系统沙箱，也不是目录挂载。批准后命令以当前 Windows
        用户权限在解析后的宿主目录中运行。
      </Callout>
      {outsideHint ? (
        <Callout tone="danger">
          命令正文含盘符或 UNC 路径迹象，批准后可能访问绑定目录以外的位置。
        </Callout>
      ) : null}
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

function AttachmentPart({ part }: { readonly part: EveFilePart }) {
  const label = part.filename ?? "Attachment";
  const detail = [part.mediaType, formatBytes(part.size)].filter(Boolean).join(" - ");
  const isImage = part.mediaType.startsWith("image/") && part.url !== undefined;
  const Icon = isImage ? ImageIcon : FileIcon;
  const body = (
    <span className="flex max-w-sm items-center gap-3 rounded-md border bg-background/60 p-2 text-sm">
      {isImage ? (
        <img alt={label} className="size-12 shrink-0 rounded-sm object-cover" src={part.url} />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {detail ? <span className="block truncate text-muted-foreground">{detail}</span> : null}
      </span>
      {part.url ? <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" /> : null}
    </span>
  );

  return part.url ? (
    <a href={part.url} rel="noreferrer" target="_blank">
      {body}
    </a>
  ) : (
    body
  );
}

function AuthorizationPrompt({ part }: { readonly part: EveAuthorizationPart }) {
  const isAuthorized = part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized ? CheckCircleIcon : isCompleted ? XCircleIcon : KeyRoundIcon;
  const instructions = part.authorization?.instructions;
  const shouldShowInstructions = instructions !== undefined && instructions !== part.description;

  return (
    <div
      className={cn(
        "space-y-3 rounded-md border p-3",
        isAuthorized
          ? "border-emerald-500/30 bg-emerald-500/5"
          : isCompleted
            ? "border-destructive/30 bg-destructive/5"
            : "border-blue-500/30 bg-blue-500/5",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            isAuthorized
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : isCompleted
                ? "bg-destructive/10 text-destructive"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-300",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-sm">{authorizationTitle(part)}</p>
          <p className="text-muted-foreground text-sm">{authorizationDescription(part)}</p>
          {shouldShowInstructions ? (
            <p className="text-muted-foreground text-sm">{instructions}</p>
          ) : null}
          {part.state === "required" && part.authorization?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Code</span>
              <code className="rounded-md bg-background px-2 py-1 font-mono">
                {part.authorization.userCode}
              </code>
            </div>
          ) : null}
          {part.state === "required" && part.authorization?.url ? (
            <Button asChild size="sm">
              <a href={part.authorization.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-4" />
                Sign in with {part.displayName}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return `Connect ${part.displayName}`;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected`;
  }
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return part.description;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected.`;
  }
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}${tail}.`;
}

function formatAuthorizationOutcome(outcome: NonNullable<EveAuthorizationPart["outcome"]>): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }
}

function formatBytes(size: number | undefined): string | undefined {
  if (size === undefined) {
    return undefined;
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function InputRequestActions({
  approvalBlocked,
  canRespond,
  isPowerShell,
  onApprovalSubmit,
  part,
}: {
  readonly approvalBlocked: boolean;
  readonly canRespond: boolean;
  readonly isPowerShell: boolean;
  readonly onApprovalSubmit: (
    payload: import("./approval-decision-card").ApprovalSubmitPayload,
  ) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) {
    return null;
  }

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId,
  );
  const alreadyResponded = Boolean(inputResponse);
  const respondedSummary = alreadyResponded
    ? `已响应：${selectedOption?.label ?? inputResponse?.text ?? inputResponse?.optionId ?? "已提交"}`
    : undefined;

  // 敏感工具（approve/deny 确认）走分级审批卡；其它 input 请求保留通用选项按钮
  const isToolApproval =
    inputRequest.display === "confirmation" ||
    (inputRequest.options?.some((o) => o.id === "approve") &&
      inputRequest.options?.some((o) => o.id === "deny"));

  if (isToolApproval) {
    return (
      <ApprovalDecisionCard
        alreadyResponded={alreadyResponded}
        approvalBlocked={approvalBlocked}
        canRespond={canRespond}
        isPowerShell={isPowerShell}
        prompt={inputRequest.prompt}
        requestId={inputRequest.requestId}
        toolCallId={part.toolCallId}
        respondedSummary={respondedSummary}
        onSubmit={onApprovalSubmit}
      />
    );
  }

  return (
    <section
      aria-label="输入请求"
      className="space-y-3 rounded-md border border-border bg-card p-4 shadow-[0_2px_2px_rgba(0,0,0,0.04)]"
    >
      <p className="text-sm leading-relaxed">{inputRequest.prompt}</p>
      {inputResponse ? (
        <p className="font-medium text-sm text-muted-foreground">
          {respondedSummary}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
          {inputRequest.options?.map((option) => (
            <Button
              disabled={!canRespond}
              key={option.id}
              onClick={() => {
                void onApprovalSubmit({
                  responses: [
                    {
                      optionId: option.id,
                      requestId: inputRequest.requestId,
                    },
                  ],
                });
              }}
              size="sm"
              type="button"
              variant={option.style === "danger" ? "destructive" : "default"}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
