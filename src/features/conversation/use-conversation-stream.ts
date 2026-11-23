import { SessionValueStore } from "./session-value-store"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ConversationSnapshot } from "@/contracts/rpc.generated"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { ConversationSnapshotCache } from "./conversation-snapshot-cache"
import type { ConversationService } from "./conversation-service"

export type ConversationStreamCallbacks = {
  onBeforeRead?: (sessionId: string) => void
  onAcceptSnapshot?: (
    snapshot: ConversationSnapshot,
    previous: ConversationSnapshot | undefined
  ) => void
  inspectQueueReceipts?: (
    sessionId: string,
    signal: AbortSignal,
    refreshStorage: boolean
  ) => Promise<unknown>
  shouldRefreshQueueStorage?: () => boolean
  getActiveOwnerIds?: () => string[]
  isLocked?: (sessionId: string) => boolean
  getMutationCount?: (sessionId: string) => number
}

export function useConversationStream({
  selectedId,
  service,
  callbacks,
}: {
  selectedId: string | undefined
  service: ConversationService
  callbacks: ConversationStreamCallbacks
}) {
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })

  const [snapshotStore] = useState(
    () => new SessionValueStore<ConversationSnapshot>()
  )
  const [readIssues, setReadIssues] = useState<
    Record<string, FeedbackDescription | undefined>
  >({})
  const [readPending, setReadPending] = useState<Record<string, boolean>>({})
  const [reloadTick, setReloadTick] = useState(0)

  const current = useRef<Record<string, ConversationSnapshot>>({})
  const snapshotCache = useRef(new ConversationSnapshotCache())
  const readOwners = useRef(new Map<string, AbortController>())
  const homeHandoffs = useRef(new Set<string>())
  const inputReceiptListeners = useRef(
    new Set<(snapshot: ConversationSnapshot) => void>()
  )
  const handoffInputReceipts = useRef(
    new Map<string, Map<string, ConversationSnapshot>>()
  )
  const reloadRequested = useRef<string | undefined>(undefined)
  const selectedOwner = useRef(selectedId)
  useEffect(() => {
    selectedOwner.current = selectedId
  }, [selectedId])

  const publishInputReceipt = useCallback((snapshot: ConversationSnapshot) => {
    if (
      !snapshot.clientRequestId ||
      (!snapshot.inputAccepted && snapshot.inputDisposition !== "handled")
    )
      return
    if (homeHandoffs.current.has(snapshot.id)) {
      // Keep the original ACK until the initial Home owner finishes, even if a
      // newer display snapshot belongs to a different input by that time.
      const receipts =
        handoffInputReceipts.current.get(snapshot.id) ?? new Map()
      receipts.set(snapshot.clientRequestId, snapshot)
      handoffInputReceipts.current.set(snapshot.id, receipts)
      return
    }
    for (const listener of inputReceiptListeners.current) listener(snapshot)
  }, [])

  const subscribeInputReceipts = useCallback(
    (listener: (snapshot: ConversationSnapshot) => void) => {
      inputReceiptListeners.current.add(listener)
      queueMicrotask(() => {
        if (!inputReceiptListeners.current.has(listener)) return
        for (const snapshot of Object.values(current.current)) {
          if (
            !homeHandoffs.current.has(snapshot.id) &&
            snapshot.clientRequestId &&
            (snapshot.inputAccepted || snapshot.inputDisposition === "handled")
          )
            listener(snapshot)
        }
      })
      return () => {
        inputReceiptListeners.current.delete(listener)
      }
    },
    []
  )

  const clearReadIssue = useCallback((id: string) => {
    setReadIssues((all) => (all[id] ? { ...all, [id]: undefined } : all))
  }, [])
  const accept = useCallback(
    (snapshot: ConversationSnapshot) => {
      const previous = current.current[snapshot.id]
      if (snapshot === previous) {
        clearReadIssue(snapshot.id)
        return
      }
      callbacksRef.current.onAcceptSnapshot?.(snapshot, previous)
      // Acceptance belongs to the request, independently of display ordering.
      publishInputReceipt(snapshot)
      if (
        previous?.epoch === snapshot.epoch &&
        previous.version > snapshot.version
      )
        return
      const extraOwners = callbacksRef.current.getActiveOwnerIds?.() ?? []
      current.current = snapshotCache.current.accept(
        snapshot,
        new Set([
          ...(selectedOwner.current ? [selectedOwner.current] : []),
          ...extraOwners,
          ...homeHandoffs.current,
          ...readOwners.current.keys(),
        ])
      )
      snapshotStore.replace(current.current)
      clearReadIssue(snapshot.id)
    },
    [clearReadIssue, publishInputReceipt, snapshotStore]
  )

  useEffect(() => {
    if (!selectedId) return
    callbacksRef.current.onBeforeRead?.(selectedId)
    const controller = new AbortController()
    reloadRequested.current = undefined
    const ownedReads = readOwners.current
    const hasFollow = typeof service.follow === "function"
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      if (homeHandoffs.current.has(selectedId!)) {
        timer = setTimeout(read, 100)
        return
      }
      let failedRead = false
      ownedReads.set(selectedId!, controller)
      if (!current.current[selectedId!])
        setReadPending((all) => ({ ...all, [selectedId!]: true }))
      const before = callbacksRef.current.getMutationCount?.(selectedId!) ?? 0
      try {
        // Receipt reads have their own owner. They never borrow the write lock,
        // infer a result from queue shape, or repeat an original operation.
        const refreshQueueStorage =
          callbacksRef.current.shouldRefreshQueueStorage?.() ?? false
        void callbacksRef.current
          .inspectQueueReceipts?.(
            selectedId!,
            controller.signal,
            refreshQueueStorage
          )
          .catch(() => {
            // Queue recovery publishes its own feedback and blocks unsafe writes.
          })
        const snapshot = hasFollow
          ? await service.follow(
              selectedId!,
              current.current[selectedId!],
              controller.signal
            )
          : await service.read(selectedId!, controller.signal)
        const after = callbacksRef.current.getMutationCount?.(selectedId!) ?? 0
        if (
          !controller.signal.aborted &&
          !callbacksRef.current.isLocked?.(selectedId!) &&
          before === after
        )
          accept(snapshot)
      } catch (error) {
        failedRead = true
        const after = callbacksRef.current.getMutationCount?.(selectedId!) ?? 0
        if (!controller.signal.aborted && before === after)
          setReadIssues((all) => ({
            ...all,
            [selectedId!]: feedbackFromError(
              error,
              "会话暂时无法读取，请重新读取。"
            ),
          }))
      } finally {
        if (ownedReads.get(selectedId!) === controller) {
          ownedReads.delete(selectedId!)
          setReadPending((all) =>
            all[selectedId!] ? { ...all, [selectedId!]: false } : all
          )
        }
        if (!controller.signal.aborted) {
          const phase = current.current[selectedId!]?.phase
          const requested = reloadRequested.current === selectedId
          if (requested) reloadRequested.current = undefined
          timer = setTimeout(
            read,
            requested
              ? 0
              : hasFollow
                ? current.current[selectedId!] && !failedRead
                  ? 0
                  : 1000
                : phase === "running" || phase === "stopping"
                  ? 250
                  : 1600
          )
        }
      }
    }
    void read()
    return () => {
      controller.abort()
      clearTimeout(timer)
      if (ownedReads.get(selectedId) === controller) {
        ownedReads.delete(selectedId)
        setReadPending((all) =>
          all[selectedId] ? { ...all, [selectedId]: false } : all
        )
      }
    }
  }, [selectedId, service, reloadTick, accept])

  const reload = useCallback(() => {
    if (!selectedId || reloadRequested.current === selectedId) return
    reloadRequested.current = selectedId
    setReadPending((all) => ({ ...all, [selectedId]: true }))
    // Coalesce refreshes into the next read; do not abort the current read.
    if (!readOwners.current.has(selectedId)) setReloadTick((value) => value + 1)
  }, [selectedId])

  return {
    snapshotStore,
    current,
    readIssues,
    clearReadIssue,
    readPending,
    readOwners,
    homeHandoffs,
    handoffInputReceipts,
    publishInputReceipt,
    subscribeInputReceipts,
    accept,
    reload,
  }
}
