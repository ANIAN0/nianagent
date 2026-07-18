"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import {
  AlertCircleIcon,
  BotIcon,
  BugIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  LibraryBigIcon,
  ListTodoIcon,
  PlusIcon,
  ShieldIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { PublicModelCatalogEntry } from "@nianagent/agent-core/model-catalog";
import { MODEL_SELECTION_HEADER } from "@nianagent/agent-core/model-selection";
import {
  SESSION_ACCEPT_EDITS_HEADER,
  SESSION_GLOBAL_BYPASS_HEADER,
  TRUST_CALL_ID_HEADER,
  TRUST_SCOPE_HEADER,
  WORKSPACE_CAPABILITY_HEADER,
} from "@nianagent/agent-core/workspace-constants";
import { AgentMessage } from "./agent-message";
import {
  clearChatSession,
  INSTALLED_EVE_VERSION,
  loadChatSession,
  saveChatSession,
  type ChatAgentId,
  type ChatSessionSnapshot,
  type StoredBinding,
} from "./chat-session-storage";
import {
  buildChatExportDocument,
  exportChatAsJson,
  exportChatAsMarkdown,
} from "./chat-export";
import {
  WorkspaceBindingForm,
  type BindingSuccess,
} from "./workspace-binding-form";
import {
  SessionPermissionControls,
  type SessionModes,
} from "./session-permission-controls";
import type { ApprovalSubmitPayload } from "./approval-decision-card";

type AgentId = ChatAgentId;

const AGENTS: Record<
  AgentId,
  { href: string; icon: LucideIcon; label: string; description: string }
> = {
  "knowledge-base": {
    href: "/knowledge-base",
    icon: LibraryBigIcon,
    label: "知识库管理员",
    description: "知识沉淀与检索",
  },
  "work-assistant": {
    href: "/work-assistant",
    icon: ListTodoIcon,
    label: "工作助手",
    description: "任务与日常协作",
  },
};

const AGENT_LIST = Object.entries(AGENTS) as [
  AgentId,
  (typeof AGENTS)[AgentId],
][];

/** 顶栏三个会话操作固定使用同一文字尺度，避免组件默认样式造成视觉分级。 */
const HEADER_ACTION_CLASS_NAME =
  "h-8 gap-1.5 px-2 !text-sm !leading-5 text-muted-foreground hover:text-foreground";

type AgentStatus = ReturnType<typeof useEveAgent>["status"];

function readInitialSnapshot(agentId: AgentId): ChatSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  return loadChatSession(agentId);
}

/**
 * 已绑定后的会话区：用 key 强制在 binding/session 变化时重建 useEveAgent。
 */
