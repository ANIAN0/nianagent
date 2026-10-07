import { type ComposerEditorElement } from "@/components/composer/composer-editor-contract"
import { ComposerNotification } from "@/components/composer/composer-notification"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { ConversationOperationFeedback } from "./conversation-operation-feedback"
import type { ConversationActionIssue } from "./use-live-conversation"
import { Button } from "@/components/ui/button"
import type { HomeData, HomeDraft } from "@/features/home/home-types"
import type { ConversationSnapshot } from "@/features/models/model-contract.generated"
import { ConversationPage } from "./conversation-page"
import type { ConversationReadingPosition } from "./conversation-list"
import { ConversationComposer } from "./composer/conversation-composer"
import { ConversationTurnView } from "./messages/conversation-turn-view"
import { ExecutionInlineStatus } from "./execution-inline-status"
import { ConversationTurnFeedback } from "./conversation-turn-feedback"
import { projectConversationTurns } from "./conversation-turns"
import { MessageEnvironmentProvider } from "./messages/message-environment"
import { ConversationSubmissionEcho } from "./conversation-submission-echo"
import { SubmissionReceipt } from "@/components/feedback/submission-receipt"
import type { ConversationSubmissionEchoValue } from "./conversation-submission"
import { MaterialServiceContext } from "@/features/materials/material-service"
import { useConversationNotifications } from "./use-conversation-notifications"
import { QueueDock } from "./composer/queue-dock"
import { QueueOperationRecovery } from "./composer/queue-operation-recovery"
import {
  queueOperationIssueKey,
  type QueueOperationRecord,
} from "./queue-operation-recovery"
import type { Material } from "@/features/home/home-types"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { CompactionStatus } from "./controls/compaction-status"
import { ConversationCompactionRecord } from "./controls/conversation-compaction-record"
import { useConversationControls } from "./controls/use-conversation-controls"
import { ForkFeedback } from "./controls/fork-feedback"
import type { ConversationControlService } from "./controls/conversation-control-service"
import { ApprovalCard } from "./permissions/approval-card"
import { PermissionServiceContext } from "./permissions/permission-service"
import type { BusyInputMode } from "./composer/run-input-control"
import { useConversationCommand } from "./controls/use-conversation-command"
import { useConversationStopShortcut } from "./use-conversation-stop-shortcut"

// Ephemeral disclosure state survives a view switch; it stores no message data.
const sessionDisclosures = new Map<string, Map<string, boolean>>()

