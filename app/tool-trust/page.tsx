"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeftIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldIcon,
  Trash2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  loadChatSession,
  type ChatAgentId,
  type StoredBinding,
} from "@/app/_components/chat-session-storage";
import { AGENT_IDS, type AgentId } from "@nianagent/agent-core/model-catalog";
import { cn } from "@/lib/utils";

type RuleRow = {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly toolName: string;
  readonly matchType: string;
  readonly pattern: string;
  readonly logicalCwd: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
};

type AgentContext = {
  readonly agentId: AgentId;
  readonly capability: string;
  readonly binding: StoredBinding;
};

function isAgentId(v: string): v is AgentId {
  return (AGENT_IDS as readonly string[]).includes(v);
}

function isChatAgentId(v: string): v is ChatAgentId {
  return v === "knowledge-base" || v === "work-assistant";
}

const AGENT_LABEL: Record<AgentId, string> = {
  "knowledge-base": "知识库管理员",
  "work-assistant": "工作助理",
};

/** 扫描 sessionStorage：所有已绑定 Agent（不固定优先某一侧）。 */
function listBoundContexts(): AgentContext[] {
  const out: AgentContext[] = [];
  for (const id of AGENT_IDS) {
    if (!isChatAgentId(id)) continue;
    const snap = loadChatSession(id);
    if (snap?.capability && snap.binding) {
      out.push({
        agentId: snap.binding.agentId,
        capability: snap.capability,
        binding: snap.binding,
      });
    }
  }
  return out;
}

/**
 * 解析管理页上下文：
 * 1) URL ?agent= 指定且该 Agent 有绑定 → 用之；
 * 2) 否则仅一个绑定 → 用之；
 * 3) 多个绑定且无合法指定 → null（要求用户选择，禁止静默落到 knowledge-base）。
 */
function resolveInitialAgentId(
  preferred: string | null,
  bound: readonly AgentContext[],
): AgentId | null {
  if (preferred && isAgentId(preferred)) {
    const hit = bound.find((b) => b.agentId === preferred);
    if (hit) return hit.agentId;
  }
  if (bound.length === 1) return bound[0].agentId;
  return null;
}

