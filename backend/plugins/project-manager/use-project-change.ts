import { useState } from "react"
import { notifyToast } from "@/components/ui/notification-toast"
import { profileLocalStorage } from "@/lib/rpc/profile-storage"
import { invoke, type Preview } from "./service"

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export function useProjectChange({
  projectId,
  expectedRevision,
  onApplied,
}: {
  projectId: string
  expectedRevision?: string
  onApplied: () => void
}) {
  const [preview, setPreview] = useState<Preview>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [requestId, setRequestId] = useState("")
  const [lastResult, setLastResult] = useState("")

  const receiptKey = "moon.project-manager.receipt." + projectId
  const hasReceipt = Boolean(
    projectId && profileLocalStorage.getItem(receiptKey)
  )

  async function run(action: () => Promise<void>) {
    setPending(true)
    setError("")
    try {
      await action()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  async function buildPreview(change: object) {
    const result = await invoke<Preview | { conflicts: string[] }>(
      "previewChange",
      { projectId, expectedRevision, change }
    )
    if ("conflicts" in result) return result.conflicts
    setPreview({
      ...result,
      format:
        "kind" in change &&
        typeof change.kind === "string" &&
        change.kind.startsWith("agents.")
          ? "diff"
          : "summary",
    })
    setRequestId(crypto.randomUUID())
    return []
  }

  async function prepare(change: object) {
    await run(async () => {
      await buildPreview(change)
    })
  }

  async function recover() {
    await run(async () => {
      const raw = profileLocalStorage.getItem(receiptKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      const r = await invoke<{ outcome: string; reason: string }>(
        "getReceipt",
        { requestId: saved.requestId }
      )
      setLastResult(r.reason || r.outcome)
      if (
        ["pending", "partialFailure", "unknown", "stopped"].includes(r.outcome)
      ) {
        setPreview({
          previewId: saved.previewId,
          diff: r.reason || "核对并继续原操作",
        })
        setRequestId(saved.requestId)
      }
    })
  }

  async function apply() {
    await run(async () => {
      profileLocalStorage.setItem(
        receiptKey,
        JSON.stringify({ previewId: preview?.previewId, requestId })
      )
      const result = await invoke<{ outcome: string; reason: string }>(
        "applyChange",
        { previewId: preview?.previewId, requestId }
      )
      if (!["created", "replaced", "written"].includes(result.outcome))
        throw new Error(result.reason || result.outcome)
      notifyToast("修改已应用", { tone: "success" })
      setLastResult(result.reason || "修改已应用。")
      setPreview(undefined)
      onApplied()
    })
  }

  function reset() {
    setError("")
    setPreview(undefined)
    setLastResult("")
  }

  return {
    preview,
    pending,
    error,
    setError,
    lastResult,
    hasReceipt,
    run,
    buildPreview,
    prepare,
    recover,
    apply,
    closePreview: () => setPreview(undefined),
    reset,
  }
}
