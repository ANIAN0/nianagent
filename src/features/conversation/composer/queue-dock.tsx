import { useQueueEditController } from "./use-queue-edit-controller"
import type { QueueDockProps } from "./queue-dock.types"
export type { QueueDockProps } from "./queue-dock.types"
import "./composer.css"

import {
  ChevronDown,
  ChevronUp,
  ListOrdered,
  Pencil,
  Send,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"

import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import { QueueEditEditor } from "./queue-edit-editor"
import { QueueAttachments } from "./queue-attachments"
import { QueueActionHint } from "./queue-action-hint"
import { SubmissionReceipt } from "@/components/feedback/submission-receipt"

import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"

/** Remount at a session boundary; callbacks retain only their own edit record. */
export function QueueDock(props: QueueDockProps) {
  return <QueueDockContent key={props.sessionId ?? "catalog"} {...props} />
}
function QueueDockContent({
  pendingSubmission,
  pending = false,
  unconfirmed = false,
  checking = false,
  onCheckSubmission,
  sessionId,
  revision,
  retiredItems = [],
  items,
  running,
  stopping = false,
  paused = false,
  waitingApproval = false,
  cwd = "",
  busy = false,
  checkPending = false,
  issue,
  issues = {},
  onCheck,
  onEdit,
  onRemove,
  onSendNow,
  onRecoverEdit,
}: QueueDockProps) {
  const {
    visible,
    editing,
    editingItem,
    submitted,
    setPreview,
    saving,
    remember,
    scope,
    editBlocked,
    terminalOther,
    editUnknown,
    save,
    clearEditing,
    recoverEdit,
    editError,
    editConfirmed,
    storageIssue,
    rowCount,
    rowProblems,
    expanded,
    id,
    setCollapsed,
    preview,
  } = useQueueEditController({
    pendingSubmission,
    pending,
    unconfirmed,
    checking,
    onCheckSubmission,
    sessionId,
    revision,
    retiredItems,
    items,
    running,
    stopping,
    paused,
    waitingApproval,
    cwd,
    busy,
    checkPending,
    issue,
    issues,
    onCheck,
    onEdit,
    onRemove,
    onSendNow,
    onRecoverEdit,
  })

  if (!visible) return null
  const editor = editing && (
    <div className="conversation-queue-edit">
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
              <QueueMessagePreview text={editingItem.draft.text} />
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
          notify={false}
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
          notify={false}
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
              notify={false}
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
            notify={false}
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
      {rowCount > 1 && (
        <Button
          type="button"
          variant="ghost"
          className="conversation-queue-heading"
          disabled={!!editing || saving || rowProblems || unconfirmed}
          title={rowProblems ? "消息操作需要处理，列表保持展开" : undefined}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ListOrdered data-icon="inline-start" />
          <span>
            {rowCount} 条排队消息{rowProblems ? " · 有待处理问题" : ""}
          </span>
          {pendingSubmission && !expanded && (
            <small className="conversation-queue-status">
              {unconfirmed ? "待核对" : "正在发送"}
            </small>
          )}
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
        hidden={rowCount > 1 && !expanded}
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
          const itemBusy =
            busy ||
            item.status === "dispatching" ||
            removalUnknown ||
            deliveryUnknown
          const editDisabled =
            itemBusy || !!editing || !!item.draft.materials.length
          const actionDisabled = itemBusy || !!editing?.submitted
          return (
            <li key={item.id} className="flex-wrap">
              {editing?.id === item.id ? (
                editor
              ) : (
                <>
                  {rowCount === 1 && (
                    <ListOrdered
                      className="conversation-queue-icon"
                      aria-hidden="true"
                    />
                  )}
                  <QueueAttachments
                    materials={item.draft.materials}
                    cwd={cwd}
                  />
                  <div className="conversation-queue-text">
                    <QueueMessagePreview text={item.draft.text} />
                    {!issue && !deliverIssue && item.error && (
                      <OperationFeedback
                        notify={false}
                        title="这条消息尚未交付"
                        message="请核对队列状态后继续处理。原消息和材料已保留。"
                        details={item.error}
                        severity="warning"
                      />
                    )}
                  </div>
                  {(stopping ||
                    item.status === "dispatching" ||
                    item.delivery === "steer" ||
                    paused ||
                    !running ||
                    waitingApproval) && (
                    <small role="status" className="conversation-queue-status">
                      {stopping
                        ? "正在停止"
                        : waitingApproval
                          ? item.delivery === "steer"
                            ? "待补充 · 等待确认"
                            : "排队 · 等待确认"
                          : paused || !running
                            ? "已暂停"
                            : item.status === "dispatching"
                              ? item.delivery === "steer"
                                ? "待补充"
                                : "正在交付"
                              : "待补充"}
                    </small>
                  )}
                  <div className="conversation-queue-actions">
                    <QueueActionHint
                      content={
                        item.draft.materials.length
                          ? "包含文件或图片的消息不能编辑正文；可移除后重新发送。"
                          : "编辑排队消息"
                      }
                      disabled={editDisabled}
                    >
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="编辑排队消息"
                        className="conversation-queue-action"
                        disabled={editDisabled}
                        title={
                          item.draft.materials.length
                            ? "包含文件或图片的消息不能编辑正文。"
                            : undefined
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
                    </QueueActionHint>
                    <QueueActionHint
                      content="移除排队消息"
                      disabled={actionDisabled}
                    >
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="conversation-queue-action"
                        aria-label="删除排队消息"
                        disabled={actionDisabled}
                        onClick={() => onRemove(item.id)}
                      >
                        <Trash2 />
                      </Button>
                    </QueueActionHint>
                    <QueueActionHint
                      content={
                        running
                          ? "补充当前工作，在下个可用边界处理"
                          : "发送此消息，继续处理"
                      }
                      disabled={actionDisabled}
                    >
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="conversation-queue-action"
                        aria-label={running ? "补充当前工作" : "发送此消息"}
                        disabled={actionDisabled}
                        onClick={() => onSendNow(item.id)}
                      >
                        <Send />
                      </Button>
                    </QueueActionHint>
                  </div>
                </>
              )}
              {removeIssue && (
                <div className="w-full">
                  <OperationFeedback
                    notify={false}
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
                    notify={false}
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
        {pendingSubmission && (
          <li
            className="conversation-queue-pending flex-wrap"
            aria-label={unconfirmed ? "排队结果待核对" : "正在排队发送"}
          >
            {rowCount === 1 && (
              <ListOrdered className="conversation-queue-icon" aria-hidden />
            )}
            <QueueAttachments
              materials={pendingSubmission.draft.materials}
              cwd={cwd}
            />
            <div className="conversation-queue-text">
              <QueueMessagePreview text={pendingSubmission.draft.text} />
            </div>
            <span role="status" className="conversation-queue-status">
              {unconfirmed ? "待核对" : pending ? "正在发送" : "等待接收"}
            </span>
            <div className="conversation-queue-actions">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="conversation-queue-action"
                aria-label="编辑排队消息"
                disabled
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="conversation-queue-action"
                aria-label="删除排队消息"
                disabled
              >
                <Trash2 />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="conversation-queue-action"
                aria-label="补充当前工作"
                disabled
              >
                <Send />
              </Button>
            </div>
            {unconfirmed && (
              <div className="conversation-queue-receipt">
                <SubmissionReceipt
                  checking={checking}
                  onCheck={onCheckSubmission}
                />
              </div>
            )}
          </li>
        )}
      </ul>
      <MaterialPreviewDialog
        material={preview}
        cwd={cwd}
        onClose={() => setPreview(null)}
      />
    </section>
  )
}

function QueueMessagePreview({ text }: { text: string }) {
  const flat = text.replace(/\s+/g, " ").trim()
  const chars = Array.from(flat)
  return (
    <span className="conversation-queue-preview">
      {chars.length > 200 ? `${chars.slice(0, 200).join("")}…` : flat}
    </span>
  )
}
