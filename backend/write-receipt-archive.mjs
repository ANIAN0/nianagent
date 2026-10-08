import { archiveReceipt, readArchivedReceipt } from "./receipt-archive.mjs"
import { validateWriteReceipts } from "./write-receipt-validation.mjs"
const validate = (id) => (value) => validateWriteReceipts({ [id]: value })
export function readArchivedWrite(store, id) {
  if (!store.file) return undefined
  return readArchivedReceipt(store.file + ".receipts", [id], validate(id))
}
/** 只压缩已持久化的终态；调用方必须在本次业务 change 之前调用。 */
export async function compactWriteReceipts(store, document, signal) {
  const values = Object.values(document.writeReceipts ?? {})
  if (values.length <= 256) return
  const terminal = values
    .filter(
      (value) => value.status === "committed" || value.status === "rejected"
    )
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  for (const receipt of terminal.slice(
    0,
    Math.min(64, Math.max(0, values.length - 128))
  )) {
    await archiveReceipt(
      store.file + ".receipts",
      [receipt.operationRequestId],
      receipt,
      validate(receipt.operationRequestId),
      signal
    )
    delete document.writeReceipts[receipt.operationRequestId]
  }
}
