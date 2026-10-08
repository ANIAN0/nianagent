export { validateWriteReceipts } from "./write-receipt-validation.mjs"
import { createHash, randomUUID } from "node:crypto"
import { operationError, publicFailure } from "./operation-issue.mjs"
import { readArchivedWrite } from "./write-receipt-archive.mjs"
export { writeOperations } from "./write-receipt-contract.mjs"

const ownerEpoch = randomUUID()
const identity = (value) => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value)
  )
    throw new Error("写入请求标识无效。")
}
const fingerprint = (operation, targetId, input) =>
  createHash("sha256")
    .update(JSON.stringify([operation, targetId, input]))
    .digest("hex")
export function presentWriteReceipt(operation, requestId, receipt) {
  identity(requestId)
  const matched = receipt?.operation === operation
  if (!matched)
    return {
      operationRequestId: requestId,
      operation,
      targetId: "",
      state: "unknown",
    }
  const rejected =
    receipt.status === "rejected" ||
    (receipt.status === "preparing" && receipt.ownerEpoch !== ownerEpoch)
  return {
    operationRequestId: requestId,
    operation,
    targetId: receipt.targetId,
    state:
      receipt.status === "committed"
        ? "committed"
        : rejected
          ? "rejected"
          : "unknown",
    ...(receipt.revision !== undefined ? { revision: receipt.revision } : {}),
    ...(receipt.issue
      ? { issue: receipt.issue }
      : rejected
        ? {
            issue: {
              code: "write_not_committed",
              summary: "原操作在提交前已中断，已保存数据保持原状。",
              severity: "info",
              recovery: "none",
            },
          }
        : {}),
  }
}
export async function readWriteReceipt(store, operation, requestId, signal) {
  identity(requestId)
  signal?.throwIfAborted()
  const document = await store.read()
  signal?.throwIfAborted()
  return presentWriteReceipt(
    operation,
    requestId,
    document.writeReceipts?.[requestId] ??
      (await readArchivedWrite(store, requestId))
  )
}

// The receipt and business mutation share one atomic document. A preparing
// receipt is never proof of success; a query never runs the original action.
export async function recordedWrite({
  store,
  operation,
  targetId,
  input,
  requestId,
  signal,
  action,
  replay,
}) {
  if (requestId === undefined) return action()
  identity(requestId)
  const digest = fingerprint(operation, targetId, input)
  let existing
  await store.update(async (document) => {
    document.writeReceipts ??= {}
    existing =
      document.writeReceipts[requestId] ??
      (await readArchivedWrite(store, requestId))
    if (existing) {
      if (
        existing.operation !== operation ||
        existing.targetId !== targetId ||
        existing.fingerprint !== digest
      )
        throw operationError(
          "write_identity_conflict",
          "此操作标识已用于其他内容，请先核对原操作。",
          "check"
        )
      return
    }
    document.writeReceipts[requestId] = {
      operationRequestId: requestId,
      operation,
      targetId,
      fingerprint: digest,
      ownerEpoch,
      status: "preparing",
      updatedAt: new Date().toISOString(),
    }
  }, signal)
  if (existing) {
    if (existing.status === "committed") {
      try {
        return await replay(existing)
      } catch {
        throw operationError(
          "result_unknown",
          "原操作已提交，但当前结果暂时无法读取，请核对原回执。",
          "check"
        )
      }
    }
    const publicReceipt = presentWriteReceipt(operation, requestId, existing)
    if (publicReceipt.state === "rejected")
      throw Object.assign(new Error(publicReceipt.issue.summary), {
        name: "MoonOperationError",
        issue: publicReceipt.issue,
      })
    throw operationError(
      "result_unknown",
      "原操作仍待确认，请核对原回执；不会再次执行。",
      "check"
    )
  }
  const commit = (document, revision) => {
    const receipt = document.writeReceipts?.[requestId]
    if (
      !receipt ||
      receipt.fingerprint !== digest ||
      receipt.status !== "preparing" ||
      receipt.ownerEpoch !== ownerEpoch
    )
      throw operationError(
        "write_identity_conflict",
        "原操作身份已变化，未提交本次修改。",
        "check"
      )
    receipt.status = "committed"
    receipt.updatedAt = new Date().toISOString()
    if (revision !== undefined) receipt.revision = revision
  }
  try {
    return await action(commit)
  } catch (error) {
    let committed = false
    try {
      // Do not turn a committed write into rejection because response/cleanup
      // failed. If the document cannot be read, preserve the unknown outcome.
      await store.update(async (document) => {
        const receipt =
          document.writeReceipts?.[requestId] ??
          (await readArchivedWrite(store, requestId))
        if (receipt?.status === "committed" && receipt.fingerprint === digest) {
          committed = true
          return
        }
        if (
          receipt?.status === "preparing" &&
          receipt.fingerprint === digest &&
          receipt.ownerEpoch === ownerEpoch
        ) {
          receipt.status = "rejected"
          receipt.updatedAt = new Date().toISOString()
          receipt.issue = publicFailure(error, operation, signal?.aborted).issue
        }
      })
    } catch {
      throw operationError(
        "result_unknown",
        "原操作结果暂时无法读取，请核对原回执；输入副本保留。",
        "check"
      )
    }
    if (committed)
      throw operationError(
        "result_unknown",
        "原操作已提交，但响应未完成，请只读核对原回执；输入副本保留。",
        "check"
      )
    throw error
  }
}
