import { useCallback, useEffect, useRef, useState } from "react"
import type { HomeDraft } from "@/features/home/home-types"
import {
  effectiveThinking,
  thinkingLabels,
} from "@/features/home/model-thinking"
import {
  modelSelectionId,
  type ModelConnection,
} from "@/features/models/model-types"
import type { ConversationSnapshot } from "@/features/models/model-contract.generated"
import { createConversationService } from "./conversation-service"
import { RpcRequestRejected } from "@/features/models/model-service"
import { draftSignature, restoreConversationDrafts, saveConversationDraft, saveConversationRequest, type PendingSubmission } from "./conversation-draft-store"

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
export function resolveConversationModel(
  connections: ModelConnection[],
  draft: HomeDraft
) {
  for (const connection of connections) {
    const model = connection.models.find(
      (item) => modelSelectionId(connection, item) === draft.model
    )
    if (!model) continue
    if (!model.supportedThinkingLevels)
      throw new Error("模型能力未完整读取，请重启 Moon 后重试。")
    const selectedLabel = effectiveThinking(
      draft.thinking,
      model.supportedThinkingLevels.map((level) => thinkingLabels[level])
    )
    const thinking =
      Object.entries(thinkingLabels).find(
        ([, label]) => label === selectedLabel
      )?.[0] ?? "off"
    return {
      connectionId: connection.id,
      modelId: model.id,
      thinking: thinking as ConversationSnapshot["thinking"],
    }
  }
  throw new Error("所选模型已不可用，请重新选择模型。")
}

