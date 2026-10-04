import { createHash } from "node:crypto"
import { assertSchema } from "./schema.mjs"
import { queueOperationReceiptStorageSchema } from "./queue-contract.mjs"
import { operationError, publicFailure } from "./operation-issue.mjs"

export function validateQueueOperationReceipts(value, sessionId) {
  if (value === undefined) return
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("队列操作回执结构损坏；原文件未覆盖。")
  try {
    for (const [id, receipt] of Object.entries(value)) {
      assertSchema(queueOperationReceiptStorageSchema, receipt, "队列原操作回执")
      if (id !== receipt.operationRequestId || receipt.sessionId !== sessionId || ["__proto__", "constructor", "prototype"].includes(id) ||
          (receipt.operation === "conversationQueueMode" ? !receipt.mode || receipt.itemId !== undefined : !receipt.itemId || receipt.mode !== undefined) ||
          !Number.isSafeInteger(receipt.baseRevision) || (receipt.status === "committed" ? !Number.isSafeInteger(receipt.revision) : receipt.revision !== undefined)) throw new Error()
    }
  } catch { throw new Error("队列操作回执记录损坏；原文件未覆盖。") }
}

// Receipts belong to the same queue document and serialization owner. They
// describe the adoption of an action, never model completion or user-input ACK.
export class QueueOperationReceipts {
  constructor(queue) { this.queue = queue }
  present(sessionId, operationRequestId, receipt) {
    const identity = { sessionId, operationRequestId }
    if (!receipt) return { ...identity, state: "unknown", retryOriginalAllowed: true }
    const rejected = receipt.status === "rejected" || (receipt.status === "preparing" && receipt.ownerEpoch !== this.queue.ownerEpoch)
    return {
      ...identity, operation: receipt.operation, baseRevision: receipt.baseRevision,
      ...(receipt.revision !== undefined ? { revision: receipt.revision } : {}),
      ...(receipt.itemId ? { itemId: receipt.itemId } : {}), ...(receipt.mode ? { mode: receipt.mode } : {}),
      state: receipt.status === "committed" ? "committed" : rejected ? "rejected" : "unknown",
      ...(receipt.issue ? { issue: receipt.issue } : rejected ? { issue: { code: "queue_operation_not_committed", summary: "原队列操作在提交前中断，已保存队列保持原状。", recovery: "none", severity: "info" } } : {}),
    }
  }
  async run(state, identity, signal, action, replay) {
    const { operation, operationRequestId, revision, itemId, mode } = identity
    if (operationRequestId === undefined) return action()
    if (typeof operationRequestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(operationRequestId) || ["__proto__", "constructor", "prototype"].includes(operationRequestId)) throw new Error("队列原操作标识无效。")
    const sessionId = state.record.id
    const fingerprint = createHash("sha256").update(JSON.stringify([operation, sessionId, revision, itemId ?? null, mode ?? null])).digest("hex")
    let existing
    let created = false
    try {
      await this.queue.serialize(state, async () => {
        state.queue.operationReceipts ??= {}
        existing = state.queue.operationReceipts[operationRequestId]
        if (existing) {
          if (existing.fingerprint !== fingerprint || existing.operation !== operation) throw operationError("queue_operation_identity_conflict", "此队列操作标识已用于其他内容，请核对原请求；未采用新的修改。", "check")
          return
        }
        created = true
        state.queue.operationReceipts[operationRequestId] = {
          sessionId, operationRequestId, operation, fingerprint, baseRevision: revision,
          ...(itemId ? { itemId } : {}), ...(mode ? { mode } : {}),
          ownerEpoch: this.queue.ownerEpoch, status: "preparing", updatedAt: new Date().toISOString(),
        }
        await this.queue.write(state, signal)
      })
      if (existing) {
        if (existing.status === "committed") {
          try { return await replay() }
          catch { throw operationError("result_unknown", "原队列动作已采用，但当前快照暂时无法读取，请核对原回执。", "check") }
        }
        const receipt = this.present(sessionId, operationRequestId, existing)
        if (receipt.state === "rejected") throw Object.assign(new Error(receipt.issue.summary), { name: "MoonOperationError", issue: receipt.issue })
        throw operationError("result_unknown", "原队列操作仍待确认，请核对原回执；不会再次采用。", "check")
      }
      return await action((document) => {
        const receipt = document.operationReceipts?.[operationRequestId]
        if (!receipt || receipt.fingerprint !== fingerprint || receipt.status !== "preparing" || receipt.ownerEpoch !== this.queue.ownerEpoch) throw operationError("queue_operation_identity_conflict", "原队列操作身份已变化，未提交本次修改。", "check")
        receipt.status = "committed"
        receipt.revision = document.revision
        receipt.updatedAt = new Date().toISOString()
      })
    } catch (error) {
      if (!created) throw error
      let committed = false
      try {
        await this.queue.serialize(state, async () => {
          const saved = (await this.queue.document(sessionId)).operationReceipts?.[operationRequestId]
          if (saved?.fingerprint === fingerprint && saved.status === "committed") { committed = true; return }
          if (saved && (saved.fingerprint !== fingerprint || saved.ownerEpoch !== this.queue.ownerEpoch)) throw new Error("原操作身份变化。")
          const receipt = state.queue.operationReceipts?.[operationRequestId]
          if (!receipt || receipt.fingerprint !== fingerprint) throw new Error("原操作身份不可确认。")
          receipt.status = "rejected"
          delete receipt.revision
          receipt.updatedAt = new Date().toISOString()
          receipt.issue = publicFailure(error, operation, signal?.aborted).issue
          await this.queue.write(state)
        })
      } catch {
        throw operationError("result_unknown", "原队列操作结果暂时无法读取，请核对原回执并保留原请求身份。", "check")
      }
      if (committed) throw operationError("result_unknown", "原队列动作已采用，但响应未完成；请只读核对原回执，不重新交付。", "check")
      throw error
    }
  }
}
