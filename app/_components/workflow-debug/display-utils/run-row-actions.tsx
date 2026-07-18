"use client";

import {
  AlarmClockOffIcon,
  MoreHorizontalIcon,
  RotateCwIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentId } from "@nianagent/agent-core/model-catalog";
import { workflowDebugRpc } from "../rpc-client";
import { t } from "../i18n/zh-CN";

type WriteAction = "recreateRun" | "reenqueueRun" | "wakeUpRun" | "cancelRun";

/**
 * 行内 ⋯ 菜单：Replay / Re-enqueue / Wake / Cancel。
 * 打开菜单时 lazy 拉 events 以判断是否有 pending sleep。
 */
export function RunRowActions({
  agentId,
  runId,
  runStatus,
  onSuccess,
}: {
  readonly agentId: AgentId;
  readonly runId: string;
  readonly runStatus: string;
  readonly onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [hasPendingSleeps, setHasPendingSleeps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<WriteAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEventsLoading(true);
    void (async () => {
      try {
        const res = await workflowDebugRpc<{ data?: unknown[] } | unknown[]>(
          agentId,
          "fetchEvents",
          { runId, limit: 200, sortOrder: "desc" },
        );
        if (cancelled) return;
        if (!res.success) {
          setHasPendingSleeps(false);
          return;
        }
        const raw = res.data;
        const list = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { data?: unknown[] })?.data)
            ? ((raw as { data: unknown[] }).data ?? [])
            : [];
        setHasPendingSleeps(detectPendingSleeps(list));
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, open, runId]);

  const execute = useCallback(
    async (action: WriteAction) => {
      setBusy(true);
      setMessage(null);
      try {
        const result = await workflowDebugRpc(agentId, action, { runId });
        if (!result.success) {
          setMessage(result.error.message);
          return;
        }
        setConfirm(null);
        onSuccess();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [agentId, onSuccess, runId],
  );

  const isActive = runStatus === "pending" || runStatus === "running";

  return (
    <>
      <DropdownMenu onOpenChange={setOpen} open={open}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("rowActions")}
            className="h-8 w-8"
            onClick={(e) => e.stopPropagation()}
            size="icon"
            type="button"
            variant="ghost"
          >
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        {open ? (
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              disabled={busy}
              onClick={() => setConfirm("recreateRun")}
            >
              <RotateCwIcon className="mr-2 size-4" />
              {t("actionRecreate")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy || eventsLoading}
              onClick={() => setConfirm("reenqueueRun")}
            >
              <ZapIcon className="mr-2 size-4" />
              {t("actionReenqueue")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy || eventsLoading || !hasPendingSleeps}
              onClick={() => setConfirm("wakeUpRun")}
            >
              <AlarmClockOffIcon className="mr-2 size-4" />
              {t("actionCancelSleeps")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy || !isActive}
              onClick={() => setConfirm("cancelRun")}
            >
              <XCircleIcon className="mr-2 size-4" />
              {t("actionCancelRun")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        ) : null}
      </DropdownMenu>

      <Dialog
        onOpenChange={(v) => {
          if (!v) {
            setConfirm(null);
            setMessage(null);
          }
        }}
        open={confirm !== null}
      >
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>{t("actionConfirmHint")}</DialogDescription>
          </DialogHeader>
          {message ? (
            <p className="text-destructive text-sm" role="alert">
              {message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => setConfirm(null)}
              type="button"
              variant="ghost"
            >
              {t("confirmCancel")}
            </Button>
            <Button
              disabled={busy || !confirm}
              onClick={() => {
                if (confirm) void execute(confirm);
              }}
              type="button"
            >
              {t("confirmOk")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function detectPendingSleeps(events: unknown[]): boolean {
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const o = ev as Record<string, unknown>;
    const type = String(o.eventType ?? o.type ?? "").toLowerCase();
    if (!type.includes("sleep")) continue;
    if (
      type.includes("completed") ||
      type.includes("cancelled") ||
      type.includes("resolved") ||
      type.includes("fired")
    ) {
      continue;
    }
    // 常见：sleep_started / sleep / waiting_sleep
    return true;
  }
  return false;
}
