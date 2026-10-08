// Durable identities prevent a disconnected/expired caller from starting the
// same authorization twice. They contain no prompts, credentials or tokens.
export function validateAuthorizationRequests(value) {
  if (value === undefined) return
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("授权身份结构损坏；原文件未覆盖。")
  for (const [id, record] of Object.entries(value)) {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id) ||
      !record ||
      record.id !== id ||
      typeof record.connectionId !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.fingerprint) ||
      typeof record.ownerEpoch !== "string" ||
      !["pending", "complete", "cancelled", "error"].includes(record.status) ||
      typeof record.updatedAt !== "string"
    )
      throw new Error("授权身份记录损坏；原文件未覆盖。")
  }
}
