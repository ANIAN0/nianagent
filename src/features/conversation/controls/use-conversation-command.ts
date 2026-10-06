import { useContext, useRef, useState } from "react"
import { CommandServiceContext } from "./command-service"
import type { ConversationCommandReceipt } from "@/features/models/model-contract.generated"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
type PendingCommand = { id: string; text: string }
const key = (id: string) => `moon.command.pending.v1:${id}`
export function useConversationCommand(
  sessionId: string,
  command?: ConversationCommandReceipt
) {
  const service = useContext(CommandServiceContext)
  const [pending, setPending] = useState<PendingCommand | undefined>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(key(sessionId)) || "null") || undefined
      )
    } catch {
      return undefined
    }
  })
  const [storedReceipt, setReceipt] = useState<ConversationCommandReceipt>()
  const [issue, setIssue] = useState<FeedbackDescription>()
  const [checking, setChecking] = useState(false)
  const lock = useRef(false)
  const receipt = command?.id === pending?.id ? command : storedReceipt
  async function check() {
    if (!pending || !service || lock.current) return
    lock.current = true
    setChecking(true)
    try {
      setReceipt(await service.read(sessionId, pending.id))
      setIssue(undefined)
    } catch (error) {
      setIssue(feedbackFromError(error))
    } finally {
      lock.current = false
      setChecking(false)
    }
  }
  async function run(text: string, name: string) {
    if (lock.current) return
    if (!service) {
      setIssue(feedbackFromError(new Error("命令服务不可用。")))
      return
    }
    if (pending && !["completed", "failed"].includes(receipt?.status ?? ""))
      throw new Error("请先核对原命令，当前输入保留。")
    const next = { id: crypto.randomUUID(), text }
    try {
      localStorage.setItem(key(sessionId), JSON.stringify(next))
    } catch (error) {
      setIssue(
        feedbackFromError(error, "命令尚未执行，原请求无法保存。当前输入保留。")
      )
      return
    }
    setPending(next)
    setReceipt(undefined)
    setIssue(undefined)
    lock.current = true
    setChecking(true)
    try {
      setReceipt(
        await service.run(
          sessionId,
          next.id,
          name,
          text
            .trim()
            .slice(name.length + 1)
            .trimStart()
        )
      )
    } catch (error) {
      setIssue(feedbackFromError(error))
    } finally {
      lock.current = false
      setChecking(false)
    }
  }
  function acknowledge() {
    try {
      localStorage.removeItem(key(sessionId))
    } catch (error) {
      setIssue(feedbackFromError(error, "命令已结束，本地回执尚未清理。"))
      return
    }
    setPending(undefined)
    setReceipt(undefined)
    setIssue(undefined)
  }
  return { pending, receipt, issue, checking, run, check, acknowledge }
}
