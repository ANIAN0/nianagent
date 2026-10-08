import { assertSchema } from "./schema.mjs"
import { insightSchemas } from "./conversation-insight-contract.mjs"

const publicReceipt = insightSchemas.ConversationCommandReceipt
const storageSchema = {
  ...publicReceipt,
  properties: {
    ...publicReceipt.properties,
    version: { type: "integer", enum: [1] },
    name: { type: "string", minLength: 1, maxLength: 200 },
    arguments: { type: "string", maxLength: 100000 },
    status: { type: "string", enum: ["started", "completed", "failed"] },
  },
  required: [...publicReceipt.required, "arguments"],
}

export function validateCommandReceipt(value, sessionId, id) {
  // 兼容没有 version 的旧有效记录；null/错身份绝不能当作 ENOENT。
  assertSchema(storageSchema, value, "已保存命令回执")
  if (
    value.sessionId !== sessionId ||
    value.id !== id ||
    (value.status === "failed" && !value.issue)
  )
    throw new Error("命令回执身份或终态损坏，原文件保留。")
  return value
}

export function presentCommandReceipt(value) {
  const { arguments: _arguments, version: _version, ...receipt } = value
  return receipt
}
