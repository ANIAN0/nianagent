"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AgentId } from "@nianagent/agent-core/model-catalog";
import { t } from "./i18n/zh-CN";

const AGENTS: { id: AgentId; label: string }[] = [
  { id: "knowledge-base", label: t("agentKnowledgeBase") },
  { id: "work-assistant", label: t("agentWorkAssistant") },
];

type AgentCtx = {
  readonly agentId: AgentId;
  readonly setAgentId: (id: AgentId) => void;
  readonly agents: typeof AGENTS;
};

const Ctx = createContext<AgentCtx | null>(null);

export function WorkflowDebugAgentProvider({
  initialAgent,
  children,
}: {
  readonly initialAgent?: AgentId;
  readonly children: ReactNode;
}) {
  const [agentId, setAgentIdState] = useState<AgentId>(
    initialAgent === "work-assistant" ? "work-assistant" : "knowledge-base",
  );
  const setAgentId = useCallback((id: AgentId) => {
    setAgentIdState(id);
  }, []);
  const value = useMemo(
    () => ({
      agentId,
      setAgentId,
      agents: AGENTS,
    }),
    [agentId, setAgentId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkflowDebugAgent(): AgentCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useWorkflowDebugAgent 必须在 WorkflowDebugAgentProvider 内使用",
    );
  }
  return ctx;
}