function ToolTrustPageInner() {
  const searchParams = useSearchParams();
  const agentParam = searchParams.get("agent");

  const [boundList, setBoundList] = useState<AgentContext[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);
  const [rules, setRules] = useState<readonly RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const bound = listBoundContexts();
    setBoundList(bound);
    setSelectedAgentId(resolveInitialAgentId(agentParam, bound));
  }, [agentParam]);

  const ctx = useMemo(() => {
    if (!selectedAgentId) return null;
    return boundList.find((b) => b.agentId === selectedAgentId) ?? null;
  }, [boundList, selectedAgentId]);

  const loadRules = useCallback(async () => {
    if (!ctx) {
      setLoading(false);
      setRules([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // capability 走请求头，避免出现在 URL / 访问日志
      const qs = new URLSearchParams({ agentId: ctx.agentId });
      const res = await fetch(`/api/tool-trust-rules?${qs.toString()}`, {
        headers: {
          "x-nianagent-workspace-capability": ctx.capability,
        },
      });
      const body = (await res.json()) as {
        ok?: boolean;
        rules?: RuleRow[];
        error?: { message?: string };
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error?.message ?? `加载失败 HTTP ${res.status}`);
      }
      setRules(body.rules ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const rootsLabel = useMemo(() => {
    if (!ctx) return "";
    return ctx.binding.roots.map((r) => r.displayPath).join("；");
  }, [ctx]);

  const setEnabled = async (id: string, enabled: boolean) => {
    if (!ctx) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/tool-trust-rules/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: ctx.agentId,
          capability: ctx.capability,
          enabled,
        }),
      });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(body.error?.message ?? `更新失败 HTTP ${res.status}`);
      }
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const removeRule = async (id: string) => {
    if (!ctx) return;
    if (!window.confirm("确定删除这条信任规则？删除后匹配调用将重新询问。")) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/tool-trust-rules/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: ctx.agentId,
          capability: ctx.capability,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new Error(body.error?.message ?? `删除失败 HTTP ${res.status}`);
      }
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const chatHref =
    ctx && isAgentId(ctx.agentId) ? `/${ctx.agentId}` : "/knowledge-base";

  const onSelectAgent = (id: AgentId) => {
    setSelectedAgentId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("agent", id);
    window.history.replaceState(null, "", url.toString());
  };

  const enabledCount = rules.filter((r) => r.enabled).length;
  const disabledCount = rules.length - enabledCount;

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild size="sm" variant="ghost" className="-ml-2 shrink-0">
              <Link href={chatHref}>
                <ArrowLeftIcon className="size-3.5" />
                返回聊天
              </Link>
            </Button>
            <div className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ShieldIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <h1 className="truncate font-medium text-sm sm:text-base">
                  工具信任规则
                </h1>
              </div>
            </div>
          </div>
          {ctx ? (
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => void loadRules()}
            >
              {loading ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3.5" />
              )}
              <span className="hidden sm:inline">刷新</span>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
          管理本工作区通过审批「记住」写入的 exact 规则。禁用或删除后，匹配调用会重新询问。
        </p>

        {boundList.length === 0 ? (
          <EmptyPanel
            title="尚未绑定工作区"
            description="请先在聊天页绑定目录，再管理信任规则。"
            action={
              <Button asChild size="sm">
                <Link href="/knowledge-base">前往知识库聊天</Link>
              </Button>
            }
          />
        ) : !ctx ? (
          <EmptyPanel
            title="选择要管理的 Agent"
            description="多个 Agent 已绑定工作区。请选择其一查看和修改对应规则。"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {boundList.map((b) => (
                  <Button
                    key={b.agentId}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => onSelectAgent(b.agentId)}
                  >
                    {AGENT_LABEL[b.agentId] ?? b.agentId}
                  </Button>
                ))}
              </div>
            }
          />
        ) : (
          <>
            {/* 上下文条 */}
            <section className="rounded-md border border-border bg-card p-4 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <p className="text-[12px] font-medium text-muted-foreground">
                    当前 Agent
                  </p>
                  <p className="font-medium text-sm">
                    {AGENT_LABEL[ctx.agentId] ?? ctx.agentId}
                    <span className="ml-2 font-mono text-[12px] font-normal text-muted-foreground">
                      {ctx.agentId}
                    </span>
                  </p>
                  <p className="break-all text-[12px] text-muted-foreground leading-relaxed">
                    工作区 {rootsLabel || ctx.binding.workspaceId}
                  </p>
                </div>
                {boundList.length > 1 ? (
                  <div
                    className="flex flex-wrap gap-1"
                    role="tablist"
                    aria-label="切换 Agent"
                  >
                    {boundList.map((b) => {
                      const active = b.agentId === ctx.agentId;
                      return (
                        <button
                          key={b.agentId}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={cn(
                            "rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active
                              ? "border-foreground/15 bg-foreground text-background"
                              : "border-border/70 bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                          )}
                          onClick={() => onSelectAgent(b.agentId)}
                        >
                          {AGENT_LABEL[b.agentId] ?? b.agentId}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {!loading && rules.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border/70 pt-3 text-[12px] text-muted-foreground">
                  <span>
                    共{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {rules.length}
                    </span>{" "}
                    条
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    启用{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {enabledCount}
                    </span>
                  </span>
                  {disabledCount > 0 ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        已禁用{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {disabledCount}
                        </span>
                      </span>
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>

            {error ? (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-3 text-destructive text-sm"
                role="alert"
              >
                <p className="min-w-0 leading-relaxed">{error}</p>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => void loadRules()}
                >
                  重试
                </Button>
              </div>
            ) : null}

            {loading ? (
              <div className="flex items-center gap-2 py-12 text-muted-foreground text-sm">
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
                加载规则…
              </div>
            ) : rules.length === 0 ? (
              <EmptyPanel
                title="暂无已信任规则"
                description="在审批时选择「记住到本工作区」后，规则会出现在这里。"
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href={chatHref}>返回聊天继续使用</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-3" aria-label="信任规则列表">
                {rules.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    busy={busyId === rule.id}
                    onToggle={() => void setEnabled(rule.id, !rule.enabled)}
                    onDelete={() => void removeRule(rule.id)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function EmptyPanel({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-md border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
        <ShieldIcon className="size-4" aria-hidden />
      </div>
      <p className="font-medium text-sm">{title}</p>
      <p className="mt-1 max-w-sm text-muted-foreground text-sm leading-relaxed">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function RuleCard({
  rule,
  busy,
  onToggle,
  onDelete,
}: {
  readonly rule: RuleRow;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onDelete: () => void;
}) {
  const showCwd = rule.toolName === "powershell";
  return (
    <li
      className={cn(
        "rounded-md border border-border bg-card p-4 shadow-[0_2px_2px_rgba(0,0,0,0.04)]",
        !rule.enabled && "opacity-75",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] font-medium">
              {rule.toolName}
            </code>
            <Badge
              variant={rule.enabled ? "secondary" : "outline"}
              className="text-[11px]"
            >
              {rule.enabled ? "启用" : "已禁用"}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {rule.matchType}
            </span>
          </div>
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-muted-foreground">
              pattern
            </p>
            <p
              className="break-all font-mono text-[12px] leading-relaxed"
              title={rule.pattern}
            >
              {rule.pattern}
            </p>
          </div>
          {showCwd ? (
            <div className="space-y-1">
              <p className="text-[12px] font-medium text-muted-foreground">
                逻辑 cwd
              </p>
              <p
                className="break-all font-mono text-[12px] leading-relaxed text-muted-foreground"
                title={rule.logicalCwd ?? ""}
              >
                {rule.logicalCwd ?? "—"}
              </p>
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground tabular-nums">
            创建于 {formatTime(rule.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
          <Button
            disabled={busy}
            size="sm"
            type="button"
            variant="outline"
            onClick={onToggle}
          >
            {busy ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : null}
            {rule.enabled ? "禁用规则" : "启用规则"}
          </Button>
          <Button
            disabled={busy}
            size="sm"
            type="button"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2Icon className="size-3.5" />
            删除
          </Button>
        </div>
      </div>
    </li>
  );
}

export default function ToolTrustPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-background">
          <p className="inline-flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
            加载中…
          </p>
        </main>
      }
    >
      <ToolTrustPageInner />
    </Suspense>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
