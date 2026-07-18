"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkflowDebugAgent } from "../agent-context";
import { workflowDebugRpc } from "../rpc-client";
import { t } from "../i18n/zh-CN";

type ActionKey =
  | "cancelRun"
  | "recreateRun"
  | "reenqueueRun"
  | "wakeUpRun"
  | "runHealthCheck";

const ACTIONS: { key: ActionKey; label: string; method: string }[] = [
  { key: "cancelRun", label: t("actionCancelRun"), method: "cancelRun" },
  { key: "recreateRun", label: t("actionRecreate"), method: "recreateRun" },
  { key: "reenqueueRun", label: t("actionReenqueue"), method: "reenqueueRun" },
  { key: "wakeUpRun", label: t("actionWake"), method: "wakeUpRun" },
  { key: "runHealthCheck", label: t("actionHealth"), method: "runHealthCheck" },
];

export function RunActions({
  runId,
  onDone,
}: {
  readonly runId: string;
  readonly onDone: () => void;
}) {
  const { agentId } = useWorkflowDebugAgent();
  const [pending, setPending] = useState<ActionKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const execute = async (action: (typeof ACTIONS)[number]) => {
    setBusy(true);
    setMessage(null);
    try {
      // 健康检查端点仅 workflow|step（与 Eve helpers 一致）
      const params =
        action.method === "runHealthCheck"
          ? { endpoint: "workflow", options: { namespace: "eve" } }
          : { runId };
      const result = await workflowDebugRpc(agentId, action.method, params);
      if (!result.success) {
        setMessage(result.error.message);
        return;
      }
      if (action.method === "runHealthCheck") {
        const data = result.data as
          | { healthy?: boolean; error?: string; message?: string }
          | null
          | undefined;
        if (data && data.healthy === false) {
          setMessage(
            `${t("healthFail")}${data.error ? `：${data.error}` : ""}`,
          );
          // 不乐观刷新；仍回调以拉取真实 world 状态
          onDone();
          return;
        }
        setMessage(t("healthOk"));
        onDone();
        return;
      }
      setMessage("OK");
      onDone();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">{t("sectionActions")}</p>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <Button
            className="h-8 text-xs"
            disabled={busy}
            key={a.key}
            onClick={() => setPending(a.key)}
            size="sm"
            type="button"
            variant="outline"
          >
            {a.label}
          </Button>
        ))}
      </div>
      {message ? (
        <p className="text-muted-foreground text-xs" role="status">
          {message}
        </p>
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        open={pending !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>{t("actionConfirmHint")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => setPending(null)}
              type="button"
              variant="ghost"
            >
              {t("confirmCancel")}
            </Button>
            <Button
              disabled={busy || !pending}
              onClick={() => {
                const a = ACTIONS.find((x) => x.key === pending);
                if (a) void execute(a);
              }}
              type="button"
            >
              {t("confirmOk")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