/** Server snapshots and editing drafts are separate; polling never replaces input. */
export function useLiveConversation(selectedId: string | undefined) {
  const [service] = useState(createConversationService)
  const [restored] = useState(restoreConversationDrafts)
  const [snapshots, setSnapshots] = useState<
    Record<string, ConversationSnapshot>
  >({})
  const [drafts, setDrafts] = useState<Record<string, HomeDraft>>(restored.drafts)
  const draftsRef = useRef(drafts)
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [readErrors, setReadErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [reload, setReload] = useState(0)
  const current = useRef(snapshots)
  const requests = useRef(restored.requests)
  const locks = useRef(new Set<string>())
  const mutations = useRef(new Map<string, number>())
  const changeDraft = useCallback((id: string, draft: HomeDraft) => {
    draftsRef.current = { ...draftsRef.current, [id]: draft }
    setDrafts(draftsRef.current)
    try { saveConversationDraft(id, draft); setDraftErrors((all) => ({ ...all, [id]: "" })) }
    catch { setDraftErrors((all) => ({ ...all, [id]: "草稿未保存，请释放本地存储空间后重试。" })) }
  }, [])
  const accept = useCallback((snapshot: ConversationSnapshot) => {
    current.current = { ...current.current, [snapshot.id]: snapshot }
    setSnapshots(current.current)
    setReadErrors((all) => ({ ...all, [snapshot.id]: "" }))
    const submission = requests.current.get(snapshot.id)
    const accepted = submission && (snapshot.queue?.acceptedRequestIds.includes(submission.id) || (snapshot.clientRequestId === submission.id && snapshot.inputAccepted))
    const rejected = submission && snapshot.clientRequestId === submission.id && !snapshot.inputAccepted && ["failed", "interrupted"].includes(snapshot.phase)
    if (submission && (accepted || rejected)) {
      const editing = draftsRef.current[snapshot.id]
      if (accepted && submission.kind === "send" && editing && draftSignature(editing) === draftSignature(submission.draft)) changeDraft(snapshot.id, { ...editing, text: "", materials: [] })
      requests.current.delete(snapshot.id)
      try { saveConversationRequest(snapshot.id) } catch { setDraftErrors((all) => ({ ...all, [snapshot.id]: "发送已确认，但本地回执清理失败；重新打开后将先核对原请求。" })) }
    }
  }, [changeDraft])
  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      const before = mutations.current.get(selectedId!) ?? 0
      try {
        const snapshot = await service.read(selectedId!, controller.signal)
        if (
          !controller.signal.aborted &&
          !locks.current.has(selectedId!) &&
          before === (mutations.current.get(selectedId!) ?? 0)
        )
          accept(snapshot)
      } catch (error) {
        if (
          !controller.signal.aborted &&
          before === (mutations.current.get(selectedId!) ?? 0)
        )
          setReadErrors((all) => ({
            ...all,
            [selectedId!]: failureMessage(error),
          }))
      } finally {
        if (!controller.signal.aborted) {
          const phase = current.current[selectedId!]?.phase
          timer = setTimeout(
            read,
            phase === "running" || phase === "stopping" ? 250 : 1600
          )
        }
      }
    }
    void read()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [selectedId, service, reload, accept])
  const submissionFor = (id: string, value: Omit<Extract<PendingSubmission, { kind: "send" }>, "id"> | Omit<Extract<PendingSubmission, { kind: "retry" }>, "id">) => {
    const existing = requests.current.get(id)
    if (existing?.signature === value.signature) return existing
    if (existing) throw new Error("上一条发送结果尚未确认。请先核对发送；当前新草稿会保留。")
    const submission = { ...value, id: crypto.randomUUID() } as PendingSubmission
    saveConversationRequest(id, submission)
    requests.current.set(id, submission)
    return submission
  }
  async function submit(id: string, submission: PendingSubmission, signal?: AbortSignal) {
    try {
      return submission.kind === "send"
        ? await service.send({ ...submission.input, clientRequestId: submission.id }, signal)
        : await service.retry({ ...submission.input, clientRequestId: submission.id })
    } catch (error) {
      if (error instanceof RpcRequestRejected) {
        requests.current.delete(id)
        try { saveConversationRequest(id) } catch { /* Stored receipt remains safe to reconcile. */ }
      }
      throw error
    }
  }
  async function perform(
    id: string,
    action: () => Promise<ConversationSnapshot>
  ) {
    if (locks.current.has(id)) throw new Error("正在处理此会话的操作，请稍候。")
    locks.current.add(id)
    mutations.current.set(id, (mutations.current.get(id) ?? 0) + 1)
    setPending((all) => ({ ...all, [id]: true }))
    try {
      const snapshot = await action()
      accept(snapshot)
      setErrors((all) => ({ ...all, [id]: "" }))
      return snapshot
    } catch (error) {
      setErrors((all) => ({ ...all, [id]: failureMessage(error) }))
      throw error
    } finally {
      locks.current.delete(id)
      setPending((all) => ({ ...all, [id]: false }))
    }
  }
  async function send(
    id: string,
    draft: HomeDraft,
    connections: ModelConnection[],
    signal?: AbortSignal
  ) {
    // Preflight failures have no user history to recover from. Keep the exact
    // draft before resolving the model or calling the service, including sends
    // from the homepage; only an accepted input clears it below.
    changeDraft(id, draft)
    const snapshot = await perform(id, () => {
      const input = {
        sessionId: id,
        workspaceId: draft.workspaceId,
        text: draft.text.trim(),
        materials: draft.materials,
        ...resolveConversationModel(connections, draft),
      }
      const submission = submissionFor(id, { kind: "send", input, signature: JSON.stringify(["send", draftSignature(draft), input.connectionId, input.modelId, input.thinking]), draft })
      return submit(id, submission, signal)
    })
    return snapshot
  }
  async function stop(id: string) {
    const snapshot = current.current[id]
    if (!snapshot) return
    await perform(id, () => service.stop(id, snapshot.runId))
  }
  async function retry(
    id: string,
    draft: HomeDraft,
    connections: ModelConnection[]
  ) {
    const model = resolveConversationModel(connections, draft)
    await perform(id, () => submit(id, submissionFor(id, { kind: "retry", input: { sessionId: id, ...model }, signature: JSON.stringify({ retry: true, ...model }), draft })))
  }
  return {
    snapshots,
    drafts,
    errors: Object.fromEntries(
      Array.from(
        new Set([...Object.keys(errors), ...Object.keys(readErrors), ...Object.keys(draftErrors)])
      ).map((id) => [id, errors[id] || readErrors[id] || draftErrors[id] || ""])
    ),
    pending,
    send,
    stop,
    retry,
    unconfirmed: Object.fromEntries([...requests.current.keys()].map((id) => [id, true])),
    submissionDraft: (id: string) => requests.current.get(id)?.draft,
    reconcile: (id: string) => perform(id, async () => {
      // Reuse the original payload/ID. Checking a lost reply cannot submit the
      // newly edited draft or create a duplicate request.
      const submission = requests.current.get(id)
      if (!submission) return service.read(id)
      return submit(id, submission)
    }),
    reload: () => setReload((value) => value + 1),
    change: changeDraft,
    saveDraft: (id: string) => { if (draftsRef.current[id]) changeDraft(id, draftsRef.current[id]) },
    queueEdit: (id: string, itemId: string, text: string) => perform(id, () => service.queueEdit({ sessionId: id, itemId, text, revision: current.current[id]?.queue?.revision ?? 0 })),
    queueRemove: (id: string, itemId: string) => perform(id, () => service.queueRemove({ sessionId: id, itemId, revision: current.current[id]?.queue?.revision ?? 0 })),
    queueMode: (id: string, mode: "single" | "all") => perform(id, () => service.queueMode({ sessionId: id, mode, revision: current.current[id]?.queue?.revision ?? 0 })),
    queueDeliver: (id: string, itemId: string) => perform(id, () => service.queueDeliver({ sessionId: id, itemId, revision: current.current[id]?.queue?.revision ?? 0 })),
  }
}
