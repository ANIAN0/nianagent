import "./composer.css"
import { useEffect, useId, useState, useSyncExternalStore } from "react"

import type { Material } from "@/lib/composer/types"

import { feedbackFromError } from "@/lib/operation-issue"
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
import type { QueueDockProps } from "./queue-dock.types"
/** 页面状态与异步所有权在此维护，视图只组合正式组件。 */
export function useQueueEditController({
  pendingSubmission,
  unconfirmed = false,
  sessionId,
  retiredItems = [],
  items,
  busy = false,
  issue,
  issues = {},
  onEdit,
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
        (submitted && !submitted.acknowledged && !saving
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
    setSaving(true)
    if (!remember(captured)) {
      // Nothing crossed RPC; remove only the tentative submission marker.
      remember({ ...captured, submitted: undefined })
      setSaving(false)
      return
    }
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
  const expanded =
    !collapsed || !!editing || saving || rowProblems || unconfirmed
  const rowCount = items.length + (pendingSubmission ? 1 : 0)
  const [wasRowCount, setWasRowCount] = useState(rowCount)
  if (wasRowCount !== rowCount) {
    setWasRowCount(rowCount)
    if (!rowCount) setCollapsed(true)
  }
  const visible = !!(rowCount || editing || preview || issue || storageIssue)
  return {
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
  }
}
