import type {
  ConversationControlOperation,
  ConversationRuntime,
  OperationIssue,
} from "@/contracts/rpc.generated"

import type { ComposerData, ComposerDraft } from "@/lib/composer/types"
import type { ConversationSnapshot } from "@/contracts/rpc.generated"

import { ConversationTurnView } from "./messages/conversation-turn-view"
import { ExecutionInlineStatus } from "./execution-inline-status"
import { ConversationTurnFeedback } from "./conversation-turn-feedback"
import { createConversationTurnProjector } from "./conversation-turns"

import { ConversationSubmissionEcho } from "./conversation-submission-echo"

import type { ConversationSubmissionEchoValue } from "./conversation-submission"

import { useMemo, useState } from "react"
import { CompactionStatus } from "./controls/compaction-status"
import { ConversationCompactionRecord } from "./controls/conversation-compaction-record"
import { useConversationControls } from "./controls/use-conversation-controls"
import { ForkFeedback } from "./controls/fork-feedback"

/** 只维护这一组状态的所有权，迟到结果仍按原身份核对。 */
export function useConversationHistory({
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
}: {
  snapshot: ConversationSnapshot | undefined
  stopping: boolean
  runFailed: boolean
  fork: (entryId: string) => Promise<void>
  forkBusy: boolean
  forkOperation: ConversationControlOperation | undefined
  mutationBlockedReason: string | undefined
  data: ComposerData
  controls: ReturnType<typeof useConversationControls>
  onOpenConversation: ((id: string) => void) | undefined
  currentIssueMessage: string | undefined
  runtime: ConversationRuntime | undefined
  ordinaryStop: boolean
  runIssue: OperationIssue | undefined
  pending: boolean | undefined
  draft: ComposerDraft
  compactOperation: ConversationControlOperation | undefined
  pendingSubmission: ConversationSubmissionEchoValue | undefined
  cwd: string
  receiptUnknown: boolean | undefined
  onReconcile: (() => void) | undefined
}) {
  const [projectTurns] = useState(createConversationTurnProjector)
  const turns = useMemo(
    () => projectTurns(snapshot?.messages ?? []),
    [snapshot?.messages, projectTurns]
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
      revision: JSON.stringify([
        turn.revision,
        records.map((record) => record.id),
        index === turns.length - 1 ? snapshot?.version : undefined,
        forkOperation?.anchorId === tail?.entryId ? forkOperation : undefined,
        currentIssueMessage,
      ]),
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
            content: <ConversationCompactionRecord record={record} />,
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
      content: <ConversationCompactionRecord record={record} />,
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
  return { historyItems }
}
