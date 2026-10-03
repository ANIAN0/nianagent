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
  const [snapshots, setSnapshots] = useState<
    Record<string, ConversationSnapshot>
  >({})
  const [drafts, setDrafts] = useState<Record<string, HomeDraft>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [readErrors, setReadErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [reload, setReload] = useState(0)
  const current = useRef(snapshots)
  const requests = useRef(new Map<string, { signature: string; id: string }>())
  const locks = useRef(new Set<string>())
  const mutations = useRef(new Map<string, number>())
  const accept = useCallback((snapshot: ConversationSnapshot) => {
    current.current = { ...current.current, [snapshot.id]: snapshot }
    setSnapshots(current.current)
    setReadErrors((all) => ({ ...all, [snapshot.id]: "" }))
  }, [])
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
  const requestId = (id: string, signature: string) => {
    const existing = requests.current.get(id)
    if (existing?.signature === signature) return existing.id
    const value = { signature, id: crypto.randomUUID() }
    requests.current.set(id, value)
    return value.id
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
    setDrafts((all) => ({ ...all, [id]: draft }))
    const snapshot = await perform(id, () => {
      const input = {
        sessionId: id,
        workspaceId: draft.workspaceId,
        text: draft.text.trim(),
        ...resolveConversationModel(connections, draft),
      }
      const clientRequestId = requestId(id, JSON.stringify(input))
      return service.send({ ...input, clientRequestId }, signal)
    })
    requests.current.delete(id)
    if (!snapshot.inputAccepted) return snapshot
    setDrafts((all) => ({
      ...all,
      [id]:
        all[id] && all[id].text.trim() !== draft.text.trim()
          ? all[id]
          : { ...(all[id] ?? draft), text: "", materials: [] },
    }))
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
    const clientRequestId = requestId(
      id,
      JSON.stringify({ retry: true, ...model })
    )
    await perform(id, () =>
      service.retry({ sessionId: id, clientRequestId, ...model })
    )
    requests.current.delete(id)
  }
  return {
    snapshots,
    drafts,
    errors: Object.fromEntries(
      Array.from(
        new Set([...Object.keys(errors), ...Object.keys(readErrors)])
      ).map((id) => [id, errors[id] || readErrors[id] || ""])
    ),
    pending,
    send,
    stop,
    retry,
    reload: () => setReload((value) => value + 1),
    change: (id: string, draft: HomeDraft) =>
      setDrafts((all) => ({ ...all, [id]: draft })),
  }
}
