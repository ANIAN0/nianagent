"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import {
  AlertCircleIcon,
  BotIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  LibraryBigIcon,
  ListTodoIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
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
import { AgentMessage } from "./agent-message";

type AgentId = "knowledge-base" | "work-assistant";

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

type AgentStatus = ReturnType<typeof useEveAgent>["status"];

export function AgentChat({
  agentId,
  models,
}: {
  readonly agentId: AgentId;
  readonly models: readonly PublicModelCatalogEntry[];
}) {
  const [modelId, setModelId] = useState(models[0]!.id);
  const modelIdRef = useRef(modelId);
  modelIdRef.current = modelId;
  const agent = useEveAgent({
    agent: agentId,
    headers: () => ({ [MODEL_SELECTION_HEADER]: modelIdRef.current }),
  });
  const activeAgent = AGENTS[agentId];
  const ActiveAgentIcon = activeAgent.icon;
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

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
      <PromptInputTextarea placeholder="Send a message…" />
      <PromptInputFooter>
        <PromptInputTools>
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
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {isEmpty ? null : (
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <AgentSwitcher agentId={agentId} compact />
            <StatusDot status={agent.status} />
          </div>
        </header>
      )}

      {agent.error ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 sm:px-6">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Request failed</p>
              <p className="mt-0.5 text-muted-foreground">{agent.error.message}</p>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? null : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6">
            {agent.data.messages.map((message, index) => (
              <AgentMessage
                canRespond={!isBusy}
                isStreaming={
                  agent.status === "streaming" && index === agent.data.messages.length - 1
                }
                key={message.id}
                message={message}
                onInputResponses={(inputResponses) => agent.send({ inputResponses })}
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
                <ActiveAgentIcon className="size-5" />
              </span>
              <h1 className="font-medium text-5xl tracking-tighter">{activeAgent.label}</h1>
            </div>
            <AgentSwitcher agentId={agentId} />
          </div>
        ) : null}
        <div className="w-full">{composer}</div>
      </div>
    </main>
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
                  {selected ? <CheckIcon className="size-4 shrink-0 text-foreground" /> : null}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // 空状态：分段切换，与原版居中标题形成一套克制的产品控件
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
        ? "bg-emerald-500"
        : status === "ready"
          ? "bg-muted-foreground"
          : "bg-muted-foreground/50";

  return (
    <span className="relative flex size-1">
      {isLive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            tone,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-1 rounded-full transition-colors", tone)} />
    </span>
  );
}
