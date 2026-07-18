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

type EveFilePart = Extract<EveMessagePart, { type: "file" }>;

export function AgentMessage({
  agentId,
  canRespond,
  capability,
  isStreaming,
  message,
  onInputResponses,
}: {
  readonly agentId: string;
  readonly canRespond: boolean;
  readonly capability: string;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
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
            onInputResponses={onInputResponses}
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
  onInputResponses,
  part,
  showCaret,
}: {
  readonly agentId: string;
  readonly canRespond: boolean;
  readonly capability: string;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
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
          onInputResponses={onInputResponses}
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
  onInputResponses,
  part,
}: {
  readonly agentId: string;
  readonly canRespond: boolean;
  readonly capability: string;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const forceOpen = toolShouldForceOpen(part.state);
  const powerShellTool = isPowerShellTool(part.toolName);
  const [open, setOpen] = useState(forceOpen);
  const [hostCwdVerified, setHostCwdVerified] = useState(!powerShellTool);

  // 状态转入错误/审批时重新展开（defaultOpen 只在首挂生效）
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen, part.state, part.toolCallId]);

  // 每次新工具调用都要求重新解析宿主 cwd，不能沿用上一条命令的结果。
  useEffect(() => {
    setHostCwdVerified(!powerShellTool);
  }, [part.toolCallId, powerShellTool]);

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
            onHostCwdVerifiedChange={setHostCwdVerified}
            part={part}
          />
        ) : (
          <ToolInput input={part.input} />
        )}
        <InputRequestActions
          approvalBlocked={powerShellTool && !hostCwdVerified}
          canRespond={canRespond}
          part={part}
          onInputResponses={onInputResponses}
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
        <div>
          <p className="text-muted-foreground text-xs">目的</p>
          <p className="mt-0.5">{description}</p>
        </div>
      ) : null}
      <div>
        <p className="text-muted-foreground text-xs">命令</p>
        <pre className="mt-0.5 overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
          {command || "（空）"}
        </pre>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground text-xs">逻辑 cwd</p>
          <p className="mt-0.5 break-all font-mono text-xs">{cwd || "（未指定）"}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">解析后的宿主 cwd</p>
          {loading ? (
            <p className="mt-0.5 text-muted-foreground text-xs">解析中…</p>
          ) : previewError ? (
            <p className="mt-0.5 text-destructive text-xs" role="alert">
              {previewError}
            </p>
          ) : hostCwd ? (
            <p className="mt-0.5 break-all font-mono text-xs">{hostCwd}</p>
          ) : (
            <p className="mt-0.5 text-muted-foreground text-xs">—</p>
          )}
        </div>
      </div>
      {alias || displayRoot ? (
        <p className="text-muted-foreground text-xs">
          {alias ? (
            <>
              alias: <span className="font-mono text-foreground">{alias}</span>
            </>
          ) : null}
          {alias && displayRoot ? " · " : null}
          {displayRoot ? (
            <>
              绑定根展示路径:{" "}
              <span className="break-all font-mono text-foreground">{displayRoot}</span>
            </>
          ) : null}
        </p>
      ) : null}
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-amber-900 text-xs dark:text-amber-100/90">
        这不是操作系统沙箱，也不是目录挂载。批准后命令以当前 Windows
        用户权限在解析后的宿主目录中运行。
      </p>
      {outsideHint ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-destructive text-xs"
          role="status"
        >
          命令正文含盘符或 UNC 路径迹象，批准后可能访问绑定目录以外的位置。
        </p>
      ) : null}
      {/* 保留原始 JSON 便于调试，折叠感用 muted 小字 */}
      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer select-none">原始工具输入</summary>
        <div className="mt-1">
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
  onInputResponses,
  part,
}: {
  readonly approvalBlocked: boolean;
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
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

  return (
    <div className="space-y-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
      <p className="text-muted-foreground text-sm">{inputRequest.prompt}</p>
      {inputResponse ? (
        <p className="font-medium text-sm">
          Responded: {selectedOption?.label ?? inputResponse.text ?? inputResponse.optionId}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {inputRequest.options?.map((option) => (
            <Button
              disabled={!canRespond || (approvalBlocked && option.id === "approve")}
              key={option.id}
              onClick={() => {
                void onInputResponses([
                  {
                    optionId: option.id,
                    requestId: inputRequest.requestId,
                  },
                ]);
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
    </div>
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
