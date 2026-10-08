import { writeOperations } from "./write-receipt-contract.mjs"
const identity = (value) => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value)
  )
    throw new Error("写入请求标识无效。")
}
export function validateWriteReceipts(value) {
  if (value === undefined) return
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("操作回执结构损坏；原文件未覆盖。")
  for (const [id, receipt] of Object.entries(value)) {
    identity(id)
    if (
      !receipt ||
      receipt.operationRequestId !== id ||
      !writeOperations.includes(receipt.operation) ||
      typeof receipt.targetId !== "string" ||
      !/^[a-f0-9]{64}$/.test(receipt.fingerprint) ||
      !["preparing", "committed", "rejected"].includes(receipt.status) ||
      typeof receipt.ownerEpoch !== "string" ||
      typeof receipt.updatedAt !== "string" ||
      (receipt.revision !== undefined &&
        (!Number.isSafeInteger(receipt.revision) || receipt.revision < 0))
    )
      throw new Error("操作回执结构损坏；原文件未覆盖。")
    if (
      receipt.issue &&
      (typeof receipt.issue.code !== "string" ||
        typeof receipt.issue.summary !== "string" ||
        !["retry", "reload", "check", "settings", "restart", "none"].includes(
          receipt.issue.recovery
        ) ||
        !["error", "warning", "info"].includes(receipt.issue.severity) ||
        (receipt.issue.details !== undefined &&
          typeof receipt.issue.details !== "string"))
    )
      throw new Error("操作回执问题结构损坏；原文件未覆盖。")
  }
}
