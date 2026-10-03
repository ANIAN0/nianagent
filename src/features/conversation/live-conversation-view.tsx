import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { HomeData, HomeDraft } from "@/features/home/home-types"
import type { ConversationSnapshot } from "@/features/models/model-contract.generated"
import { ConversationPage } from "./conversation-page"
import type { ConversationReadingPosition } from "./conversation-list"
import { ConversationComposer } from "./composer/conversation-composer"
import { ConversationMessageView } from "./messages/conversation-message-view"
import { ExecutionFeedback } from "./execution-feedback"
import { QueueDock } from "./composer/queue-dock"
import type { Material } from "@/features/home/home-types"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { CompactDialog } from "./controls/compact-dialog"
import { ConversationCompactionRecord } from "./controls/conversation-compaction-record"
import { useConversationControls } from "./controls/use-conversation-controls"
import { ForkFeedback } from "./controls/fork-feedback"
import type { ConversationControlService } from "./controls/conversation-control-service"

export type LiveConversationViewProps = {
  id: string
  title: string
  workspacePath?: string
  snapshot?: ConversationSnapshot
  error?: string
  pending?: boolean
  data: HomeData
  draft: HomeDraft
  positions?: Map<string, ConversationReadingPosition>
  onChange: (draft: HomeDraft) => void
  onSend: (draft: HomeDraft) => void
  onStop: () => void
  onContinue: () => void
  onReload: () => void
  onQueueEdit?: (itemId: string, text: string) => Promise<unknown>
  onQueueRemove?: (itemId: string) => void
  onQueueDeliver?: (itemId: string) => void
  onQueueMode?: (mode: "single" | "all") => Promise<unknown>
  onSaveDraft?: () => void
  unconfirmed?: boolean
  onReconcile?: () => void
  onOpenConversation?: (id: string) => void
  controlService?: ConversationControlService
}
export function LiveConversationView({
  id,
  title,
  workspacePath,
  snapshot,
  error,
  pending,
  data,
  draft,
  positions,
  onChange,
  onSend,
  onStop,
  onContinue,
  onReload,
  onQueueEdit,
  onQueueRemove,
  onQueueDeliver,
  onQueueMode,
  onSaveDraft,
  unconfirmed,
  onReconcile,
  onOpenConversation,
  controlService,
}: LiveConversationViewProps) {
  const [activeMaterial, setActiveMaterial] = useState<Material | null>(null)
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
  const compactDisabledReason = !snapshot
    ? "正在读取会话。"
    : !data.models.includes(snapshot.modelId)
      ? "当前模型不可用，请检查模型设置。"
      : snapshot.control?.compactDisabledReason
  const forkOperation =
    controls.operation?.kind === "fork" ? controls.operation : undefined
  const forkBusy =
    controls.pending ||
    (!!forkOperation && ["running", "unknown"].includes(forkOperation.status))
  const openingFork = useRef<string | undefined>(undefined)
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
      openingFork.current === forkOperation.id
    ) {
      openingFork.current = undefined
      onOpenConversation?.(forkOperation.targetSessionId)
    }
  }, [forkOperation, onOpenConversation])
  async function fork(entryId: string) {
    const operation = await controls.fork(entryId)
    if (!operation || !mounted.current) return
    openingFork.current = operation.id
    if (operation.status === "completed" && operation.targetSessionId) {
      openingFork.current = undefined
      onOpenConversation?.(operation.targetSessionId)
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
    snapshot.messages.some((message) => message.role === "user") &&
    (snapshot.phase === "failed" || snapshot.phase === "interrupted")
  const needsResend =
    snapshot?.inputAccepted === false &&
    (snapshot.phase === "failed" || snapshot.phase === "interrupted")
  const feedback = error || snapshot?.error || snapshot?.queueError
  const stoppedFeedback = !error && snapshot?.phase === "interrupted"
  const runtime = running ? snapshot?.runtime : undefined
  let turn = 0
  const items = (snapshot?.messages ?? []).map((message, index) => ({
    id: message.id,
    historyIndex: message.historyIndex ?? Number.MAX_SAFE_INTEGER,
    revision: JSON.stringify(message),
    content: (
      <ConversationMessageView
        message={message}
        workspacePath={snapshot?.cwd ?? workspacePath}
        onOpenAttachment={(attachment) =>
          setActiveMaterial({
            ...attachment,
            kind: attachment.materialType === "skill" ? "Skill" : "附件",
            type: attachment.materialType ?? attachment.kind,
            status: "ready",
          })
        }
        onFork={
          message.role === "assistant" &&
          message.entryId &&
          message.status === "settled"
            ? () => {
                void fork(message.entryId!)
              }
            : undefined
        }
        forkPending={forkBusy && forkOperation?.anchorId === message.entryId}
        forkDisabledReason={
          !message.forkable
            ? snapshot?.historyNotice || "请选择工具执行后的已完成回复。"
            : pending || forkBusy
              ? "正在提交会话操作。"
              : !data.models.includes(snapshot?.modelId ?? "")
                ? "当前模型不可用，请检查模型设置。"
                : snapshot?.control?.forkDisabledReason
        }
      />
    ),
    ...(message.role === "user"
      ? {
          turn: ++turn,
          prompt: message.text,
          response: snapshot?.messages[index + 1]?.text,
        }
      : {}),
  }))
  const historyItems = [
    ...items,
    ...(snapshot?.compactions ?? []).map((record) => ({
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
  ].sort((a, b) => a.historyIndex - b.historyIndex)
  return (
    <>
      <ConversationPage
        viewKey={id}
        title={snapshot?.title ?? title}
        workspacePath={snapshot?.cwd ?? workspacePath}
        state={snapshot ? "ready" : error ? "error" : "loading"}
        error={error}
        onRetry={onReload}
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
            blocked={pending || controlBlocked || forkBusy}
            allowQueue
            deliveryMode={snapshot?.queue?.mode}
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
                      items={snapshot.queue.items.map((item) => ({
                        ...item,
                        draft: {
                          ...draft,
                          text: item.text,
                          materials: item.materials,
                        },
                      }))}
                      running={running}
                      busy={pending || stopping || controlBlocked || forkBusy}
                      paused={snapshot.queue.paused}
                      cwd={snapshot.cwd}
                      deliveryMode={snapshot.queue.mode}
                      onRecoverEdit={(text) => {
                        onChange({
                          ...latestDraft.current,
                          text: latestDraft.current.text
                            ? `${latestDraft.current.text}\n${text}`
                            : text,
                        })
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
                {runtime ||
                forkOperation ||
                stopping ||
                snapshot?.notice ||
                snapshot?.historyNotice ||
                feedback ||
                needsResend ||
                canContinue ||
                unconfirmed ? (
                  <div className="flex flex-col gap-2 pb-3">
                    {snapshot?.historyNotice && (
                      <Alert>
                        <AlertDescription>
                          {snapshot.historyNotice}
                        </AlertDescription>
                      </Alert>
                    )}
                    {(runtime || stopping || snapshot?.notice) && (
                      <ExecutionFeedback
                        key={id}
                        runtime={runtime}
                        stopping={stopping}
                        notice={snapshot?.notice}
                      />
                    )}
                    {forkOperation && (
                      <ForkFeedback
                        operation={forkOperation}
                        error={controls.error}
                        onCheck={() => {
                          void controls.read()
                        }}
                        onOpen={onOpenConversation}
                      />
                    )}
                    {feedback && (
                      <Alert
                        variant={stoppedFeedback ? "default" : "destructive"}
                      >
                        <AlertDescription>
                          {feedback}
                          {needsResend && (
                            <p>
                              {draft.text.trim()
                                ? "消息尚未发送，内容已保留在输入框。解决上面的错误后重新发送。"
                                : "消息尚未发送，请解决上面的错误后在输入框重新填写并发送。"}
                            </p>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                    {needsResend && !feedback && (
                      <Alert>
                        <AlertDescription>
                          消息尚未发送，请在输入框
                          {draft.text.trim() ? "重新" : "填写后"}发送。
                        </AlertDescription>
                      </Alert>
                    )}
                    {(canContinue || error || unconfirmed) && (
                      <div className="flex items-center gap-2">
                        {canContinue && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              pending || !data.models.includes(draft.model)
                            }
                            onClick={onContinue}
                          >
                            继续上次回复
                          </Button>
                        )}
                        {error && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={onReload}
                          >
                            重新读取
                          </Button>
                        )}
                        {error?.includes("草稿未保存") && onSaveDraft && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={onSaveDraft}
                          >
                            重试保存草稿
                          </Button>
                        )}
                        {unconfirmed && onReconcile && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={onReconcile}
                          >
                            核对发送
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ) : undefined}
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
        error={compactOperation ? controls.error : undefined}
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
    </>
  )
}
