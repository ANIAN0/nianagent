import type {
  ConversationControlOperation,
  ConversationRuntime,
  ExtensionPresentation,
  OperationIssue,
} from "@/contracts/rpc.generated"

import type { ComposerData, ComposerDraft } from "@/lib/composer/types"
import type { ConversationSnapshot } from "@/contracts/rpc.generated"

import {
  ConversationTurnView,
  type ConversationTurnRecord,
} from "./messages/conversation-turn-view"
import { ExecutionInlineStatus } from "./execution-inline-status"
import { ConversationTurnFeedback } from "./conversation-turn-feedback"
import { createConversationTurnProjector } from "./conversation-turns"

import { ConversationSubmissionEcho } from "./conversation-submission-echo"

import type { ConversationSubmissionEchoValue } from "./conversation-submission"

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { CompactionStatus } from "./controls/compaction-status"
import { ConversationCompactionRecord } from "./controls/conversation-compaction-record"
import { useConversationControls } from "./controls/use-conversation-controls"
import { ForkFeedback } from "./controls/fork-feedback"

const noTurnRecords: readonly ConversationTurnRecord[] = []

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
  renderTurnDeliveries,
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
  renderTurnDeliveries?: (records: ExtensionPresentation[]) => React.ReactNode
}) {
  const [projectTurns] = useState(createConversationTurnProjector)
  const turns = useMemo(
    () => projectTurns(snapshot?.messages ?? []),
    [snapshot?.messages, projectTurns]
  )
  const { forkIssue, pending: controlPending, pendingAction, read } = controls
  const forkActions = useRef({ fork, read })
  useLayoutEffect(() => {
    forkActions.current = { fork, read }
  }, [fork, read])
  const forkTurn = useCallback((entryId: string) => {
    void forkActions.current.fork(entryId)
  }, [])
  const readFork = useCallback(() => {
    void forkActions.current.read()
  }, [])
  const { byTurn, unownedCompactions } = useMemo(() => {
    const byTurn = new Map<string, ConversationTurnRecord[]>()
    const unownedCompactions = []
    let index = 0
    for (const record of [...(snapshot?.compactions ?? [])].sort(
      (left, right) => left.historyIndex - right.historyIndex
    )) {
      while (
        index + 1 < turns.length &&
        turns[index + 1].historyIndex <= record.historyIndex
      )
        index++
      const turn = turns[index]
      if (!turn || record.historyIndex < turn.historyIndex) {
        unownedCompactions.push(record)
        continue
      }
      const records = byTurn.get(turn.id) ?? []
      records.push({
        id: `compaction-${record.id}`,
        historyIndex: record.historyIndex,
        content: <ConversationCompactionRecord record={record} />,
      })
      byTurn.set(turn.id, records)
    }
    return { byTurn, unownedCompactions }
  }, [snapshot?.compactions, turns])
  const modelAvailable = data.models.includes(snapshot?.modelId ?? "")
  const { version, phase, runId, statistics, historyNotice } = snapshot ?? {}
  const forkDisabledReason = snapshot?.control?.forkDisabledReason
  const items = useMemo(() => {
    let turnNumber = 0
    return turns.map((turn, index) => {
      const tail = turn.tail
      const records = byTurn.get(turn.id) ?? noTurnRecords
      const currentTurnIssue = turn.messages.some(
        (message) => message.id === currentIssueMessage
      )
        ? currentIssueMessage
        : undefined
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
          index === turns.length - 1 ? version : undefined,
          forkOperation?.anchorId === tail?.entryId ? forkOperation : undefined,
          currentTurnIssue,
        ]),
        content: (
          <ConversationTurnView
            turn={turn}
            renderTurnDeliveries={renderTurnDeliveries}
            stopFeedbackProvided={
              (stopping || (runFailed && phase === "interrupted")) &&
              index === turns.length - 1 &&
              !!runId &&
              tail?.runId === runId &&
              tail?.userTurnId === turn.id
            }
            latest={index === turns.length - 1}
            statistics={index === turns.length - 1 ? statistics : undefined}
            records={records}
            onFork={forkTurn}
            forkEntryId={forkableBoundary ? tail.entryId : undefined}
            forkPending={forkBusy && forkOperation?.anchorId === tail?.entryId}
            forkDisabledReason={
              !tail?.forkable
                ? historyNotice || "请选择工具执行后的已完成回复。"
                : mutationBlockedReason
                  ? mutationBlockedReason
                  : !modelAvailable
                    ? "当前模型不可用，请检查模型设置。"
                    : forkDisabledReason
            }
            forkFeedback={
              tail &&
              forkOperation &&
              forkOperation.anchorId === tail.entryId ? (
                <ForkFeedback
                  operation={forkOperation}
                  issue={forkIssue}
                  pending={controlPending}
                  pendingAction={pendingAction}
                  onCheck={readFork}
                  onRetry={() => {
                    if (tail.entryId) forkTurn(tail.entryId)
                  }}
                  onOpen={onOpenConversation}
                />
              ) : undefined
            }
            currentIssueMessage={currentTurnIssue}
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
  }, [
    turns,
    byTurn,
    currentIssueMessage,
    version,
    phase,
    runId,
    statistics,
    historyNotice,
    forkDisabledReason,
    stopping,
    runFailed,
    renderTurnDeliveries,
    forkTurn,
    forkOperation,
    forkBusy,
    forkIssue,
    controlPending,
    pendingAction,
    readFork,
    modelAvailable,
    mutationBlockedReason,
    onOpenConversation,
  ])
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
