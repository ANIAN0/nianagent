import type { ComposerDraft } from "@/lib/composer/types"
import type { HomeDraftCache } from "@/features/conversation/conversation-draft-store"
import { feedbackFromError } from "@/lib/operation-issue"

export type RetainedHomeView = { key: number; draft: ComposerDraft }
export type RetainedHomeViews = Record<number, RetainedHomeView>

export function hasPreparingHomeMaterials(
  draft: Partial<ComposerDraft> | undefined
) {
  return !!draft?.materials?.some((item) => item.status === "preparing")
}

/** Keep the same operation owner until its already-started preparations settle. */
export function retainPreparingHomeView(
  previous: RetainedHomeViews,
  draft: ComposerDraft,
  key: number,
  submitted: boolean,
  activeSelection = false,
  awaitingRecovery = false
): RetainedHomeViews {
  if (awaitingRecovery) return { ...previous, [key]: { key, draft } }
  if (
    (activeSelection || hasPreparingHomeMaterials(draft)) &&
    (submitted || previous[key])
  )
    return { ...previous, [key]: { key, draft } }
  if (!previous[key]) return previous
  const next = { ...previous }
  delete next[key]
  return next
}

/** A retained hidden owner must never replace another visible Home's cache. */
export function changeOwnedHomeCache(
  previous: HomeDraftCache,
  draft: ComposerDraft,
  key: number
) {
  return previous.key === key ? { ...previous, draft } : previous
}

export function nextHomeViewKey(
  previous: HomeDraftCache,
  retained: RetainedHomeViews
) {
  return (
    Math.max(previous.key, ...Object.values(retained).map((view) => view.key)) +
    1
  )
}

/** No chat request has crossed the boundary when configuration transport fails. */
export function homePreflightError(error: unknown, phase: "read" | "apply") {
  const feedback = feedbackFromError(error)
  if (feedback.code === "cancelled") return error
  if (
    feedback.code !== "result_unknown" &&
    feedback.recovery !== "check" &&
    feedback.recovery !== "restart"
  )
    return error
  const summary =
    phase === "read"
      ? "消息尚未发送，会话配置未能读取。原输入已恢复，请重新读取配置后重试。"
      : "消息尚未发送，会话配置的保存结果未能确认。原输入已恢复，请重新读取配置后重试。"
  return Object.assign(new Error(summary, { cause: error }), {
    issue: {
      code: "session_preflight",
      summary,
      details: feedback.message,
      recovery: feedback.recovery === "restart" ? "restart" : "reload",
      severity: "warning",
    },
  })
}
