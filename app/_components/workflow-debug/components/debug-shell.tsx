"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentId } from "@nianagent/agent-core/model-catalog";
import { useWorkflowDebugAgent } from "../agent-context";
import { workflowDebugRpc } from "../rpc-client";
import { t } from "../i18n/zh-CN";
import { SectionTabs } from "./section-tabs";
import { cn } from "@/lib/utils";

type BridgeState = "probing" | "ok" | "fail";

export function DebugShell({
  children,
  onRefresh,
  refreshing,
}: {
  readonly children: ReactNode;
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
}) {
  const { agentId, setAgentId, agents } = useWorkflowDebugAgent();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get("tab") ?? "runs";
  const chatHref =
    agentId === "work-assistant" ? "/work-assistant" : "/knowledge-base";
  const [bridge, setBridge] = useState<BridgeState>("probing");

  const probeBridge = useCallback(async () => {
    setBridge("probing");
    try {
      // 轻量读：证明同源代理 → Agent getWorld 通路可用
      const result = await workflowDebugRpc(agentId, "getPublicServerConfig", {});
      setBridge(result.success ? "ok" : "fail");
    } catch {
      setBridge("fail");
    }
  }, [agentId]);

  useEffect(() => {
    void probeBridge();
  }, [probeBridge]);

  // URL 与右上角 Agent 选择同步：每个 Agent 独立 World，深链必须带 agent
  useEffect(() => {
    if (searchParams.get("agent") === agentId) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("agent", agentId);
    router.replace(`${pathname}?${next.toString()}`);
  }, [agentId, pathname, router, searchParams]);

  const changeAgent = (nextAgent: AgentId) => {
    setAgentId(nextAgent);
    const next = new URLSearchParams(searchParams.toString());
    next.set("agent", nextAgent);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", value);
    next.set("agent", agentId);
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 sm:gap-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Button asChild className="h-8 gap-1.5 px-2" size="sm" variant="ghost">
            <Link href={chatHref}>
              <ArrowLeftIcon className="size-3.5" />
              <span className="hidden sm:inline">{t("backToChat")}</span>
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate font-medium text-sm tracking-tight">
              {t("appTitle")}
            </h1>
            <p className="hidden truncate text-muted-foreground text-xs sm:block">
              {t("appSubtitle")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] sm:inline-flex",
              bridge === "ok" &&
                "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
              bridge === "fail" &&
                "border-destructive/40 bg-destructive/10 text-destructive",
              bridge === "probing" && "text-muted-foreground",
            )}
            role="status"
            title={t("preflightHint")}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                bridge === "ok" && "bg-emerald-600 dark:bg-emerald-400",
                bridge === "fail" && "bg-destructive",
                bridge === "probing" &&
                  "animate-pulse bg-muted-foreground motion-reduce:animate-none",
              )}
            />
            {bridge === "ok"
              ? t("bridgeConnected")
              : bridge === "fail"
                ? t("bridgeDisconnected")
                : t("bridgeProbing")}
          </span>
          <span className="hidden text-muted-foreground text-xs sm:inline">
            {t("agentLabel")}
          </span>
          <Select
            onValueChange={(v) => changeAgent(v as AgentId)}
            value={agentId}
          >
            <SelectTrigger aria-label={t("agentLabel")} className="h-8 w-[10rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            aria-label={t("refresh")}
            className="h-8 px-2"
            disabled={refreshing}
            onClick={() => {
              void probeBridge();
              onRefresh?.();
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RefreshCwIcon
              className={cn(
                "size-3.5",
                (refreshing || bridge === "probing") && "animate-spin",
              )}
            />
          </Button>
        </div>
      </header>

      {!pathname.includes("/workflow-debug/") ||
      pathname.endsWith("/workflow-debug") ? (
        <div className="mx-auto w-full max-w-7xl border-b px-4 py-3 sm:px-6">
          <SectionTabs
            ariaLabel="调试分区"
            items={[
              { id: "runs", label: t("tabRuns") },
              { id: "hooks", label: t("tabHooks") },
              { id: "workflows", label: t("tabWorkflows") },
            ]}
            onChange={setTab}
            value={tab}
          />
        </div>
      ) : null}

      <div
        className={cn(
          "mx-auto w-full flex-1 px-4 py-4 sm:px-6",
          // Run 详情需要更宽/更高的 Trace 视口
          pathname.includes("/workflow-debug/") &&
            !pathname.endsWith("/workflow-debug")
            ? "max-w-[100rem]"
            : "max-w-7xl",
        )}
      >
        {children}
      </div>
    </div>
  );
}