function BoundAgentChat({
  agentId,
  models,
  binding,
  capability,
  initialSession,
  initialEvents,
  sessionEpoch,
  onNewSession,
}: {
  readonly agentId: AgentId;
  readonly models: readonly PublicModelCatalogEntry[];
  readonly binding: StoredBinding;
  readonly capability: string;
  readonly initialSession: unknown;
  readonly initialEvents: readonly unknown[];
  readonly sessionEpoch: string;
  /** 丢弃 Eve cursor、保留工作区绑定，开始新对话 */
  readonly onNewSession: () => void;
}) {
  const [modelId, setModelId] = useState(models[0]!.id);
  const modelIdRef = useRef(modelId);
  modelIdRef.current = modelId;
  const capabilityRef = useRef(capability);
  capabilityRef.current = capability;
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  // 用 ref 跟踪最新 session/events，避免闭包陈旧（须在 useEveAgent 前回填）
  const sessionRef = useRef<unknown>(initialSession);
  const eventsRef = useRef<unknown[]>([...initialEvents]);

  // 会话模式：无 sessionId 时用 pending；有 id 后 PATCH 固化
  const [pendingModes, setPendingModes] = useState<SessionModes>({
    acceptEdits: false,
    globalBypass: false,
  });
  const [modesSolidified, setModesSolidified] = useState(false);
  const [modeSyncing, setModeSyncing] = useState(false);
  const [modeSyncError, setModeSyncError] = useState<string | null>(null);
  const modesRef = useRef(pendingModes);
  modesRef.current = pendingModes;
  const modesSolidifiedRef = useRef(modesSolidified);
  modesSolidifiedRef.current = modesSolidified;
  const solidifyInFlight = useRef(false);

  const agent = useEveAgent({
    agent: agentId,
    headers: () => {
      const headers: Record<string, string> = {
        [MODEL_SELECTION_HEADER]: modelIdRef.current,
        [WORKSPACE_CAPABILITY_HEADER]: capabilityRef.current,
      };
      // 未固化成功前：每条 send 带模式意图头（D-008 首 turn）
      if (!modesSolidifiedRef.current) {
        headers[SESSION_ACCEPT_EDITS_HEADER] = modesRef.current.acceptEdits
          ? "1"
          : "0";
        headers[SESSION_GLOBAL_BYPASS_HEADER] = modesRef.current.globalBypass
          ? "1"
          : "0";
      }
      return headers;
    },
    // 完整 Eve session cursor + event log，禁止仅恢复消息文本
    initialSession: (initialSession ?? undefined) as never,
    initialEvents: (initialEvents ?? undefined) as never,
    onSessionChange: (session) => {
      sessionRef.current = session;
      saveChatSession(agentId, {
        binding: bindingRef.current,
        capability: capabilityRef.current,
        session,
        events: eventsRef.current,
      });
    },
    onEvent: (event) => {
      eventsRef.current = [...eventsRef.current, event];
      saveChatSession(agentId, {
        binding: bindingRef.current,
        capability: capabilityRef.current,
        session: sessionRef.current,
        events: eventsRef.current,
      });
    },
  });

  sessionRef.current = agent.session;
  eventsRef.current = [...agent.events];

  const sessionId =
    typeof agent.session?.sessionId === "string" && agent.session.sessionId
      ? agent.session.sessionId
      : undefined;

  const patchSessionModes = useCallback(
    async (modes: SessionModes, sid: string) => {
      setModeSyncing(true);
      setModeSyncError(null);
      try {
        const res = await fetch("/api/session-permissions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            capability: capabilityRef.current,
            agentId,
            sessionId: sid,
            acceptEdits: modes.acceptEdits,
            globalBypass: modes.globalBypass,
          }),
        });
        const body = (await res.json()) as { error?: { message?: string } };
        if (!res.ok) {
          throw new Error(body.error?.message ?? `HTTP ${res.status}`);
        }
        setModesSolidified(true);
        setModeSyncError(null);
      } catch (err) {
        setModesSolidified(false);
        setModeSyncError(err instanceof Error ? err.message : String(err));
      } finally {
        setModeSyncing(false);
      }
    },
    [agentId],
  );

  // 获得真实 sessionId：优先 GET 已有行（刷新恢复）；无行则 PATCH 固化当前 pending
  useEffect(() => {
    if (!sessionId || modesSolidified || solidifyInFlight.current) return;
    solidifyInFlight.current = true;
    void (async () => {
      try {
        // capability 走请求头，避免出现在 URL / 访问日志
        const qs = new URLSearchParams({
          agentId,
          sessionId,
        });
        const res = await fetch(`/api/session-permissions?${qs.toString()}`, {
          headers: {
            [WORKSPACE_CAPABILITY_HEADER]: capabilityRef.current,
          },
        });
        if (res.ok) {
          const body = (await res.json()) as {
            ok?: boolean;
            state?: {
              acceptEdits?: boolean;
              globalBypass?: boolean;
              updatedAt?: string;
            };
          };
          // 有真实库行（updatedAt 非 epoch 0）则恢复 UI 并视为已固化
          if (
            body.ok &&
            body.state &&
            body.state.updatedAt &&
            body.state.updatedAt !== new Date(0).toISOString()
          ) {
            const restored: SessionModes = {
              acceptEdits: Boolean(body.state.acceptEdits),
              globalBypass: Boolean(body.state.globalBypass),
            };
            setPendingModes(restored);
            modesRef.current = restored;
            setModesSolidified(true);
            setModeSyncError(null);
            return;
          }
        }
        await patchSessionModes(modesRef.current, sessionId);
      } catch {
        await patchSessionModes(modesRef.current, sessionId);
      } finally {
        solidifyInFlight.current = false;
      }
    })();
  }, [sessionId, modesSolidified, patchSessionModes, agentId]);

  const handleModesChange = useCallback(
    (next: SessionModes) => {
      setPendingModes(next);
      modesRef.current = next;
      if (sessionId && modesSolidified) {
        void patchSessionModes(next, sessionId);
      }
      // 无 sessionId 或未固化：仅 pending；下一条 send 带头
    },
    [sessionId, modesSolidified, patchSessionModes],
  );

  const handleApprovalSubmit = useCallback(
    async (payload: ApprovalSubmitPayload) => {
      const headers: Record<string, string> = {};
      if (payload.trustScope) {
        headers[TRUST_SCOPE_HEADER] = payload.trustScope;
      }
      // callId 用于 pending 精确绑定 / deny 清理（与 requestId 可能不同）
      if (payload.toolCallId?.trim()) {
        headers[TRUST_CALL_ID_HEADER] = payload.toolCallId.trim();
      }
      await agent.send({
        inputResponses: payload.responses,
        message: payload.message,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
    },
    [agent],
  );

  const activeAgent = AGENTS[agentId];
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

  const handleExport = (format: "json" | "md") => {
    const doc = buildChatExportDocument({
      agentId,
      binding: bindingRef.current,
      session: sessionRef.current,
      events: eventsRef.current,
      messages: agent.data.messages,
    });
    if (format === "json") exportChatAsJson(doc, agentId);
    else exportChatAsMarkdown(doc, agentId);
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isBusy) return;

    if (message.files.length === 0) {
      await agent.send({ message: text });
      return;
    }

    const parts: UserContent = [];
    if (text.length > 0) {
      parts.push({ text, type: "text" });
    }
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }

    await agent.send({ message: parts });
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder="发送消息…" />
      <PromptInputFooter>
        <PromptInputTools>
          <SessionPermissionControls
            modes={pendingModes}
            syncError={modeSyncError}
            syncing={modeSyncing}
            onChange={handleModesChange}
            onRetrySync={
              sessionId
                ? () => void patchSessionModes(pendingModes, sessionId)
                : undefined
            }
          />
          <ModelSelector
            disabled={isBusy}
            modelId={modelId}
            models={models}
            onChange={setModelId}
          />
        </PromptInputTools>
        <PromptInputSubmit
          className="static right-auto bottom-auto"
          onStop={agent.stop}
          status={agent.status}
        />
      </PromptInputFooter>
    </PromptInput>
  );

  return (
    <main
      className="flex h-dvh flex-col overflow-hidden bg-background text-foreground"
      data-session-epoch={sessionEpoch}
    >
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2 sm:gap-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-2.5">
          <AgentSwitcher agentId={agentId} compact />
          <StatusDot status={agent.status} />
          <RootsBadge roots={binding.roots} />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Button
            asChild
            className={HEADER_ACTION_CLASS_NAME}
            size="sm"
            variant="ghost"
          >
            <Link
              href={`/tool-trust?agent=${encodeURIComponent(agentId)}`}
              title="管理本工作区已记住的工具信任规则"
            >
              <ShieldIcon className="size-3.5" />
              <span className="hidden md:inline">工具信任</span>
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="导出当前会话"
                className={HEADER_ACTION_CLASS_NAME}
                disabled={isEmpty}
                size="sm"
                type="button"
                variant="ghost"
              >
                <DownloadIcon className="size-3.5" />
                <span className="hidden sm:inline">导出</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                className="cursor-pointer"
                disabled={isEmpty}
                onClick={() => handleExport("md")}
              >
                下载 Markdown
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                disabled={isEmpty}
                onClick={() => handleExport("json")}
              >
                下载 JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            asChild
            className={HEADER_ACTION_CLASS_NAME}
            size="sm"
            variant="ghost"
          >
            <Link href={`/workflow-debug?agent=${agentId}`}>
              <BugIcon className="size-3.5" />
              <span className="hidden md:inline">调试</span>
            </Link>
          </Button>
          <Button
            aria-label="新对话（保留工作区绑定）"
            className={HEADER_ACTION_CLASS_NAME}
            onClick={onNewSession}
            size="sm"
            title="丢弃当前 Eve 会话，保留已绑定工作区"
            type="button"
            variant="ghost"
          >
            <PlusIcon className="size-3.5" />
            <span className="hidden sm:inline">新对话</span>
          </Button>
        </div>
      </header>

      {agent.error ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 sm:px-6">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="font-medium">请求失败</p>
                <p className="mt-0.5 break-words text-muted-foreground">
                  {agent.error.message}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  若刚升级过 eve 或重启过 Agent，升级前会话无法继续（Workflow step
                  名含框架版本）。可点「新对话」保留工作区后重试。
                </p>
              </div>
              <Button
                onClick={onNewSession}
                size="sm"
                type="button"
                variant="outline"
              >
                新对话（保留工作区）
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? null : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6">
            {agent.data.messages.map((message, index) => (
              <AgentMessage
                agentId={agentId}
                canRespond={!isBusy}
                capability={capability}
                isStreaming={
                  agent.status === "streaming" &&
                  index === agent.data.messages.length - 1
                }
                key={message.id}
                message={message}
                onApprovalSubmit={handleApprovalSubmit}
              />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          isEmpty
            ? "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]"
            : "max-w-3xl shrink-0 pb-6",
        )}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex flex-col items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <activeAgent.icon className="size-5" />
              </span>
              <h1 className="font-medium text-4xl tracking-tight text-balance sm:text-5xl">
                {activeAgent.label}
              </h1>
              <p className="max-w-sm text-muted-foreground text-sm text-pretty">
                工作区已绑定。发送消息开始会话；刷新后将恢复同一会话。
              </p>
            </div>
          </div>
        ) : null}
        <div className="w-full">{composer}</div>
      </div>
    </main>
  );
}

