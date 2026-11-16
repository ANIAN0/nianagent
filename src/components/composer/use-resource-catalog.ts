import { useContext, useEffect, useState } from "react"
import type { Material } from "@/lib/composer/types"
import type {
  ConversationCommand,
  MaterialDiagnostic,
} from "@/contracts/rpc.generated"
import { MaterialServiceContext } from "@/lib/composer/material-service-port"
import { useRemoteConnectionRevision } from "@/lib/rpc/use-remote-connection"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

export function useResourceCatalog({
  sessionId = "",
  cwd = "",
  query,
  enabled,
}: {
  sessionId?: string
  cwd?: string
  query: string
  enabled: boolean
}) {
  const service = useContext(MaterialServiceContext)
  const connectionRevision = useRemoteConnectionRevision()
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    key: string
    files: Material[]
    skills: Material[]
    diagnostics: MaterialDiagnostic[]
    commands?: ConversationCommand[]
    error?: string
    issue?: FeedbackDescription
  }>()
  const key = `${sessionId}:${cwd}:${query}:${revision}:${connectionRevision}`
  useEffect(() => {
    if (!enabled || !service || !sessionId || !cwd) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void service
        .catalog(sessionId, cwd, query, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setResult({ key, ...data })
        })
        .catch((error: unknown) => {
          // Closing candidates or changing their owner cancels silently. A
          // cancelled current read remains recoverable without becoming red.
          if (controller.signal.aborted) return
          const feedback = feedbackFromError(
            error,
            "材料列表未能读取，请重新读取。"
          )
          const issue =
            feedback.code === "cancelled"
              ? {
                  ...feedback,
                  message: "资源读取已取消，可重新读取。",
                  recovery: "retry" as const,
                }
              : feedback
          setResult({
            key,
            files: [],
            skills: [],
            diagnostics: [],
            error: issue.code === "cancelled" ? undefined : issue.message,
            issue,
          })
        })
    }, 160)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, service, sessionId, cwd, query, key])
  if (!service)
    // G07：生产装配缺失显式失败，不以空/fallback 数据冒充能力；预览用例须显式提供 fixture Provider。
    return {
      files: [],
      skills: [],
      diagnostics: [],
      commands: [],
      error: "材料服务未装配。",
      issue: undefined,
      loading: false,
      retry: () => {},
    }
  const current = result?.key === key ? result : undefined
  return {
    files: current?.files ?? [],
    skills: current?.skills ?? [],
    diagnostics: current?.diagnostics ?? [],
    commands: current?.commands ?? [],
    error: current?.error,
    issue: current?.issue,
    loading: enabled && !current,
    retry: () => setRevision((value) => value + 1),
  }
}
