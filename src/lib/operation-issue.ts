import type { OperationIssue } from "@/features/models/model-contract.generated"

export type FeedbackDescription = {
  message: string
  details?: string
  code: string
  recovery?: OperationIssue["recovery"]
  severity?: OperationIssue["severity"]
}

export function isOperationIssue(value: unknown): value is OperationIssue {
  if (!value || typeof value !== "object") return false
  const issue = value as Record<string, unknown>
  return (
    typeof issue.code === "string" &&
    typeof issue.summary === "string" &&
    (issue.details === undefined || typeof issue.details === "string") &&
    ["retry", "reload", "check", "settings", "restart", "none"].includes(
      String(issue.recovery)
    ) &&
    ["error", "warning", "info"].includes(String(issue.severity))
  )
}

/** Prefer the service's safe reason; browser/SDK exceptions never become UI copy. */
export function feedbackFromError(
  error: unknown,
  fallback = "本次操作未完成，请重试。"
): FeedbackDescription {
  if (
    error &&
    typeof error === "object" &&
    "issue" in error &&
    isOperationIssue(error.issue)
  )
    return {
      message: error.issue.summary,
      details: error.issue.details,
      code: error.issue.code,
      recovery: error.issue.recovery,
      severity: error.issue.severity,
    }
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  )
    return {
      message: "已取消本次操作。",
      code: "cancelled",
      recovery: "none",
      severity: "info",
    }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  // Older hosts and local validation already provide Chinese product reasons.
  // Do not display a raw URL, credential, HTTP body or JS exception as a reason.
  const safe =
    /[\u4e00-\u9fff]/u.test(message) &&
    !/https?:|Bearer|api[_-]?key|[A-Z]:[\\/]|\bat\s+\S+\(/i.test(message)
  return { message: safe ? message : fallback, code: "operation_failed" }
}
