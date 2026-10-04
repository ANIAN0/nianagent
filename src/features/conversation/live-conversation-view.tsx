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
import { projectConversationTurns } from "./conversation-turns"
import { MessageEnvironmentProvider } from "./messages/message-environment"
import { ConversationSubmissionEcho } from "./conversation-submission-echo"
import type { ConversationSubmissionEchoValue } from "./conversation-submission"
import { MaterialServiceContext } from "@/features/materials/material-service"
import { ExecutionFeedback } from "./execution-feedback"
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
import { CompactDialog } from "./controls/compact-dialog"
import { ConversationCompactionRecord } from "./controls/conversation-compaction-record"
import { useConversationControls } from "./controls/use-conversation-controls"
import { ForkFeedback } from "./controls/fork-feedback"
import type { ConversationControlService } from "./controls/conversation-control-service"

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
  pendingSubmission?: ConversationSubmissionEchoValue
  data: HomeData
  draft: HomeDraft
  positions?: Map<string, ConversationReadingPosition>
  onChange: (draft: HomeDraft) => void
  onRecoverDraft?: (draft: HomeDraft) => void | Promise<unknown>
  onSend: (draft: HomeDraft) => void
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
      onOpenSettings,
      data.modelCatalog?.onOpenSettings,
    ]
  )
  const running = snapshot?.phase === "running"
  const controls = useConversationControls(id, snapshot, controlService)
  const [compactOpen, setCompactOpen] = useState(false)
  const [compactFocus, setCompactFocus] = useState("")
  const [compactOperationId, setCompactOperationId] = useState<string>()
  const compactCommand = useRef<
    { text: string; operationId?: string } | undefined
  >(undefined)
  const latestDraft = useRef(draft)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    latestDraft.current = draft
  }, [draft])
  const compactActive =
    controls.operation?.kind === "compact" &&
    ["running", "cancelling", "unknown"].includes(controls.operation.status)
  const compactOperation =
    compactActive || controls.operation?.id === compactOperationId
      ? controls.operation
      : undefined
  const controlBlocked = !!snapshot?.control?.busy || compactActive
  const forkOperation =
    controls.operation?.kind === "fork" ? controls.operation : undefined
  const forkBusy =
    controls.pending ||
    (!!forkOperation && ["running", "unknown"].includes(forkOperation.status))
  const submissionBlockedReason = receiptIssue
    ? "请先完成原请求的本地回执处理，草稿仍保留。"
    : unconfirmed
      ? pendingSubmission?.kind === "retry"
        ? "继续请求的接收结果尚未核对；下一稿和材料可继续编辑，但尚未发送，请先核对原继续请求。"
        : "原消息的接收结果尚未核对，草稿可继续编辑；请先核对原消息。"
      : pending
        ? "正在确认本次操作，草稿可继续编辑。"
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
    if (
      controls.operation?.kind === "compact" &&
      controls.operation.status === "completed" &&
      compactCommand.current?.operationId === controls.operation.id
    ) {
      if (latestDraft.current.text === compactCommand.current.text)
        onChange({ ...latestDraft.current, text: "" })
      compactCommand.current = undefined
      onReload()
    }
  }, [controls.operation, onChange, onReload])
  function openCompact(command?: string) {
    if (!compactActive)
      compactCommand.current = command
        ? { text: latestDraft.current.text }
        : undefined
    const previous =
      controls.operation?.kind === "compact" &&
      (compactActive ||
        (!command &&
          ["failed", "cancelled"].includes(controls.operation.status)))
        ? controls.operation
        : undefined
    setCompactOperationId(previous?.id)
    setCompactFocus(
      previous
        ? (previous.focus ?? "")
        : (command?.trim().replace(/^\/compact(?:\s+|$)/, "") ?? "")
    )
    setCompactOpen(true)
  }
  function submit(next: HomeDraft) {
    if (/^\/compact(?:\s|$)/.test(next.text.trim())) openCompact(next.text)
    else onSend(next)
  }
  const stopping = snapshot?.phase === "stopping"
  const canContinue =
    !!snapshot?.inputAccepted &&
    snapshot.issue?.recovery !== "reload" &&
    snapshot.messages.some((message) => message.role === "user") &&
    (snapshot.canContinue ||
      snapshot.phase === "failed" ||
      snapshot.phase === "interrupted")
  const needsResend =
    !actionIssue &&
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
      : snapshot?.phase === "interrupted"
        ? {
            code: "cancelled",
            summary: "本次执行已停止，已完成内容保留。",
            severity: "info" as const,
            recovery: "none" as const,
          }
        : undefined)
  const runFailed =
    !!snapshot?.inputAccepted &&
    !!runIssue &&
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
            runFailed &&
            snapshot?.phase === "interrupted" &&
            index === turns.length - 1 &&
            !!snapshot.runId &&
            tail?.runId === snapshot.runId &&
            tail?.userTurnId === turn.id
          }
          latest={index === turns.length - 1}
          records={records.map((record) => ({
            id: `compaction-${record.id}`,
            historyIndex: record.historyIndex,
            content: (
              <ConversationCompactionRecord
                record={record}
                messages={snapshot?.messages ?? []}
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
          onContinue={
            canContinue &&
            index === turns.length - 1 &&
            tail?.stopReason === "length"
              ? onContinue
              : undefined
          }
          continueDisabled={
            !!mutationBlockedReason || !data.models.includes(draft.model)
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
            message.issue && message.id !== currentIssueMessage ? (
              <OperationFeedback
                title={
                  recovered ? "先前尝试失败，后续已恢复" : "此条回复未完成"
                }
                message={message.issue.summary}
                details={message.issue.details}
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
              <OperationFeedback
                title={
                  runIssue!.recovery === "reload"
                    ? "会话记录保存未完成"
                    : snapshot!.phase === "interrupted"
                      ? "本次执行已停止"
                      : "本次回复未完成"
                }
                message={runIssue!.summary}
                details={runIssue!.details}
                severity={runIssue!.severity}
                actions={
                  <>
                    {runIssue!.recovery === "reload" && (
                      <Button variant="outline" size="sm" onClick={onReload}>
                        重新读取会话记录
                      </Button>
                    )}
                    {canContinue && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          !!mutationBlockedReason ||
                          !data.models.includes(draft.model)
                        }
                        title={mutationBlockedReason}
                        onClick={onContinue}
                      >
                        继续上次回复
                      </Button>
                    )}
                    {runIssue!.recovery === "settings" && data.modelCatalog && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={data.modelCatalog.onOpenSettings}
                      >
                        检查模型设置
                      </Button>
                    )}
                    {runIssue!.code === "context_limit" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openCompact()}
                      >
                        压缩上下文
                      </Button>
                    )}
                  </>
                }
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
          messages={snapshot?.messages ?? []}
        />
      ),
    })),
    ...(pendingSubmission
      ? [
          {
            id: `submission-${pendingSubmission.id}`,
            historyIndex: Infinity,
            revision: pendingSubmission.id,
            content: (
              <ConversationSubmissionEcho
                submission={pendingSubmission}
                workspacePath={cwd}
                pending={pending}
                unconfirmed={unconfirmed}
              />
            ),
          },
        ]
      : []),
  ].sort((a, b) => a.historyIndex - b.historyIndex)
  return (
    <MessageEnvironmentProvider value={messageEnvironment}>
      <ConversationPage
        keepComposer
        viewKey={id}
        title={snapshot?.title ?? title}
        workspacePath={snapshot?.cwd ?? workspacePath}
        state={snapshot ? "ready" : readIssue ? "error" : "loading"}
        error={readIssue?.message}
        issue={readIssue}
        onRetry={onReload}
        onOpenSettings={onOpenSettings ?? data.modelCatalog?.onOpenSettings}
        readingPositions={positions}
        connectionMessage={
          snapshot?.lineage
            ? `派生自 · ${snapshot.lineage.sourceTitle}`
            : undefined
        }
        headerActions={
          snapshot?.lineage && onOpenConversation ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onOpenConversation(snapshot.lineage!.sourceSessionId)
              }
            >
              打开来源会话
            </Button>
          ) : undefined
        }
        notice={
          readReceiptIssue ? (
            <OperationFeedback
              title="阅读状态尚未保存"
              {...readReceiptIssue}
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
          stopping
            ? "正在停止"
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
                    ? "回复结束"
                    : ""
        }
        items={historyItems}
        composer={
          <ConversationComposer
            inputRef={inputRef}
            key={id}
            sessionId={id}
            data={data}
            draft={draft}
            workspacePath={snapshot?.cwd ?? workspacePath ?? ""}
            running={running}
            stopping={stopping}
            blocked={!!mutationBlockedReason}
            blockedReason={mutationBlockedReason}
            allowQueue
            queuedCount={snapshot?.queue?.items.length ?? 0}
            deliveryMode={snapshot?.queue?.mode}
            modeIssue={currentQueueIssues.mode}
            queueRecovery={
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
              onCompact: () => openCompact(),
              compactActive,
              compactDisabledReason,
            }}
            dock={
              <>
                {snapshot?.queue &&
                  onQueueEdit &&
                  onQueueRemove &&
                  onQueueDeliver && (
                    <QueueDock
                      sessionId={id}
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
                      busy={stopping || !!mutationBlockedReason}
                      checkPending={readPending}
                      paused={snapshot.queue.paused}
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
                <div className="flex flex-col gap-2 pb-3">
                  {snapshot?.historyNotice && (
                    <OperationFeedback
                      title="历史记录提示"
                      message={snapshot.historyNotice}
                      severity="info"
                    />
                  )}
                  {(runtime || stopping || snapshot?.notice) && (
                    <ExecutionFeedback
                      key={id}
                      runtime={runtime}
                      stopping={stopping}
                      notice={snapshot?.notice}
                    />
                  )}
                  {needsResend && !pendingQueue && !unconfirmed && (
                    <OperationFeedback
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
                    readIssue={snapshot ? readIssue : undefined}
                    actionIssue={actionIssue}
                    draftError={draftError}
                    receiptIssue={receiptIssue}
                    onCleanReceipt={onCleanReceipt}
                    unconfirmed={unconfirmed}
                    pending={pending}
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
              </>
            }
          />
        }
      />
      <MaterialPreviewDialog
        key={id}
        history
        material={activeMaterial}
        cwd={snapshot?.cwd ?? workspacePath ?? ""}
        onClose={() => setActiveMaterial(null)}
      />
      <CompactDialog
        open={compactOpen}
        title={snapshot?.title ?? title}
        model={
          data.modelLabels?.[snapshot?.modelId ?? ""] ??
          snapshot?.providerModelId ??
          ""
        }
        messageCount={snapshot?.messages.length ?? 0}
        focus={compactFocus}
        operation={compactOperation}
        issue={controls.compactIssue}
        pendingAction={controls.pendingAction}
        pending={controls.pending}
        disabledReason={compactDisabledReason}
        onOpenChange={setCompactOpen}
        onFocusChange={setCompactFocus}
        onStart={() => {
          void controls
            .compact(compactFocus, (operationId) => {
              setCompactOperationId(operationId)
              if (compactCommand.current)
                compactCommand.current.operationId = operationId
            })
            .then(onReload)
        }}
        onCancel={() => {
          void controls.cancel()
        }}
        onCheck={() => {
          void controls.read().then(onReload)
        }}
      />
    </MessageEnvironmentProvider>
  )
}
