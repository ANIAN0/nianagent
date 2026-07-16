"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon, LibraryBigIcon, ListTodoIcon } from "lucide-react";
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
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import type { PublicModelCatalogEntry } from "@nianagent/agent-core/model-catalog";
import { MODEL_SELECTION_HEADER } from "@nianagent/agent-core/model-selection";
import { AgentMessage } from "./agent-message";

type AgentId = "knowledge-base" | "work-assistant";

const AGENTS: Record<AgentId, { href: string; label: string }> = {
  "knowledge-base": { href: "/knowledge-base", label: "知识库管理员" },
  "work-assistant": { href: "/work-assistant", label: "工作助手" },
};

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
      <PromptInputSubmit onStop={agent.stop} status={agent.status} />
    </PromptInput>
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {isEmpty ? null : (
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-muted-foreground text-sm">{activeAgent.label}</span>
            <StatusDot status={agent.status} />
          </span>
          <div className="flex items-center gap-3">
            <ModelSelector
              disabled={isBusy}
              modelId={modelId}
              models={models}
              onChange={setModelId}
            />
            <AgentSwitcher agentId={agentId} />
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
          <div className="flex flex-col items-center gap-3 text-center">
            <AgentIcon agentId={agentId} />
            <h1 className="font-medium text-5xl tracking-tighter">{activeAgent.label}</h1>
            <div className="flex items-center gap-3">
              <ModelSelector
                disabled={isBusy}
                modelId={modelId}
                models={models}
                onChange={setModelId}
              />
              <AgentSwitcher agentId={agentId} />
            </div>
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
    <select
      aria-label="选择模型"
      className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      value={modelId}
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  );
}

function AgentIcon({ agentId }: { readonly agentId: AgentId }) {
  const Icon = agentId === "knowledge-base" ? LibraryBigIcon : ListTodoIcon;

  return <Icon className="size-8 text-muted-foreground" />;
}

function AgentSwitcher({ agentId }: { readonly agentId: AgentId }) {
  return (
    <nav className="flex items-center gap-2 text-sm text-muted-foreground">
      {(Object.entries(AGENTS) as [AgentId, (typeof AGENTS)[AgentId]][]).map(([id, item]) =>
        id === agentId ? (
          <span key={id}>{item.label}</span>
        ) : (
          <Link className="underline underline-offset-4" href={item.href} key={id}>
            {item.label}
          </Link>
        ),
      )}
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
