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
import { useState } from "react"
import type { Material } from "@/features/home/home-types"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"

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
}: LiveConversationViewProps) {
  const [activeMaterial, setActiveMaterial] = useState<Material | null>(null)
  const running = snapshot?.phase === "running"
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
      items={(snapshot?.messages ?? []).map((message, index) => ({
        id: message.id,
        revision: JSON.stringify(message),
        content: <ConversationMessageView message={message} workspacePath={snapshot?.cwd ?? workspacePath} onOpenAttachment={(attachment) => setActiveMaterial({ id: attachment.id, name: attachment.name, kind: attachment.materialType === "skill" ? "Skill" : "附件", type: attachment.materialType ?? attachment.kind, status: "ready", source: attachment.source })} />,
        ...(message.role === "user"
          ? {
              turn: ++turn,
              prompt: message.text,
              response: snapshot?.messages[index + 1]?.text,
            }
          : {}),
      }))}
      composer={
        <ConversationComposer
          key={id}
          sessionId={id}
          data={data}
          draft={draft}
          workspacePath={snapshot?.cwd ?? workspacePath ?? ""}
          running={running}
          stopping={stopping}
          blocked={pending}
          allowQueue
          deliveryMode={snapshot?.queue?.mode}
          onDeliveryModeChange={onQueueMode}
          onChange={onChange}
          onSubmit={onSend}
          onStop={onStop}
          context={
            snapshot?.context ??
            snapshot?.contextState ?? { status: "unavailable" }
          }
          dock={
            <>
            {!!snapshot?.queue?.items.length && onQueueEdit && onQueueRemove && onQueueDeliver && <QueueDock
              items={snapshot.queue.items.map((item) => ({ ...item, draft: { ...draft, text: item.text, materials: item.materials } }))}
              running={running}
              busy={pending || stopping}
              deliveryMode={snapshot.queue.mode}
              onDeliveryModeChange={onQueueMode}
              onEdit={onQueueEdit}
              onRemove={onQueueRemove}
              onSendNow={onQueueDeliver}
            />}
            {runtime ||
            stopping ||
            snapshot?.notice ||
            feedback ||
            needsResend ||
            canContinue || unconfirmed ? (
              <div className="flex flex-col gap-2 pb-3">
                {(runtime || stopping || snapshot?.notice) && (
                  <ExecutionFeedback
                    key={id}
                    runtime={runtime}
                    stopping={stopping}
                    notice={snapshot?.notice}
                  />
                )}
                {feedback && (
                  <Alert variant={stoppedFeedback ? "default" : "destructive"}>
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
                        disabled={pending || !data.models.includes(draft.model)}
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
                    {error?.includes("草稿未保存") && onSaveDraft && <Button type="button" size="sm" variant="outline" onClick={onSaveDraft}>重试保存草稿</Button>}
                    {unconfirmed && onReconcile && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onReconcile}>核对发送</Button>}
                  </div>
                )}
              </div>
            ) : undefined}
            </>
          }
        />
      }
    />
    <MaterialPreviewDialog key={id} history material={activeMaterial} cwd={snapshot?.cwd ?? workspacePath ?? ""} onClose={() => setActiveMaterial(null)} />
    </>
  )
}