export function AgentChat({
  agentId,
  models,
}: {
  readonly agentId: AgentId;
  readonly models: readonly PublicModelCatalogEntry[];
}) {
  // 惰性读取 sessionStorage（仅客户端）
  const [restored] = useState(() => readInitialSnapshot(agentId));
  const [binding, setBinding] = useState<StoredBinding | null>(
    restored?.binding ?? null,
  );
  const [capability, setCapability] = useState<string | null>(
    restored?.capability ?? null,
  );
  const [initialSession, setInitialSession] = useState<unknown>(
    restored?.session ?? null,
  );
  const [initialEvents, setInitialEvents] = useState<readonly unknown[]>(
    restored?.events ?? [],
  );
  // epoch 变化 → 卸载并重建 BoundAgentChat / useEveAgent
  const [sessionEpoch, setSessionEpoch] = useState(
    () =>
      restored
        ? `${restored.binding.workspaceId}:${restored.capability.slice(0, 8)}`
        : "unbound",
  );

  const activeAgent = AGENTS[agentId];
  const ActiveAgentIcon = activeAgent.icon;

  const handleBindingSuccess = useCallback(
    (result: BindingSuccess) => {
      setBinding(result.binding);
      setCapability(result.capability);
      setInitialSession(null);
      setInitialEvents([]);
      const epoch = `${result.binding.workspaceId}:${result.capability.slice(0, 8)}`;
      setSessionEpoch(epoch);
      saveChatSession(agentId, {
        binding: result.binding,
        capability: result.capability,
        session: null,
        events: [],
        eveVersion: INSTALLED_EVE_VERSION,
      });
    },
    [agentId],
  );

  /**
   * 新对话：保留 workspace binding，丢弃 Eve continuation（升级/失效会话的恢复路径）。
   * 需要换目录时再清 binding（见下方未绑定态重新绑定）。
   */
  const handleNewSession = useCallback(() => {
    if (binding && capability) {
      setInitialSession(null);
      setInitialEvents([]);
      setSessionEpoch(
        `${binding.workspaceId}:${capability.slice(0, 8)}:${Date.now()}`,
      );
      saveChatSession(agentId, {
        binding,
        capability,
        session: null,
        events: [],
        eveVersion: INSTALLED_EVE_VERSION,
      });
      return;
    }
    clearChatSession(agentId);
    setBinding(null);
    setCapability(null);
    setInitialSession(null);
    setInitialEvents([]);
    setSessionEpoch(`new:${Date.now()}`);
  }, [agentId, binding, capability]);

  const bound = binding && capability;

  if (!bound) {
    return (
      <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-8 px-4 pb-[10vh] sm:px-6">
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex flex-col items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <ActiveAgentIcon className="size-5" />
              </span>
              <h1 className="font-medium text-4xl tracking-tight text-balance sm:text-5xl">
                {activeAgent.label}
              </h1>
            </div>
            <AgentSwitcher agentId={agentId} />
          </div>
          <div className="w-full rounded-xl border bg-card p-5 shadow-xs">
            <WorkspaceBindingForm
              agentId={agentId}
              onSuccess={handleBindingSuccess}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <BoundAgentChat
      agentId={agentId}
      binding={binding}
      capability={capability}
      initialEvents={initialEvents}
      initialSession={initialSession}
      key={sessionEpoch}
      models={models}
      onNewSession={handleNewSession}
      sessionEpoch={sessionEpoch}
    />
  );
}

function RootsBadge({
  roots,
}: {
  readonly roots: readonly { alias: string; displayPath: string }[];
}) {
  const label = useMemo(
    () => roots.map((r) => r.alias).join(", "),
    [roots],
  );
  return (
    <span
      className="hidden max-w-[14rem] truncate font-mono text-muted-foreground text-xs md:inline"
      title={
        roots.map((r) => `/workspace/${r.alias} → ${r.displayPath}`).join("\n") +
        "\n逻辑路径用于工具；非磁盘挂载、非 OS 沙箱。"
      }
    >
      /workspace/{label}
    </span>
  );
}

function ModelSelector({
  disabled,
  modelId,
  models,
  onChange,
}: {
  readonly disabled: boolean;
  readonly modelId: string;
  readonly models: readonly PublicModelCatalogEntry[];
  readonly onChange: (modelId: string) => void;
}) {
  return (
    <PromptInputSelect
      disabled={disabled}
      onValueChange={onChange}
      value={modelId}
    >
      <PromptInputSelectTrigger
        aria-label="选择模型"
        className="h-8 gap-1.5 px-2 text-xs sm:text-sm"
        size="sm"
      >
        <BotIcon className="size-3.5 shrink-0 opacity-70" />
        <PromptInputSelectValue placeholder="选择模型" />
      </PromptInputSelectTrigger>
      <PromptInputSelectContent align="start" position="popper">
        {models.map((model) => (
          <PromptInputSelectItem key={model.id} value={model.id}>
            {model.label}
          </PromptInputSelectItem>
        ))}
      </PromptInputSelectContent>
    </PromptInputSelect>
  );
}

function AgentSwitcher({
  agentId,
  compact = false,
}: {
  readonly agentId: AgentId;
  readonly compact?: boolean;
}) {
  const active = AGENTS[agentId];
  const ActiveIcon = active.icon;

  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="切换 Agent"
            className="h-8 max-w-[min(100%,16rem)] gap-1.5 px-2 font-medium text-muted-foreground hover:text-foreground"
            size="sm"
            type="button"
            variant="ghost"
          >
            <ActiveIcon className="size-3.5 shrink-0" />
            <span className="truncate">{active.label}</span>
            <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {AGENT_LIST.map(([id, item]) => {
            const Icon = item.icon;
            const selected = id === agentId;
            return (
              <DropdownMenuItem
                asChild
                className="cursor-pointer gap-2"
                key={id}
              >
                <Link href={item.href}>
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.label}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {item.description}
                    </span>
                  </span>
                  {selected ? (
                    <CheckIcon className="size-4 shrink-0 text-foreground" />
                  ) : null}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <nav
      aria-label="选择 Agent"
      className="inline-flex items-center rounded-lg bg-muted/80 p-0.5 ring-1 ring-border/60"
    >
      {AGENT_LIST.map(([id, item]) => {
        const Icon = item.icon;
        const selected = id === agentId;
        const className = cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
          selected
            ? "bg-background font-medium text-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground",
        );

        if (selected) {
          return (
            <span aria-current="page" className={className} key={id}>
              <Icon className="size-3.5 shrink-0" />
              {item.label}
            </span>
          );
        }

        return (
          <Link className={className} href={item.href} key={id}>
            <Icon className="size-3.5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function StatusDot({ status }: { readonly status: AgentStatus }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone =
    status === "error"
      ? "bg-destructive"
      : isLive
        ? "bg-emerald-600 dark:bg-emerald-400"
        : status === "ready"
          ? "bg-muted-foreground"
          : "bg-muted-foreground/50";

  const label =
    status === "error"
      ? "错误"
      : isLive
        ? "生成中"
        : status === "ready"
          ? "就绪"
          : "空闲";

  return (
    <span
      aria-label={label}
      className="relative flex size-1.5"
      role="status"
      title={label}
    >
      {isLive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75 motion-reduce:animate-none",
            tone,
          )}
        />
      ) : null}
      <span
        className={cn(
          "relative inline-flex size-1.5 rounded-full transition-colors",
          tone,
        )}
      />
    </span>
  );
}
