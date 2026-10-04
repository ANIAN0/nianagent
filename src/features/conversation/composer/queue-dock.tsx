import "./composer.css"
import { useEffect, useId, useState, useSyncExternalStore } from "react"
import {
  ChevronDown,
  ChevronUp,
  ListOrdered,
  Pencil,
  Send,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import type { HomeDraft, Material } from "@/features/home/home-types"
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "@/features/home/composer-panel-context"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import { QueueEditEditor } from "./queue-edit-editor"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import {
  clearQueueEdit,
  getQueueEditOwnerSnapshot,
  matchesQueueEditReceipt,
  queueEditSignature,
  readQueueEdit,
  releaseQueueEditOwner,
  restoreQueueEdits,
  saveQueueEdit,
  setQueueEditStorageIssue,
  subscribeQueueEdits,
  type QueueEditRecord,
} from "../queue-edit-store"

export type QueueDockProps = {
  sessionId?: string
  revision?: number
  retiredItems?: {
    id: string
    clientRequestId: string
    status: "delivered" | "removed"
    editBaseRevision?: number
    editRequestId?: string
  }[]
  items: {
    id: string
    draft: HomeDraft
    status?: "pending" | "dispatching" | "failed"
    error?: string
    delivery?: "followUp" | "steer"
    editBaseRevision?: number
    editRequestId?: string
  }[]
  running: boolean
  paused?: boolean
  cwd?: string
  busy?: boolean
  checkPending?: boolean
  issue?: FeedbackDescription
  issues?: Record<string, FeedbackDescription | undefined>
  onCheck?: () => void
  deliveryMode?: "single" | "all"
  /** Deprecated: mode changes belong to the complete composer's auxiliary bar. */
  onDeliveryModeChange?: (mode: "single" | "all") => void | Promise<unknown>
  onEdit: (
    id: string,
    text: string,
    materials?: Material[],
    revision?: number,
    clientEditId?: string
  ) => void | Promise<unknown>
  onRemove: (id: string) => void
  onSendNow: (id: string) => void
  /** Resolves only after the destination draft is durable. recoveryKey makes retries idempotent. */
  onRecoverEdit?: (
    text: string,
    materials?: Material[],
    recoveryKey?: string
  ) => void | Promise<unknown>
}

/** Remount at a session boundary; callbacks retain only their own edit record. */
export function QueueDock(props: QueueDockProps) {
  return <QueueDockContent key={props.sessionId ?? "catalog"} {...props} />
}
function QueueMessagePreview({
  itemId,
  text,
}: {
  itemId: string
  text: string
}) {
  const name = "queue-preview:" + itemId
  const [open, setOpen] = useComposerPanel(name)
  const closeAutoFocus = useComposerPanelCloseAutoFocus(name)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full min-w-0 justify-start p-0 text-left font-normal"
          aria-label="查看排队消息全文"
        >
          <span className="truncate">{text || "附件消息"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="w-96 max-w-[calc(100vw-32px)]"
        aria-label="排队消息全文"
        onCloseAutoFocus={closeAutoFocus}
      >
        <p className="moon-scrollbar max-h-[min(208px,var(--radix-popover-content-available-height))] overflow-auto text-sm leading-6 break-words whitespace-pre-wrap">
          {text || "此消息只有附件。"}
        </p>
      </PopoverContent>
    </Popover>
  )
}
function QueueDockContent({
  sessionId,
  revision,
  retiredItems = [],
  items,
  running,
  paused = false,
  cwd = "",
  busy = false,
  checkPending = false,
  issue,
  issues = {},
  onCheck,
  deliveryMode = "single",
  onEdit,
  onRemove,
  onSendNow,
  onRecoverEdit,
}: QueueDockProps) {
  const id = useId()
  const [localScope] = useState(() => "catalog:" + crypto.randomUUID())
  const scope = sessionId ?? localScope
  const persistent = !!sessionId
  const [owner] = useState(() => {
    try {
      restoreQueueEdits(scope, persistent)
    } catch (error) {
      setQueueEditStorageIssue(
        scope,
        feedbackFromError(
          error,
          "未能读取排队编辑草稿，当前修改仍保留在窗口中。"
        )
      )
    }
    return {
      subscribe: (listener: () => void) => subscribeQueueEdits(scope, listener),
      getSnapshot: () => getQueueEditOwnerSnapshot(scope),
    }
  })
  const { record: editing, storageIssue } = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getSnapshot
  )
  const [collapsed, setCollapsed] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Material | null>(null)
  useEffect(
    () => () => {
      if (!persistent) {
        for (const record of restoreQueueEdits(scope, false))
          clearQueueEdit(scope, record.id, false)
        releaseQueueEditOwner(scope)
      }
    },
    [scope, persistent]
  )
  const submitted = editing?.submitted
  const editingItem = items.find((item) => item.id === editing?.id)
  const retiredReceipt = retiredItems.find((item) => item.id === editing?.id)
  const confirmedRetired = matchesQueueEditReceipt(submitted, retiredReceipt)
  const editConfirmed =
    !!submitted?.acknowledged ||
    matchesQueueEditReceipt(submitted, editingItem) ||
    confirmedRetired
  const terminalOther = !!submitted && !!retiredReceipt && !editConfirmed
  const editError = terminalOther
    ? {
        code: "queue_edit_retired",
        message: `原消息已${retiredReceipt?.status === "delivered" ? "交付" : "移除"}，现有回执与本次编辑的请求身份或原版本不符，无法确认这份编辑是否被采用。可以保留修改到输入框，或明确放弃本次编辑。`,
        severity: "warning" as const,
        recovery: "none" as const,
      }
    : editConfirmed
      ? undefined
      : (editing?.issue ??
        (submitted && !submitted.acknowledged
          ? {
              code: "result_unknown",
              message:
                "尚未确认原编辑是否保存。文字、材料和原版本已保留，请核对原项。",
              recovery: "check" as const,
              severity: "warning" as const,
            }
          : undefined))
  const editUnknown =
    !!submitted ||
    editError?.code === "result_unknown" ||
    editError?.recovery === "check"
  const editBlocked =
    busy || saving || editUnknown || editingItem?.status === "dispatching"
  function remember(record: QueueEditRecord) {
    try {
      saveQueueEdit(record, persistent)
      setQueueEditStorageIssue(scope)
      return true
    } catch (error) {
      setQueueEditStorageIssue(
        scope,
        feedbackFromError(
          error,
          "未能保存排队编辑草稿，文字和材料仍在当前窗口中。请重新保存草稿后继续。"
        )
      )
      return false
    }
  }
  function clearEditing() {
    if (!editing) return
    try {
      clearQueueEdit(scope, editing.id, persistent)
      setQueueEditStorageIssue(scope)
    } catch (error) {
      setQueueEditStorageIssue(
        scope,
        feedbackFromError(
          error,
          "未能清除已结束的排队编辑副本，副本继续保留，请重新处理。"
        )
      )
    }
  }
  useEffect(() => {
    if (!editing?.submitted) return
    // Text equality or another queue mutation cannot prove this client edit.
    // A host ACK or the exact original CAS + clientEditId is authoritative,
    // independently of the item's later pending/failed/terminal delivery state.
    if (editConfirmed) {
      try {
        clearQueueEdit(scope, editing.id, persistent)
        setQueueEditStorageIssue(scope)
      } catch (error) {
        setQueueEditStorageIssue(
          scope,
          feedbackFromError(
            error,
            "编辑已保存，但本地副本未能清除。请重新清除副本。"
          )
        )
      }
    }
  }, [editing, scope, persistent, editConfirmed])
  async function save() {
    if (
      !editing ||
      !editingItem ||
      editBlocked ||
      (!editing.draft.text.trim() && !editing.draft.materials.length)
    )
      return
    if (
      queueEditSignature(editing.draft) ===
        queueEditSignature(editingItem.draft) &&
      editingItem.status !== "failed"
    ) {
      clearEditing()
      return
    }
    const attempt = {
      token: crypto.randomUUID(),
      draft: structuredClone({
        ...editing.draft,
        text: editing.draft.text.trim(),
      }),
      revision: editing.revision,
    }
    const captured = { ...editing, submitted: attempt, issue: undefined }
    if (!remember(captured)) {
      // Nothing crossed RPC; remove only the tentative submission marker.
      remember({ ...captured, submitted: undefined })
      return
    }
    setSaving(true)
    try {
      await onEdit(
        captured.id,
        attempt.draft.text,
        attempt.draft.materials,
        attempt.revision,
        attempt.token
      )
      const current = readQueueEdit(scope, captured.id)
      if (current?.submitted?.token === attempt.token)
        remember({ ...current, submitted: { ...attempt, acknowledged: true } })
    } catch (error) {
      const failure = feedbackFromError(
        error,
        "未能保存这条排队消息，修改文字和材料已保留。"
      )
      const current = readQueueEdit(scope, captured.id)
      if (current?.submitted?.token === attempt.token)
        remember({
          ...current,
          submitted:
            failure.code === "result_unknown" || failure.recovery === "check"
              ? attempt
              : undefined,
          issue: failure,
        })
    } finally {
      setSaving(false)
    }
  }
  async function recoverEdit(text: string, materials: Material[]) {
    if (!editing || !onRecoverEdit || busy || saving) return
    const recoveryKey = JSON.stringify([
      "queue-edit",
      scope,
      editing.id,
      editing.submitted?.token ?? editing.revision,
      queueEditSignature(editing.draft),
    ])
    setSaving(true)
    try {
      // The destination is durable before removing the only persisted source.
      // Its stable recoveryKey prevents duplicate append after a remove failure.
      await onRecoverEdit(text, materials, recoveryKey)
      clearEditing()
    } catch (error) {
      setQueueEditStorageIssue(
        scope,
        feedbackFromError(
          error,
          "未能保存到输入框，排队编辑的文字和材料仍保留。请释放本地存储空间后重试。"
        )
      )
    } finally {
      setSaving(false)
    }
  }
  const rowProblems = items.some(
    (item) =>
      !!issues["queue-remove:" + item.id] ||
      !!issues["queue-deliver:" + item.id] ||
      (!issue && !!item.error)
  )
  const expanded = !collapsed || !!editing || rowProblems
  if (!items.length && !editing && !preview && !issue && !storageIssue)
    return null
  const editor = editing && (
    <div className="w-full py-2">
      {!editingItem && (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          原消息已离开待处理列表，未保存的文字和材料保留在这里。
        </p>
      )}
      {editingItem &&
        !submitted &&
        revision !== undefined &&
        revision !== editing.revision && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p role="status" className="text-xs text-muted-foreground">
              队列版本已变化。请先核对原消息，再选择是否基于当前版本保存这些修改。
            </p>
            <div className="w-full min-w-0">
              <p className="text-xs text-muted-foreground">当前已保存的消息</p>
              <QueueMessagePreview
                itemId={`${editingItem.id}:current`}
                text={editingItem.draft.text}
              />
              {editingItem.draft.materials.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {editingItem.draft.materials.map((material) => (
                    <Button
                      key={material.id}
                      size="sm"
                      variant="outline"
                      className="h-6 max-w-full text-xs"
                      onClick={() => setPreview(material)}
                    >
                      <span className="truncate">{material.name}</span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || saving}
              onClick={() =>
                remember({
                  ...editing,
                  revision,
                  originalDraft: structuredClone(editingItem.draft),
                  originalStatus: editingItem.status,
                  issue: undefined,
                })
              }
            >
              基于当前版本继续编辑
            </Button>
          </div>
        )}
      <QueueEditEditor
        key={editing.id}
        draft={editing.draft}
        sessionId={scope}
        cwd={cwd}
        disabled={editBlocked}
        pending={saving || !!submitted}
        canLeavePending={terminalOther && !busy && !saving}
        departed={!editingItem}
        onChange={(draft) =>
          remember({
            ...editing,
            draft,
            issue: editUnknown ? editing.issue : undefined,
          })
        }
        onSave={() => void save()}
        onCancel={clearEditing}
        onRecover={
          onRecoverEdit &&
          ((text, materials) => void recoverEdit(text, materials))
        }
      />
      {editingItem?.status === "dispatching" && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          原消息正在交付，不能再修改；编辑副本继续保留。
        </p>
      )}
      {editError && (
        <OperationFeedback
          title={editUnknown ? "编辑保存结果待确认" : "未能保存排队修改"}
          {...editError}
          actions={
            <RecoveryAction
              issue={editError}
              disabled={
                saving ||
                (busy && (editError.recovery ?? "retry") === "retry") ||
                (checkPending &&
                  ["check", "reload"].includes(editError.recovery ?? "retry"))
              }
              onCheck={onCheck}
              onRetry={() => void save()}
              onReload={onCheck}
              labels={{ check: "核对保存结果", retry: "重新保存" }}
            />
          }
        />
      )}
      {!editError && !editConfirmed && submitted && !saving && (
        <OperationFeedback
          title="正在核对保存结果"
          message="文字和材料已保留，读取到对应更新后结束编辑。"
          severity="info"
          actions={
            onCheck && (
              <Button
                variant="outline"
                size="sm"
                onClick={onCheck}
                disabled={checkPending}
              >
                {checkPending ? "正在核对…" : "核对保存结果"}
              </Button>
            )
          }
        />
      )}
    </div>
  )
  return (
    <section className="conversation-queue" aria-label="排队消息">
      {issue &&
        !(
          editError &&
          editError.code === issue.code &&
          editError.message === issue.message
        ) && (
          <div className="p-3">
            <OperationFeedback
              title="待处理消息需要处理"
              {...issue}
              actions={
                onCheck && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCheck}
                    disabled={checkPending}
                  >
                    {checkPending ? "正在核对…" : "核对队列状态"}
                  </Button>
                )
              }
            />
          </div>
        )}
      {storageIssue && (
        <div className="p-3">
          <OperationFeedback
            title="编辑草稿需要处理"
            {...storageIssue}
            actions={
              editing && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    if (editConfirmed) clearEditing()
                    else remember(editing)
                  }}
                >
                  {editConfirmed ? "重新清除副本" : "重新保存草稿"}
                </Button>
              )
            }
          />
        </div>
      )}
      {editing && !editingItem && <div className="px-3">{editor}</div>}
      {items.length > 0 && (
        <p className="conversation-queue-mode" role="status">
          {paused || !running ? "已暂停，发送后继续处理" : "当前工作结束后继续"}
          <span>{deliveryMode === "all" ? "全部交付" : "逐条交付"}</span>
        </p>
      )}
      {items.length > 1 && (
        <Button
          type="button"
          variant="ghost"
          className="conversation-queue-heading"
          disabled={!!editing || busy || rowProblems}
          title={rowProblems ? "消息操作需要处理，列表保持展开" : undefined}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ListOrdered data-icon="inline-start" />
          <span>
            {items.length} 条排队消息{rowProblems ? " · 有待处理问题" : ""}
          </span>
          {expanded ? (
            <ChevronDown data-icon="inline-end" />
          ) : (
            <ChevronUp data-icon="inline-end" />
          )}
        </Button>
      )}
      <ul
        id={id}
        className="conversation-queue-list"
        hidden={items.length > 1 && !expanded}
      >
        {items.map((item) => {
          const removeIssue = issues["queue-remove:" + item.id]
          const deliverIssue = issues["queue-deliver:" + item.id]
          const removalUnknown =
            removeIssue?.code === "result_unknown" ||
            removeIssue?.recovery === "check"
          const deliveryUnknown =
            deliverIssue?.code === "result_unknown" ||
            deliverIssue?.recovery === "check"
          return (
            <li key={item.id} className="flex-wrap">
              {editing?.id === item.id ? (
                editor
              ) : (
                <>
                  {items.length === 1 && (
                    <ListOrdered
                      className="conversation-queue-icon"
                      aria-hidden="true"
                    />
                  )}
                  <div className="conversation-queue-text">
                    <QueueMessagePreview
                      itemId={item.id}
                      text={item.draft.text}
                    />
                    {(item.status === "dispatching" ||
                      item.delivery === "steer") && (
                      <small role="status">
                        {item.status === "dispatching"
                          ? "正在交付"
                          : "等待补充边界"}
                      </small>
                    )}
                    {!issue && !deliverIssue && item.error && (
                      <OperationFeedback
                        title="这条消息尚未交付"
                        message="请核对队列状态后继续处理。原消息和材料已保留。"
                        details={item.error}
                        severity="warning"
                      />
                    )}
                    {!!item.draft.materials.length && (
                      <div className="flex flex-wrap gap-1">
                        {item.draft.materials.map((material) => (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 max-w-full text-xs"
                            key={material.id}
                            onClick={() => setPreview(material)}
                          >
                            <span className="truncate">{material.name}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="编辑排队消息"
                      title="编辑"
                      disabled={
                        busy ||
                        !!editing ||
                        item.status === "dispatching" ||
                        removalUnknown ||
                        deliveryUnknown
                      }
                      onClick={() =>
                        remember({
                          sessionId: scope,
                          id: item.id,
                          revision,
                          draft: structuredClone(item.draft),
                          originalDraft: structuredClone(item.draft),
                          originalStatus: item.status,
                        })
                      }
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={running ? "立即发送" : "发送此消息"}
                      title={
                        running
                          ? "立即发送，补充当前工作"
                          : "发送此消息，继续处理"
                      }
                      disabled={
                        busy ||
                        item.status === "dispatching" ||
                        deliveryUnknown ||
                        removalUnknown ||
                        !!editing?.submitted
                      }
                      onClick={() => onSendNow(item.id)}
                    >
                      <Send />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="删除排队消息"
                      title="删除"
                      disabled={
                        busy ||
                        item.status === "dispatching" ||
                        removalUnknown ||
                        deliveryUnknown ||
                        !!editing?.submitted
                      }
                      onClick={() => onRemove(item.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </>
              )}
              {removeIssue && (
                <div className="w-full">
                  <OperationFeedback
                    title={
                      removalUnknown ? "移除结果待确认" : "未能移除这条消息"
                    }
                    {...removeIssue}
                    actions={
                      <RecoveryAction
                        issue={removeIssue}
                        disabled={
                          (busy &&
                            (removeIssue.recovery ?? "retry") === "retry") ||
                          (checkPending &&
                            ["check", "reload"].includes(
                              removeIssue.recovery ?? "retry"
                            ))
                        }
                        onCheck={onCheck}
                        onRetry={() => onRemove(item.id)}
                        onReload={onCheck}
                        labels={{ check: "核对移除结果", retry: "重试移除" }}
                      />
                    }
                  />
                </div>
              )}
              {deliverIssue && (
                <div className="w-full">
                  <OperationFeedback
                    title={
                      deliveryUnknown ? "交付结果待确认" : "未能交付这条消息"
                    }
                    {...deliverIssue}
                    actions={
                      <RecoveryAction
                        issue={deliverIssue}
                        disabled={
                          (busy &&
                            (deliverIssue.recovery ?? "retry") === "retry") ||
                          (checkPending &&
                            ["check", "reload"].includes(
                              deliverIssue.recovery ?? "retry"
                            ))
                        }
                        onCheck={onCheck}
                        onRetry={() => onSendNow(item.id)}
                        onReload={onCheck}
                        labels={{ check: "核对交付结果", retry: "重试交付" }}
                      />
                    }
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <MaterialPreviewDialog
        material={preview}
        cwd={cwd}
        onClose={() => setPreview(null)}
      />
    </section>
  )
}
