import { BoundedCache } from "@/lib/bounded-cache"
import { useConversationHistory } from "./use-conversation-history"
import { type ComposerEditorElement } from "@/components/composer/composer-editor-contract"
import { ComposerNotification } from "@/components/composer/composer-notification"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import {
  CommandRecoveryFeedback,
  ConversationRecoveryBanner,
} from "./conversation-recovery-banner"
import { ConversationQueuePanel } from "./conversation-queue-panel"
import type { ConversationActionIssue } from "./use-live-conversation"
import { Button } from "@/components/ui/button"
import type { ComposerData, ComposerDraft } from "@/lib/composer/types"
import type {
  ConversationSnapshot,
  ExtensionPresentation,
} from "@/contracts/rpc.generated"
import { ConversationPage } from "./conversation-page"
import type { ConversationReadingPosition } from "./conversation-list"
import { ConversationComposer } from "./composer/conversation-composer"

import { MessageEnvironmentProvider } from "./messages/message-environment"

import { SubmissionReceipt } from "@/components/feedback/submission-receipt"
import type { ConversationSubmissionEchoValue } from "./conversation-submission"
import { MaterialServiceContext } from "@/lib/composer/material-service-port"
import { QueueOperationRecovery } from "./composer/queue-operation-recovery"
import {
  queueOperationIssueKey,
  type QueueOperationRecord,
} from "./queue-operation-recovery"
import type { Material } from "@/lib/composer/types"
import { MaterialPreviewDialog } from "@/components/composer/material-preview"
import {
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { useConversationControls } from "./controls/use-conversation-controls"

import type { ConversationControlService } from "./controls/conversation-control-service"
import { ApprovalCard } from "./permissions/approval-card"
import { PermissionServiceContext } from "./permissions/permission-service"
import type { BusyInputMode } from "./composer/run-input-control"
import { useConversationCommand } from "./controls/use-command-controller"
import { useConversationStopShortcut } from "./use-conversation-stop-shortcut"

// Ephemeral disclosure state survives a view switch; it stores no message data.
const sessionDisclosures = new BoundedCache<string, Map<string, boolean>>(100)

export type LiveConversationStatusProps = {
  readIssue?: FeedbackDescription
  readPending?: boolean
  actionIssue?: ConversationActionIssue
  draftError?: string
  receiptIssue?: FeedbackDescription
  readReceiptIssue?: FeedbackDescription
  pending?: boolean
  stopPending?: boolean
  stopUnconfirmed?: boolean
  unconfirmed?: boolean
  pendingSubmission?: ConversationSubmissionEchoValue
}

export type LiveConversationQueueProps = {
  issues?: Record<string, FeedbackDescription | undefined>
  recoveryReason?: string
  recoveryRecords?: readonly QueueOperationRecord[]
  recoveryIssuesByRequest?: Record<string, FeedbackDescription | undefined>
  storageIssue?: FeedbackDescription
  originalRetryAllowed?: Record<string, boolean | undefined>
  operationPendingByRequest?: Record<string, boolean | undefined>
  onRetryOriginal?: (record: QueueOperationRecord) => void
  onEdit?: (
    itemId: string,
    text: string,
    materials?: ComposerDraft["materials"],
    revision?: number,
    clientEditId?: string
  ) => Promise<unknown>
  onItemRead?: import("./composer/queue-dock.types").QueueDockProps["onReadItem"]
  onRemove?: (itemId: string) => void
  onDeliver?: (itemId: string) => void
}

export type LiveConversationActionProps = {
  onChange: (draft: ComposerDraft) => void
  onRecoverDraft?: (draft: ComposerDraft) => void | Promise<unknown>
  onSend: (draft: ComposerDraft, delivery?: BusyInputMode) => void
  onStop: () => void
  onContinue: () => void
  onReload: () => void
  onSaveDraft?: () => void
  onCleanReceipt?: () => void
  onRetryReadReceipt?: () => void
  onReconcile?: () => void
  onOpenConversation?: (id: string) => void
  onOpenSettings?: () => void
}

export type LiveConversationViewProps = {
  id: string
  title: string
  workspacePath?: string
  snapshot?: ConversationSnapshot
  error?: string
  data: ComposerData
  draft: ComposerDraft
  positions?: Map<string, ConversationReadingPosition>
  captureNavigation?: () => () => boolean
  controlService?: ConversationControlService
  headerActions?: ReactNode
  renderTurnDeliveries?: (records: ExtensionPresentation[]) => ReactNode
  status?: LiveConversationStatusProps
  queue?: LiveConversationQueueProps
  actions: LiveConversationActionProps
}

export function LiveConversationView({
  id,
  title,
  workspacePath,
  snapshot,
  error,
  data,
  draft,
  positions,
  captureNavigation,
  controlService,
  headerActions,
  renderTurnDeliveries,
  status = {},
  queue = {},
  actions,
}: LiveConversationViewProps) {
  const {
    readIssue: providedReadIssue,
    readPending,
    actionIssue,
    draftError,
    receiptIssue,
    readReceiptIssue,
    pending,
    stopPending,
    stopUnconfirmed: providedStopUnconfirmed,
    unconfirmed,
    pendingSubmission,
  } = status
  const {
    issues: queueIssues,
    recoveryReason: queueRecoveryReason,
    recoveryRecords: queueRecoveryRecords = [],
    recoveryIssuesByRequest: queueRecoveryIssuesByRequest,
    storageIssue: queueStorageIssue,
    originalRetryAllowed: queueOriginalRetryAllowed,
    operationPendingByRequest: queueOperationPendingByRequest,
    onRetryOriginal: onRetryQueueOriginal,
    onEdit: onQueueEdit,
    onItemRead: onQueueItemRead,
    onRemove: onQueueRemove,
    onDeliver: onQueueDeliver,
  } = queue
  const {
    onChange,
    onRecoverDraft,
    onSend,
    onStop,
    onContinue,
    onReload,
    onSaveDraft,
    onCleanReceipt,
    onRetryReadReceipt,
    onReconcile,
    onOpenConversation,
    onOpenSettings,
  } = actions
  const [activeMaterial, setActiveMaterial] = useState<Material | null>(null)
  const materialService = useContext(MaterialServiceContext)
  const permissionService = useContext(PermissionServiceContext)
  const previewRequest = useRef<AbortController | undefined>(undefined)
  const [disclosures] = useState(() => {
    let value = sessionDisclosures.get(id)
    if (!value) {
      value = new BoundedCache<string, boolean>(500)
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
      ) => {
        setActiveMaterial({
          ...attachment,
          source: attachment.source ?? "",
          kind: attachment.materialType === "skill" ? "Skill" : "附件",
          type: attachment.materialType ?? attachment.kind,
          status: "ready",
        })
      },
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
  const approval = snapshot?.approvals?.find(
    (request) => request.kind === "tool"
  )
  const command = useConversationCommand(id, snapshot?.command)
  const acknowledgedCommand = useRef<string | undefined>(undefined)
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
    if (acknowledgedCommand.current === command.pending.id) return
    acknowledgedCommand.current = command.pending.id
    // 回执只清理原输入；提交后的下一稿不属于这次命令。
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
    (command.storageBlocked ||
    command.checking ||
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
  function compact(next: ComposerDraft) {
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
  function submit(next: ComposerDraft, delivery?: BusyInputMode) {
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
    snapshot?.issue?.code === "request_not_accepted" &&
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
  const { historyItems } = useConversationHistory({
    snapshot,
    stopping,
    runFailed,
    fork,
    forkBusy,
    forkOperation,
    mutationBlockedReason,
    data,
    controls,
    onOpenConversation,
    currentIssueMessage,
    runtime,
    ordinaryStop,
    runIssue,
    pending,
    draft,
    compactOperation,
    pendingSubmission,
    cwd,
    receiptUnknown,
    onReconcile,
    renderTurnDeliveries,
  })

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
            {headerActions}
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
                          ? snapshot.queue?.paused &&
                            snapshot.queue.items.length
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
                  {(snapshot?.approvals?.filter(
                    (request) => request.kind === "tool"
                  ).length ?? 0) > 1 && (
                    <p className="conversation-approval-count">
                      还有{" "}
                      {snapshot!.approvals!.filter(
                        (request) => request.kind === "tool"
                      ).length - 1}{" "}
                      项等待确认
                    </p>
                  )}
                </>
              )
            }
            modeIssue={currentQueueIssues.mode}
            queueRecovery={
              <>
                <CommandRecoveryFeedback command={command} />
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
            onChange={onChange}
            onSubmit={submit}
            onStop={onStop}
            context={{
              ...(snapshot?.context ??
                snapshot?.contextState ?? { status: "unavailable" }),
            }}
            dock={
              <ConversationQueuePanel
                id={id}
                snapshot={snapshot}
                draft={draft}
                latestDraft={latestDraft}
                inputRef={inputRef}
                mounted={mounted}
                pending={pending}
                receiptUnknown={!!receiptUnknown}
                readPending={readPending}
                running={running}
                stopping={stopping}
                mutationBlockedReason={mutationBlockedReason}
                hasApproval={!!approval}
                pendingSubmission={pendingSubmission}
                queueIssue={queueIssue}
                queueIssues={queueIssues}
                currentQueueIssues={currentQueueIssues}
                onReload={onReload}
                onReconcile={onReconcile}
                onChange={onChange}
                onRecoverDraft={onRecoverDraft}
                queue={{
                  onItemRead: onQueueItemRead,
                  onEdit: onQueueEdit,
                  onRemove: onQueueRemove,
                  onDeliver: onQueueDeliver,
                }}
              />
            }
            feedback={
              <ConversationRecoveryBanner
                snapshot={snapshot}
                needsResend={needsResend}
                pendingQueue={pendingQueue}
                unconfirmed={unconfirmed}
                runIssue={runIssue}
                onOpenSettings={
                  onOpenSettings ?? data.modelCatalog?.onOpenSettings
                }
                hasModelCatalog={!!data.modelCatalog}
                pendingSubmission={pendingSubmission}
                inlineActionIssue={inlineActionIssue}
                draftError={draftError}
                receiptIssue={receiptIssue}
                onCleanReceipt={onCleanReceipt}
                pending={pending}
                stopPending={stopPending}
                readPending={readPending}
                onReload={onReload}
                onReconcile={onReconcile}
                onSaveDraft={onSaveDraft}
                onStop={onStop}
                onContinue={onContinue}
                mutationBlockedReason={mutationBlockedReason}
              />
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
