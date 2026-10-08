import { useContext, useLayoutEffect, useMemo, useRef, useState } from "react"
import { CommandServiceContext } from "./command-service"
import type { ConversationCommandReceipt } from "@/contracts/rpc.generated"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import {
  readCommandPending,
  retainCommandPending,
  clearCommandPending,
  commandArguments,
  type PendingCommand,
} from "./command-pending-store"

export function useConversationCommand(
  sessionId: string,
  command?: ConversationCommandReceipt
) {
  const service = useContext(CommandServiceContext)
  const initial = useMemo(() => readCommandPending(sessionId), [sessionId])
  const token = useMemo(() => ({ sessionId }), [sessionId])
  const owner = useRef<typeof token | undefined>(undefined)
  const [recovery, setRecovery] = useState(initial)
  const [stored, setStored] = useState<ConversationCommandReceipt>()
  const [issue, setIssue] = useState<FeedbackDescription>()
  const [checking, setChecking] = useState(false)
  const [renderedToken, setRenderedToken] = useState(token)
  if (renderedToken !== token) {
    setRenderedToken(token)
    setRecovery(initial)
    setStored(undefined)
    setIssue(undefined)
    setChecking(false)
  }
  const lock = useRef(false)
  const current = recovery.sessionId === sessionId ? recovery : initial
  const pending = current.pending
  const receipt =
    command?.sessionId === sessionId && command.id === pending?.id
      ? command
      : stored?.sessionId === sessionId && stored.id === pending?.id
        ? stored
        : undefined
  useLayoutEffect(() => {
    owner.current = token
    lock.current = false
    return () => {
      if (owner.current === token) owner.current = undefined
    }
  }, [initial, token])
  const owns = () => owner.current === token
  const accept = (
    value: ConversationCommandReceipt,
    original: PendingCommand
  ) => {
    if (value.sessionId !== original.sessionId || value.id !== original.id)
      throw new Error("命令回复与原请求身份不一致，当前输入保留。")
    if (owns()) {
      setStored(value)
      setIssue(undefined)
    }
  }
  async function check() {
    if (!service || lock.current) return
    lock.current = true
    setChecking(true)
    try {
      const restored = readCommandPending(sessionId)
      setRecovery(restored)
      if (restored.error) throw restored.error
      if (restored.pending)
        accept(
          await service.read(sessionId, restored.pending.id),
          restored.pending
        )
      else setIssue(undefined)
    } catch (error) {
      if (owns()) setIssue(feedbackFromError(error))
    } finally {
      if (owns()) {
        lock.current = false
        setChecking(false)
      }
    }
  }
  function acknowledge() {
    if (
      !pending ||
      !receipt ||
      !["completed", "failed"].includes(receipt.status)
    )
      return false
    try {
      clearCommandPending(pending)
      setRecovery({ sessionId })
      setStored(undefined)
      setIssue(undefined)
      return true
    } catch (error) {
      setIssue(
        feedbackFromError(error, "命令已结束，本地回执尚未清理；原记录保留。")
      )
      return false
    }
  }
  async function run(text: string, name: string) {
    if (lock.current) return
    let argumentsText: string
    try {
      argumentsText = commandArguments(text, name)
    } catch (error) {
      setIssue(feedbackFromError(error))
      return
    }
    if (!service || current.error) {
      setIssue(
        feedbackFromError(current.error ?? new Error("命令服务不可用。"))
      )
      return
    }
    if (
      pending &&
      (!receipt ||
        !["completed", "failed"].includes(receipt.status) ||
        !acknowledge())
    )
      throw new Error("请先核对原命令，当前输入保留。")
    const next: PendingCommand = {
      version: 1,
      sessionId,
      id: crypto.randomUUID(),
      text,
    }
    try {
      retainCommandPending(next)
    } catch (error) {
      setIssue(
        feedbackFromError(error, "命令尚未执行，原请求无法保存。当前输入保留。")
      )
      return
    }
    setRecovery({ sessionId, pending: next })
    setStored(undefined)
    setIssue(undefined)
    lock.current = true
    setChecking(true)
    try {
      // 只有带原身份的 failed/completed 回执才结束门禁；RPC 错误不能证明未执行。
      accept(await service.run(sessionId, next.id, name, argumentsText), next)
    } catch (error) {
      if (owns()) setIssue(feedbackFromError(error))
    } finally {
      if (owns()) {
        lock.current = false
        setChecking(false)
      }
    }
  }
  return {
    pending,
    receipt,
    issue: current.error ? feedbackFromError(current.error) : issue,
    storageBlocked: !!current.error,
    checking,
    run,
    check,
    acknowledge,
  }
}