export type LiveConversationViewProps = {
  id: string
  title: string
  workspacePath?: string
  snapshot?: ConversationSnapshot
  error?: string
  readIssue?: FeedbackDescription
  actionIssue?: ConversationActionIssue
  draftError?: string
  receiptIssue?: FeedbackDescription
  onCleanReceipt?: () => void
  queueIssues?: Record<string, FeedbackDescription | undefined>
  queueRecoveryReason?: string
  queueRecoveryRecords?: readonly QueueOperationRecord[]
  queueRecoveryIssuesByRequest?: Record<string, FeedbackDescription | undefined>
  queueStorageIssue?: FeedbackDescription
  queueOriginalRetryAllowed?: Record<string, boolean | undefined>
  queueOperationPendingByRequest?: Record<string, boolean | undefined>
  onRetryQueueOriginal?: (record: QueueOperationRecord) => void
  readReceiptIssue?: FeedbackDescription
  onRetryReadReceipt?: () => void
  pending?: boolean
  stopPending?: boolean
  stopUnconfirmed?: boolean
  pendingSubmission?: ConversationSubmissionEchoValue
  data: HomeData
  draft: HomeDraft
  positions?: Map<string, ConversationReadingPosition>
  onChange: (draft: HomeDraft) => void
  onRecoverDraft?: (draft: HomeDraft) => void | Promise<unknown>
  onSend: (draft: HomeDraft, delivery?: BusyInputMode) => void
  onStop: () => void
  onContinue: () => void
  onReload: () => void
  readPending?: boolean
  onQueueEdit?: (
    itemId: string,
    text: string,
    materials?: HomeDraft["materials"],
    revision?: number,
    clientEditId?: string
  ) => Promise<unknown>
  onQueueRemove?: (itemId: string) => void
  onQueueDeliver?: (itemId: string) => void
  onQueueMode?: (mode: "single" | "all") => Promise<unknown>
  onSaveDraft?: () => void
  unconfirmed?: boolean
  onReconcile?: () => void
  onOpenConversation?: (id: string) => void
  onOpenSettings?: () => void
  captureNavigation?: () => () => boolean
  controlService?: ConversationControlService
}
export function LiveConversationView({
  id,
  title,
  workspacePath,
  snapshot,
  error,
  readIssue: providedReadIssue,
  actionIssue,
  draftError,
  receiptIssue,
  onCleanReceipt,
  queueIssues,
  queueRecoveryReason,
  queueRecoveryRecords = [],
  queueRecoveryIssuesByRequest,
  queueStorageIssue,
  queueOriginalRetryAllowed,
  queueOperationPendingByRequest,
  onRetryQueueOriginal,
  readReceiptIssue,
  onRetryReadReceipt,
  pending,
  stopPending,
  stopUnconfirmed: providedStopUnconfirmed,
  pendingSubmission,
  data,
  draft,
  positions,
  onChange,
  onRecoverDraft,
  onSend,
  onStop,
  onContinue,
  onReload,
  readPending,
  onQueueEdit,
  onQueueRemove,
  onQueueDeliver,
  onQueueMode,
  onSaveDraft,
  unconfirmed,
  onReconcile,
  onOpenConversation,
  onOpenSettings,
  captureNavigation,
  controlService,
}: LiveConversationViewProps) {
  const [activeMaterial, setActiveMaterial] = useState<Material | null>(null)
  const materialService = useContext(MaterialServiceContext)
  const permissionService = useContext(PermissionServiceContext)
  const previewRequest = useRef<AbortController | undefined>(undefined)
  const [disclosures] = useState(() => {
    let value = sessionDisclosures.get(id)
    if (!value) {
      value = new Map<string, boolean>()
      sessionDisclosures.set(id, value)
    }
    return value
  })
  useEffect(() => () => previewRequest.current?.abort(), [])
  const cwd = snapshot?.cwd ?? workspacePath ?? ""
  const messageEnvironment = useMemo(
    () => ({
      sessionId: id,
      cwd,
      disclosures,
      waitingTools: new Set(
        (snapshot?.approvals ?? [])
          .filter((request) => request.kind === "tool" && request.toolCallId)
          .map((request) => JSON.stringify([request.runId, request.toolCallId]))
      ),
      onOpenSettings: onOpenSettings ?? data.modelCatalog?.onOpenSettings,
      onOpenAttachment: (
        attachment: import("./conversation-types").MessageAttachment
      ) =>
        setActiveMaterial({
          ...attachment,
          kind: attachment.materialType === "skill" ? "Skill" : "附件",
          type: attachment.materialType ?? attachment.kind,
          status: "ready",
        }),
      onOpenPath: materialService
        ? async (path: string) => {
            previewRequest.current?.abort()
            const request = new AbortController()
            previewRequest.current = request
            const prepared = await materialService.prepare(
              id,
              cwd,
              [path],
              request.signal,
              { scope: "workspace" }
            )
            if (request.signal.aborted || previewRequest.current !== request)
              return
            const material = prepared[0]
            if (!material || material.status !== "ready")
              throw Object.assign(new Error("文件无法预览。"), {
                issue: {
                  code: "material_preview_failed",
                  summary: material?.error || "文件无法预览。",
                  severity: "error",
                  recovery: material?.retryable === false ? "none" : "retry",
                },
              })
            setActiveMaterial(material)
          }
        : undefined,
    }),
    [
      id,
      cwd,
      disclosures,
      materialService,
      snapshot?.approvals,
      onOpenSettings,
      data.modelCatalog?.onOpenSettings,
    ]
  )
  const running = snapshot?.phase === "running"
  useConversationNotifications(id, snapshot)
  const approval = snapshot?.approvals?.[0]
  const command = useConversationCommand(id, snapshot?.command)
  const controls = useConversationControls(id, snapshot, controlService)
  const refreshedCompactOperation = useRef<string | undefined>(undefined)
  const latestDraft = useRef(draft)
  const inputRef = useRef<ComposerEditorElement>(null)
  const pageRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    latestDraft.current = draft
  }, [draft])
  useEffect(() => {
    if (command.receipt?.status !== "completed" || !command.pending) return
    if (latestDraft.current.text === command.pending.text)
      onChange({ ...latestDraft.current, text: "", command: undefined })
    command.acknowledge()
  })
  const compactActive =
    controls.operation?.kind === "compact" &&
    ["running", "cancelling", "unknown"].includes(controls.operation.status)
  const compactOperation =
    controls.operation?.kind === "compact" ? controls.operation : undefined
  const controlBlocked = !!snapshot?.control?.busy || compactActive
  const forkOperation =
    controls.operation?.kind === "fork" ? controls.operation : undefined
  const forkBusy =
    controls.pending ||
    (!!forkOperation && ["running", "unknown"].includes(forkOperation.status))
  const submissionBlockedReason = receiptIssue
    ? "请先完成原请求的本地回执处理，草稿仍保留。"
    : pending
      ? "正在确认本次操作，草稿可继续编辑。"
      : unconfirmed
        ? pendingSubmission?.kind === "retry"
          ? "继续请求的接收结果尚未核对；下一稿和材料可继续编辑，但尚未发送，请先核对原继续请求。"
          : "原消息的接收结果尚未核对，草稿可继续编辑；请先核对原消息。"
        : undefined
  const controlPendingReason = controls.pending
    ? controls.pendingAction === "fork"
      ? "正在创建分支，请等待本次操作结果。"
      : controls.pendingAction === "compact"
        ? "正在提交上下文压缩，请等待本次操作结果。"
        : controls.pendingAction === "cancel"
          ? "正在核对取消结果，请等待本次操作结果。"
          : "正在核对会话操作，草稿仍可编辑。"
    : undefined
  const mutationBlockedReason =
    (command.checking ||
    (command.pending &&
      !["completed", "failed"].includes(command.receipt?.status ?? ""))
      ? "扩展命令正在执行或等待核对，草稿保留。"
      : undefined) ??
    submissionBlockedReason ??
    queueRecoveryReason ??
    (!snapshot
      ? "会话尚未读取完成，草稿保留；请先重新读取会话。"
      : undefined) ??
    controlPendingReason ??
    (forkBusy
      ? forkOperation?.status === "unknown"
        ? "分支结果尚未确认，请先核对原操作。"
        : "正在创建分支，请等待本次操作结果。"
      : controlBlocked
        ? "上下文操作尚未完成，请先查看其状态。"
        : undefined)
  const compactDisabledReason =
    mutationBlockedReason ??
    (!snapshot
      ? "正在读取会话。"
      : !data.models.includes(snapshot.modelId)
        ? "当前模型不可用，请检查模型设置。"
        : snapshot.control?.compactDisabledReason)
  const openingFork = useRef<
    { id: string; ownsPage: () => boolean } | undefined
  >(undefined)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (
      forkOperation?.status === "completed" &&
      forkOperation.targetSessionId &&
      openingFork.current?.id === forkOperation.id
    ) {
      const ownsPage = openingFork.current.ownsPage()
      openingFork.current = undefined
      if (ownsPage) onOpenConversation?.(forkOperation.targetSessionId)
    }
  }, [forkOperation, onOpenConversation])
  async function fork(entryId: string) {
    if (mutationBlockedReason) return
    const ownsPage = captureNavigation?.() ?? (() => true)
    const operation = await controls.fork(entryId)
    if (!operation || !mounted.current) return
    openingFork.current = { id: operation.id, ownsPage }
    if (operation.status === "completed" && operation.targetSessionId) {
      openingFork.current = undefined
      if (ownsPage()) onOpenConversation?.(operation.targetSessionId)
    }
    onReload()
  }
  useEffect(() => {
    const operation = controls.operation
    if (
      operation?.kind !== "compact" ||
      !["completed", "cancelled", "failed"].includes(operation.status)
    )
      return
    if (refreshedCompactOperation.current !== operation.id) {
      refreshedCompactOperation.current = operation.id
      onReload()
    }
  }, [controls.operation, onReload])
  function compact(next: HomeDraft) {
    if (compactDisabledReason || next.materials.length > 0) return
    const focus = next.text.trim().replace(/^\/compact(?:\s+|$)/, "")
    void controls
      .compact(focus, () => {
        if (latestDraft.current.text !== next.text) return
        const cleared = { ...latestDraft.current, text: "", command: undefined }
        latestDraft.current = cleared
        onChange(cleared)
      })
      .then(() => {
        if (mounted.current) onReload()
      })
  }
  function submit(next: HomeDraft, delivery?: BusyInputMode) {
    if (/^\/compact(?:\s|$)/.test(next.text.trim())) compact(next)
    else if (
      next.command?.kind === "extension" &&
      next.text.trim().match(/^\/([^\s]+)/)?.[1] === next.command.name
    ) {
      void command
        .run(latestDraft.current.text, next.command.name)
        .catch(() => {})
      onReload()
    } else onSend(next, delivery)
  }
  const stopIssue: ConversationActionIssue | undefined =
    snapshot?.phase === "stopping" && snapshot.issue?.code === "run_stop_failed"
      ? {
          action: "stop",
          ...feedbackFromError({ issue: snapshot.issue }),
          code: "result_unknown",
          recovery: "check",
        }
      : actionIssue?.action === "stop"
        ? actionIssue
        : providedStopUnconfirmed
          ? {
              action: "stop",
              code: "result_unknown",
              message:
                "尚未确认当前执行是否已停止，请核对运行状态。已有内容和下一稿保留。",
              recovery: "check",
              severity: "warning",
            }
          : undefined
  const stopUnconfirmed =
    !!stopIssue && ["result_unknown", "result_pending"].includes(stopIssue.code)
  const stopping =
    snapshot?.phase === "stopping" ||
    (running && (!!stopPending || stopUnconfirmed))
  useConversationStopShortcut({
    root: pageRef,
    sessionId: id,
    runId: snapshot?.runId,
    epoch: snapshot?.epoch,
    enabled: running && !stopping && !approval,
    onStop,
  })
  // Ordinary send failures announce once; uncertain receipts retain their
  // persistent reconciliation entry and never become a transient rejection.
  const sendFailure =
    actionIssue?.action === "send" &&
    !unconfirmed &&
    actionIssue.code !== "cancelled" &&
    ![
      "result_unknown",
      "result_pending",
      "receipt_cleanup",
      "queue_recovery_storage",
    ].includes(actionIssue.code) &&
    !["check", "reload", "restart"].includes(actionIssue.recovery ?? "none")
      ? actionIssue
      : undefined
  const receiptKey = `${id}:${pendingSubmission?.id ?? "unconfirmed"}`
  const [receiptShown, setReceiptShown] = useState<string>()
  const receiptReported = unconfirmed && (!pending || !!actionIssue)
  if (receiptReported && receiptShown !== receiptKey)
    setReceiptShown(receiptKey)
  const receiptUnknown =
    unconfirmed && (receiptReported || receiptShown === receiptKey)
  const receiptActionIssue =
    unconfirmed &&
    actionIssue &&
    ["send", "retry", "reconcile"].includes(actionIssue.action)
      ? actionIssue
      : undefined
  const receiptMessage =
    receiptActionIssue?.message ??
    "原消息的接收结果待确认，原内容和下一稿已保留。请核对原请求，不要重复发送。"
  const inlineActionIssue =
    stopIssue ?? (sendFailure || receiptActionIssue ? undefined : actionIssue)
  const needsResend =
    !actionIssue &&
    !pending &&
    !pendingSubmission &&
    !unconfirmed &&
    snapshot?.inputAccepted === false &&
    (snapshot.phase === "failed" || snapshot.phase === "interrupted")
  const pendingQueue =
    !!snapshot?.queue?.items.length &&
    (snapshot.queue.items.some(
      (item) => item.clientRequestId === snapshot.clientRequestId
    ) ||
      snapshot.issue?.code === "queue_storage")
  const readIssue =
    providedReadIssue ?? (error ? feedbackFromError(error) : undefined)
  const queueIssue =
    snapshot?.queueIssue ??
    (snapshot?.issue?.code === "queue_storage" ? snapshot.issue : undefined)
  const originalQueueRecords = queueRecoveryRecords.filter(
    (record) => record.sessionId === id
  )
  const originalQueueKeys = new Set(
    originalQueueRecords.map(queueOperationIssueKey)
  )
  const currentQueueIssues = Object.fromEntries(
    Object.entries(queueIssues ?? {}).filter(
      ([key]) => !originalQueueKeys.has(key) && key !== "storage"
    )
  )
  const runIssue =
    snapshot?.issue ??
    (snapshot?.error
      ? {
          code: "execution_failed",
          summary: feedbackFromError(snapshot.error).message,
          severity:
            snapshot.phase === "interrupted"
              ? ("info" as const)
              : ("error" as const),
          recovery: "retry" as const,
        }
      : undefined)
  const ordinaryStop =
    snapshot?.phase === "interrupted" &&
    (!runIssue || runIssue.code === "cancelled")
  const runFailed =
    !!snapshot?.inputAccepted &&
    !!runIssue &&
    !ordinaryStop &&
    !pendingQueue &&
    ["failed", "interrupted"].includes(snapshot.phase)
  const currentIssueMessage =
    runFailed && runIssue?.recovery !== "reload"
      ? [...(snapshot?.messages ?? [])]
          .reverse()
          .find(
            (message) =>
              message.entryId === snapshot?.issueEntryId &&
              snapshot.issueEntryId !== undefined &&
              message.issue?.code === runIssue.code &&
              message.issue.summary === runIssue.summary
          )?.id
      : undefined
  const runtime = running ? snapshot?.runtime : undefined
  const turns = useMemo(
    () => projectConversationTurns(snapshot?.messages ?? []),
    [snapshot?.messages]
  )
  let turnNumber = 0
  const unownedCompactions = [...(snapshot?.compactions ?? [])]
  const items = turns.map((turn, index) => {
    const tail = turn.tail
    const nextIndex = turns[index + 1]?.historyIndex ?? Infinity
    const records = unownedCompactions.filter(
      (record) =>
        record.historyIndex >= turn.historyIndex &&
        record.historyIndex < nextIndex
    )
    records.forEach((record) =>
      unownedCompactions.splice(unownedCompactions.indexOf(record), 1)
    )
    const forkableBoundary =
      tail?.entryId &&
      tail.status === "settled" &&
      tail.stopReason !== "toolUse"
    return {
      id: turn.id,
      historyIndex: turn.historyIndex,
      revision: snapshot?.version,
      content: (
        <ConversationTurnView
          turn={turn}
          stopFeedbackProvided={
            (stopping || (runFailed && snapshot?.phase === "interrupted")) &&
            index === turns.length - 1 &&
            !!snapshot?.runId &&
            tail?.runId === snapshot.runId &&
            tail?.userTurnId === turn.id
          }
          latest={index === turns.length - 1}
          statistics={
            index === turns.length - 1 ? snapshot?.statistics : undefined
          }
          records={records.map((record) => ({
            id: `compaction-${record.id}`,
            historyIndex: record.historyIndex,
            content: (
              <ConversationCompactionRecord
                record={record}
              />
            ),
          }))}
          onFork={
            forkableBoundary && tail
              ? () => {
                  void fork(tail.entryId!)
                }
              : undefined
          }
          forkPending={forkBusy && forkOperation?.anchorId === tail?.entryId}
          forkDisabledReason={
            !tail?.forkable
              ? snapshot?.historyNotice || "请选择工具执行后的已完成回复。"
              : mutationBlockedReason
                ? mutationBlockedReason
                : !data.models.includes(snapshot?.modelId ?? "")
                  ? "当前模型不可用，请检查模型设置。"
                  : snapshot?.control?.forkDisabledReason
          }
          forkFeedback={
            tail && forkOperation && forkOperation.anchorId === tail.entryId ? (
              <ForkFeedback
                operation={forkOperation}
                issue={controls.forkIssue}
                pending={controls.pending}
                pendingAction={controls.pendingAction}
                onCheck={() => {
                  void controls.read()
                }}
                onRetry={() => {
                  if (tail.entryId) void fork(tail.entryId)
                }}
                onOpen={onOpenConversation}
              />
            ) : undefined
          }
          issueFeedback={(message, recovered) =>
            message.issue &&
            message.issue.code !== "cancelled" &&
            message.id !== currentIssueMessage ? (
              <ConversationTurnFeedback
                title={recovered ? "先前失败，已恢复" : "本轮运行失败"}
                message={message.issue.summary}
                code={message.issue.code}
                severity={recovered ? "info" : message.issue.severity}
              />
            ) : undefined
          }
        />
      ),
      ...(turn.user
        ? {
            turn: ++turnNumber,
            prompt: turn.user.text,
            response: turn.response,
          }
        : {}),
    }
  })
  const historyItems = [
    ...items,
    ...(runtime?.phase === "retrying"
      ? [
          {
            id: "execution-inline-retry",
            historyIndex:
              Math.max(
                -1,
                ...items.map((item) => item.historyIndex),
                ...(snapshot?.compactions ?? []).map(
                  (record) => record.historyIndex
                )
              ) + 0.5,
            revision: runtime.retryAt ?? "retry",
            content: <ExecutionInlineStatus runtime={runtime} />,
          },
        ]
      : []),
    ...(ordinaryStop &&
    !turns.some(
      (turn) =>
        turn.tail?.status === "interrupted" &&
        turn.tail.runId === snapshot?.runId
    )
      ? [
          {
            id: `run-stopped-${snapshot!.runId}`,
            historyIndex:
              Math.max(-1, ...items.map((item) => item.historyIndex)) + 0.5,
            revision: snapshot!.version,
            content: (
              <span className="conversation-stopped" role="status">
                已停止
              </span>
            ),
          },
        ]
      : []),
    ...(runFailed
      ? [
          {
            id: `run-feedback-${snapshot!.runId}`,
            historyIndex:
              Math.max(
                -1,
                ...items.map((item) => item.historyIndex),
                ...(snapshot?.compactions ?? []).map(
                  (record) => record.historyIndex
                )
              ) + 0.5,
            revision: JSON.stringify([runIssue, pending, draft.model]),
            content: (
              <ConversationTurnFeedback
                title={
                  runIssue!.recovery === "reload"
                    ? "会话记录保存未完成"
                    : snapshot!.phase === "interrupted"
                      ? "本次执行已停止"
                      : "本轮运行失败"
                }
                message={runIssue!.summary}
                code={runIssue!.code}
                severity={runIssue!.severity}
              />
            ),
          },
        ]
      : []),
    ...unownedCompactions.map((record) => ({
      id: `compaction-${record.id}`,
      historyIndex: record.historyIndex,
      revision: record.id,
      content: (
        <ConversationCompactionRecord
          record={record}
        />
      ),
    })),
    ...(compactOperation &&
    !(
      compactOperation.status === "completed" &&
      snapshot?.compactions?.some(
        (record) => record.id === compactOperation.compactionEntryId
      )
    )
      ? [
          {
            id: `manual-compaction-${compactOperation.id}`,
            historyIndex:
              (snapshot?.messages.find(
                (message) => message.entryId === compactOperation.anchorId
              )?.historyIndex ??
                snapshot?.compactions?.find(
                  (record) => record.id === compactOperation.anchorId
                )?.historyIndex ??
                Math.max(
                  -1,
                  ...items.map((item) => item.historyIndex),
                  ...(snapshot?.compactions ?? []).map(
                    (record) => record.historyIndex
                  )
                )) + 0.5,
            revision: JSON.stringify([
              compactOperation,
              controls.compactIssue,
              controls.pending,
              controls.pendingAction,
            ]),
            content: (
              <CompactionStatus
                operation={compactOperation}
                issue={controls.compactIssue}
                pending={controls.pending}
                pendingAction={controls.pendingAction}
              />
            ),
          },
        ]
      : []),
    ...(pendingSubmission &&
    !(
      pendingSubmission.kind === "send" &&
      pendingSubmission.placement === "queued"
    ) &&
    !(
      snapshot?.inputAccepted &&
      snapshot.clientRequestId === pendingSubmission.id
    ) &&
    !snapshot?.queue?.acceptedRequestIds?.includes(pendingSubmission.id)
      ? [
          {
            id: `submission-${pendingSubmission.id}`,
            historyIndex: Infinity,
            revision: pendingSubmission.id,
            content: (
              <ConversationSubmissionEcho
                submission={pendingSubmission}
                workspacePath={cwd}
                pending={pending && !receiptUnknown}
                unconfirmed={receiptUnknown}
                checking={receiptUnknown && pending}
                onCheck={onReconcile}
              />
            ),
          },
        ]
      : []),
  ].sort((a, b) => a.historyIndex - b.historyIndex)
  return (
    <MessageEnvironmentProvider value={messageEnvironment}>
      {sendFailure && !pending && (
        <ComposerNotification
          key={id}
          message={`${sendFailure.message} (${sendFailure.code})`}
          trigger={sendFailure}
          error
        />
      )}
      {receiptUnknown && (
        <ComposerNotification
          key={`receipt:${id}:${pendingSubmission?.id ?? "unconfirmed"}`}
          message={receiptMessage}
          trigger={receiptActionIssue}
          tone="warning"
        />
      )}
      <ConversationPage
        rootRef={pageRef}
        keepComposer
        viewKey={id}
        title={snapshot?.title ?? title}
        workspacePath={snapshot?.cwd ?? workspacePath}
        state={snapshot ? "ready" : readIssue ? "error" : "loading"}
        error={readIssue?.message}
        issue={readIssue}
        onRetry={onReload}
        retrying={readPending}
        onOpenSettings={onOpenSettings ?? data.modelCatalog?.onOpenSettings}
        readingPositions={positions}
        connectionMessage={
          snapshot?.lineage
            ? `派生自 · ${snapshot.lineage.sourceTitle}`
            : undefined
        }
        headerActions={
          <>
            {receiptUnknown && !pendingSubmission && (
              <SubmissionReceipt checking={pending} onCheck={onReconcile} />
            )}
            {snapshot?.lineage && onOpenConversation ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onOpenConversation(snapshot.lineage!.sourceSessionId)
                }
              >
                打开来源会话
              </Button>
            ) : undefined}
          </>
        }
        notice={
          readReceiptIssue ? (
            <OperationFeedback
              notify={false}
              density="compact"
              title="阅读状态尚未保存"
              {...readReceiptIssue}
              message={`阅读状态保存：${readReceiptIssue.message}`}
              severity="warning"
              actions={
                onRetryReadReceipt && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onRetryReadReceipt}
                  >
                    重试保存阅读状态
                  </Button>
                )
              }
            />
          ) : undefined
        }
        status={
          snapshot?.approvals?.length
            ? "等待你的确认"
            : stopping
              ? stopUnconfirmed
                ? "停止结果待确认"
                : "正在停止"
              : snapshot?.command?.status === "started"
                ? "正在执行命令"
                : compactActive
                  ? compactOperation?.status === "unknown" && !controls.pending
                    ? "压缩结果待确认"
                    : compactOperation?.status === "cancelling" ||
                        controls.pendingAction === "cancel"
                      ? "正在取消压缩"
                      : "正在压缩上下文"
                  : running
                    ? runtime?.phase === "retrying"
                      ? "等待重试"
                      : runtime?.phase === "compacting"
                        ? "正在压缩上下文"
                        : runtime?.phase === "tool"
                          ? "正在执行工具"
                          : "正在回复"
                    : snapshot?.phase === "interrupted"
                      ? "已停止"
                      : snapshot?.phase === "failed"
                        ? "回复失败"
                        : snapshot?.phase === "completed"
                          ? snapshot.queue?.paused && snapshot.queue.items.length
                            ? "回复结束 · 待处理消息已暂停"
                            : snapshot.messages.at(-1)?.stopReason === "length"
                              ? "已达到输出上限"
                              : "回复结束"
                          : pendingSubmission?.stage === "prepared"
                            ? "正在准备会话"
                            : ""
        }
        items={historyItems}
        composer={
          <ConversationComposer
            inputRef={inputRef}
            key={id}
            sessionId={id}
            data={data}
            statistics={snapshot?.statistics}
            draft={draft}
            workspacePath={snapshot?.cwd ?? workspacePath ?? ""}
            running={running}
            stopping={stopping}
            stopUnconfirmed={stopUnconfirmed}
            blocked={!!mutationBlockedReason}
            blockedReason={mutationBlockedReason}
            compactDisabledReason={compactDisabledReason}
            allowQueue
            interaction={
              approval && (
                <>
                  <ApprovalCard
                    key={`${id}:${snapshot!.epoch}:${approval.runId}:${approval.id}`}
                    request={approval}
                    sessionId={id}
                    epoch={snapshot!.epoch}
                    readPending={readPending}
                    disabledReason={
                      stopping
                        ? "正在停止当前运行，请等待最新状态。"
                        : !permissionService
                          ? "审批服务不可用，请读取当前状态。"
                          : undefined
                    }
                    onReload={onReload}
                    onReply={async (value) => {
                      if (!permissionService)
                        throw new Error("审批服务不可用。")
                      await permissionService.reply(
                        id,
                        approval.id,
                        approval.runId,
                        value
                      )
                      onReload()
                    }}
                  />
                  {(snapshot?.approvals?.length ?? 0) > 1 && (
                    <p className="conversation-approval-count">
                      还有 {snapshot!.approvals!.length - 1} 项等待确认
                    </p>
                  )}
                </>
              )
            }
            queuedCount={snapshot?.queue?.items.length ?? 0}
            deliveryMode={snapshot?.queue?.mode}
            modeIssue={currentQueueIssues.mode}
            queueRecovery={
              <>
                {(command.pending || command.issue) && (
                  <OperationFeedback
                    notify={false}
                    density="compact"
                    title={
                      command.receipt?.status === "started"
                        ? `正在执行 /${command.receipt.name}`
                        : command.receipt?.status === "failed"
                          ? "扩展命令未完成"
                          : "扩展命令待核对"
                    }
                    message={`扩展命令${command.receipt?.name ? ` /${command.receipt.name}` : ""}：${
                      command.issue?.message ??
                      command.receipt?.issue?.summary ??
                      "原命令与参数已保留；核对不会重复执行。"
                    }`}
                    severity={
                      command.receipt?.status === "failed" ? "error" : "info"
                    }
                    actions={
                      command.pending && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={command.checking}
                          onClick={() => void command.check()}
                        >
                          核对原命令
                        </Button>
                      )
                    }
                  />
                )}
                <QueueOperationRecovery
                  records={originalQueueRecords}
                  issues={queueIssues}
                  issuesByRequest={queueRecoveryIssuesByRequest}
                  storageIssue={queueStorageIssue}
                  retryAllowed={queueOriginalRetryAllowed}
                  checking={readPending}
                  restoring={pending}
                  processing={queueOperationPendingByRequest}
                  onCheck={onReload}
                  onRestore={onRetryQueueOriginal}
                />
              </>
            }
            onCheckMode={onReload}
            modeChecking={readPending}
            onDeliveryModeChange={onQueueMode}
            onChange={onChange}
            onSubmit={submit}
            onStop={onStop}
            context={{
              ...(snapshot?.context ??
                snapshot?.contextState ?? { status: "unavailable" }),
            }}
            dock={
              <>
                {snapshot?.queue &&
                  onQueueEdit &&
                  onQueueRemove &&
                  onQueueDeliver && (
                    <QueueDock
                      sessionId={id}
                      pendingSubmission={
                        pendingSubmission?.kind === "send" &&
                        pendingSubmission.placement === "queued" &&
                        !snapshot.queue.acceptedRequestIds?.includes(
                          pendingSubmission.id
                        ) &&
                        !(
                          snapshot.inputAccepted &&
                          snapshot.clientRequestId === pendingSubmission.id
                        )
                          ? pendingSubmission
                          : undefined
                      }
                      pending={pending && !receiptUnknown}
                      unconfirmed={receiptUnknown}
                      checking={receiptUnknown && pending}
                      onCheckSubmission={onReconcile}
                      retiredItems={snapshot.queue.retiredItems}
                      revision={snapshot.queue.revision}
                      items={snapshot.queue.items.map((item) => ({
                        ...item,
                        draft: {
                          ...draft,
                          text: item.text,
                          materials: item.materials,
                        },
                      }))}
                      running={running}
                      stopping={stopping}
                      busy={stopping || !!mutationBlockedReason}
                      checkPending={readPending}
                      paused={snapshot.queue.paused}
                      waitingApproval={!!approval}
                      cwd={snapshot.cwd}
                      deliveryMode={snapshot.queue.mode}
                      issue={
                        queueIssue &&
                        !Object.values(queueIssues ?? {}).some(
                          (issue) => issue?.code === queueIssue.code
                        )
                          ? { ...queueIssue, message: queueIssue.summary }
                          : undefined
                      }
                      issues={{ ...currentQueueIssues, mode: undefined }}
                      onCheck={onReload}
                      onRecoverEdit={async (
                        text,
                        materials = [],
                        recoveryKey
                      ) => {
                        const recoveredDraft: HomeDraft =
                          recoveryKey &&
                          latestDraft.current.homeRecoveryKey === recoveryKey
                            ? latestDraft.current
                            : {
                                ...latestDraft.current,
                                homeRecoveryKey: recoveryKey,
                                text: latestDraft.current.text
                                  ? `${latestDraft.current.text}\n${text}`
                                  : text,
                                materials: [
                                  ...latestDraft.current.materials,
                                  ...materials.filter(
                                    (material) =>
                                      !latestDraft.current.materials.some(
                                        (existing) =>
                                          existing.id === material.id
                                      )
                                  ),
                                ],
                              }
                        await (onRecoverDraft ?? onChange)(recoveredDraft)
                        if (!mounted.current) return
                        requestAnimationFrame(() => {
                          inputRef.current?.focus()
                          const length = inputRef.current?.value.length ?? 0
                          inputRef.current?.setSelectionRange(length, length)
                        })
                      }}
                      onEdit={onQueueEdit}
                      onRemove={onQueueRemove}
                      onSendNow={onQueueDeliver}
                    />
                  )}
              </>
            }
            feedback={
              snapshot?.notice ||
              snapshot?.historyNotice ||
              needsResend ||
              inlineActionIssue ||
              draftError ||
              receiptIssue ? (
                <div className="flex flex-col gap-2">
                  {snapshot?.historyNotice && (
                    <OperationFeedback
                      notify={false}
                      density="compact"
                      title="历史记录提示"
                      message={`历史记录：${snapshot.historyNotice}`}
                      severity="info"
                    />
                  )}
                  {snapshot?.notice && (
                    <OperationFeedback
                      notify={false}
                      density="compact"
                      title={
                        snapshot.notice.kind === "input-handled"
                          ? "扩展已处理输入"
                          : "上下文压缩未完成"
                      }
                      message={`${snapshot.notice.kind === "input-handled" ? "扩展输入" : "上下文压缩"}：${snapshot.notice.message}`}
                      severity="warning"
                    />
                  )}
                  {needsResend && !pendingQueue && !unconfirmed && (
                    <OperationFeedback
                      notify={false}
                      density="compact"
                      title="消息尚未发送"
                      message={
                        runIssue?.summary ??
                        "内容已保留，请修正后在输入框发送。"
                      }
                      details={runIssue?.details}
                      severity={
                        snapshot?.phase === "interrupted" ? "info" : "error"
                      }
                      actions={
                        runIssue?.recovery === "settings" &&
                        data.modelCatalog && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={data.modelCatalog.onOpenSettings}
                          >
                            检查模型设置
                          </Button>
                        )
                      }
                    />
                  )}
                  <ConversationOperationFeedback
                    submissionKind={pendingSubmission?.kind}
                    actionIssue={inlineActionIssue}
                    draftError={draftError}
                    receiptIssue={receiptIssue}
                    onCleanReceipt={onCleanReceipt}
                    unconfirmed={false}
                    pending={
                      pending ||
                      (inlineActionIssue?.action === "stop" && stopPending)
                    }
                    readPending={readPending}
                    onReload={onReload}
                    onReconcile={onReconcile}
                    onSaveDraft={onSaveDraft}
                    onStop={onStop}
                    onContinue={onContinue}
                    continueDisabledReason={mutationBlockedReason}
                    onOpenSettings={
                      onOpenSettings ?? data.modelCatalog?.onOpenSettings
                    }
                  />
                </div>
              ) : undefined
            }
          />
        }
      />
      <MaterialPreviewDialog
        key={`${id}:materials`}
        history
        material={activeMaterial}
        cwd={snapshot?.cwd ?? workspacePath ?? ""}
        onClose={() => setActiveMaterial(null)}
      />
    </MessageEnvironmentProvider>
  )
}
