import type { WriteReceipt } from "@/contracts/rpc.generated"
import type { FeedbackDescription } from "@/lib/operation-issue"

export type ConfigurationDraftIdentity = {
  operation: WriteReceipt["operation"]
  operationRequestId: string
  targetId: string
  revision?: number
}
type Envelope = {
  formatVersion: 1
  identity: ConfigurationDraftIdentity
  record: unknown
}
const prefix = "moon.configuration-draft.v1."
const retained = new Map<string, Envelope>()
const maximumLength = 2 * 1024 * 1024
const keyFor = (operation: string, recordKey: string) =>
  prefix + JSON.stringify([operation, recordKey])
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
const optional = (value: unknown, check: (value: unknown) => boolean) =>
  value === undefined || check(value)
const revision = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0
const text = (value: unknown) => typeof value === "string"
const bool = (value: unknown) => typeof value === "boolean"
function jsonObject(value: unknown) {
  if (typeof value !== "string") return false
  try {
    return object(JSON.parse(value))
  } catch {
    return false
  }
}
function bounded(value: unknown, depth = 0, budget = { count: 0 }): boolean {
  if (++budget.count > 50000 || depth > 20) return false
  if (typeof value === "string") return value.length <= maximumLength
  if (value === null || typeof value === "boolean" || value === undefined)
    return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value))
    return (
      value.length <= 2000 &&
      value.every((item) => bounded(item, depth + 1, budget))
    )
  return (
    object(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        !["__proto__", "constructor", "prototype"].includes(key) &&
        bounded(item, depth + 1, budget)
    )
  )
}
function model(value: unknown) {
  return (
    object(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    ["api", "subscription"].includes(String(value.kind)) &&
    typeof value.endpoint === "string" &&
    typeof value.apiKey === "string" &&
    ["key", "environment", "none"].includes(String(value.credential)) &&
    typeof value.keySaved === "boolean" &&
    typeof value.environmentVariable === "string" &&
    typeof value.headers === "string" &&
    optional(value.revision, revision) &&
    optional(value.providerId, text) &&
    optional(value.protocol, text) &&
    optional(value.issue, text) &&
    optional(value.clearKey, bool) &&
    optional(value.accountOperationBusy, bool) &&
    optional(
      value.account,
      (item) =>
        object(item) &&
        text(item.name) &&
        text(item.plan) &&
        bool(item.loggedIn)
    ) &&
    Array.isArray(value.models) &&
    value.models.every(
      (item) =>
        object(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.api === "string" &&
        strings(item.input) &&
        item.input.every((kind) => ["text", "image"].includes(kind)) &&
        optional(item.reasoning, bool) &&
        optional(item.contextWindow, revision) &&
        optional(item.maxTokens, revision) &&
        optional(
          item.thinkingLevelMap,
          (map) =>
            object(map) &&
            Object.values(map).every((level) => level === null || text(level))
        ) &&
        optional(
          item.supportedThinkingLevels,
          (levels) =>
            strings(levels) &&
            levels.every((level) =>
              [
                "off",
                "minimal",
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ].includes(level)
            )
        ) &&
        optional(
          item.metadata,
          (metadata) =>
            object(metadata) &&
            ["matched", "partial", "unknown"].includes(
              String(metadata.status)
            ) &&
            strings(metadata.sources) &&
            strings(metadata.conflicts)
        )
    )
  )
}
function mcp(value: unknown) {
  return (
    object(value) &&
    typeof value.name === "string" &&
    ["stdio", "http"].includes(String(value.transport)) &&
    typeof value.command === "string" &&
    strings(value.args) &&
    typeof value.cwd === "string" &&
    typeof value.url === "string" &&
    typeof value.description === "string" &&
    ["codemode", "deferred", "direct", "hidden"].includes(
      String(value.exposure)
    ) &&
    Array.isArray(value.env) &&
    value.env.every(
      (item) => object(item) && text(item.name) && text(item.value)
    ) &&
    Array.isArray(value.headers) &&
    value.headers.every(
      (item) => object(item) && text(item.name) && text(item.value)
    ) &&
    typeof value.enabled === "boolean" &&
    Number.isSafeInteger(value.timeout)
  )
}
function mcpOriginal(value: unknown) {
  if (typeof value !== "string") return false
  try {
    return mcp(JSON.parse(value))
  } catch {
    return false
  }
}
function extension(value: unknown) {
  return (
    object(value) &&
    text(value.id) &&
    text(value.name) &&
    text(value.description) &&
    value.apiVersion === 1 &&
    text(value.version) &&
    revision(value.revision) &&
    bool(value.enabled) &&
    jsonObject(value.configuration) &&
    jsonObject(value.configurationSchema) &&
    Array.isArray(value.tools) &&
    value.tools.every(
      (item) =>
        object(item) &&
        text(item.id) &&
        text(item.name) &&
        text(item.description)
    ) &&
    Array.isArray(value.resultKinds) &&
    value.resultKinds.every(
      (item) =>
        object(item) &&
        text(item.kind) &&
        revision(item.version) &&
        jsonObject(item.schema)
    ) &&
    ["ready", "failed"].includes(String(value.state)) &&
    revision(value.activeSessions)
  )
}
function validate(value: unknown, operation: string): value is Envelope {
  if (
    !object(value) ||
    value.formatVersion !== 1 ||
    !object(value.identity) ||
    !object(value.record) ||
    !bounded(value)
  )
    return false
  const { identity, record } = value
  if (
    identity.operation !== operation ||
    typeof identity.operationRequestId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(identity.operationRequestId) ||
    typeof identity.targetId !== "string" ||
    !identity.targetId.length ||
    identity.targetId.length > 256 ||
    (identity.revision !== undefined &&
      (!Number.isSafeInteger(identity.revision) ||
        Number(identity.revision) < 0))
  )
    return false
  const attempt = record.attempt
  if (
    !object(attempt) ||
    attempt.operation !== identity.operation ||
    attempt.operationRequestId !== identity.operationRequestId ||
    attempt.targetId !== identity.targetId ||
    !object(record.issue) ||
    typeof record.issue.message !== "string" ||
    typeof record.issue.code !== "string" ||
    !optional(record.issue.details, text) ||
    !optional(record.issue.severity, (value) =>
      ["error", "warning", "info"].includes(String(value))
    ) ||
    !optional(record.issue.recovery, (value) =>
      ["retry", "reload", "check", "settings", "restart", "none"].includes(
        String(value)
      )
    )
  )
    return false
  if (operation === "save")
    return (
      model(attempt.connection) &&
      model(record.draft) &&
      model(record.baseline) &&
      (attempt.connection as Record<string, unknown>).id ===
        identity.targetId &&
      (record.draft as Record<string, unknown>).id === identity.targetId &&
      (record.baseline as Record<string, unknown>).id === identity.targetId &&
      (attempt.connection as Record<string, unknown>).revision ===
        identity.revision
    )
  if (operation === "mcpSave")
    return (
      mcp(attempt.configuration) &&
      mcp(record.value) &&
      mcpOriginal(record.original) &&
      (attempt.configuration as Record<string, unknown>).name ===
        identity.targetId &&
      attempt.revision === identity.revision &&
      record.revision === identity.revision
    )
  if (operation === "extensionConfigure")
    return (
      object(attempt.configuration) &&
      attempt.configuration.id === identity.targetId &&
      attempt.configuration.revision === identity.revision &&
      typeof attempt.configuration.configuration === "string" &&
      typeof attempt.configuration.enabled === "boolean" &&
      extension(record.descriptor) &&
      object(record.descriptor) &&
      record.descriptor.id === identity.targetId &&
      record.descriptor.revision === identity.revision &&
      typeof record.enabled === "boolean" &&
      typeof record.configuration === "string"
    )
  return false
}

/** 副本只保存在同一私有 WebView；不进入事件、日志、目录演示或自动重发。 */
export function restoreConfigurationDraft<R>(
  operation: WriteReceipt["operation"],
  recordKey: string,
  demo = false
): R | undefined {
  if (demo) return undefined
  const key = keyFor(operation, recordKey)
  const memory = retained.get(key)
  if (memory) return memory.record as R
  const text = localStorage.getItem(key)
  if (text === null) return undefined
  if (text.length > maximumLength)
    throw new Error("配置恢复副本过大，原副本保留，请先核对原配置操作。")
  let envelope: unknown
  try {
    envelope = JSON.parse(text)
  } catch {
    throw new Error("配置恢复副本无法解析，原副本保留。")
  }
  if (!validate(envelope, operation))
    throw new Error("配置恢复副本的身份或结构无效，原副本保留。")
  retained.set(key, envelope)
  return envelope.record as R
}
/** 编辑器可显示读取失败，但严格恢复与 flush 仍保留异常，不能把坏副本当作保存成功。 */
export function readConfigurationDraft<R>(
  operation: WriteReceipt["operation"],
  recordKey: string,
  demo = false
): { record?: R; issue?: FeedbackDescription } {
  try {
    return { record: restoreConfigurationDraft<R>(operation, recordKey, demo) }
  } catch {
    return {
      issue: {
        code: "recovery_storage_unavailable",
        severity: "error",
        recovery: "none",
        message:
          "本机配置恢复副本无法读取或校验。原副本保留，请检查本机存储后重新读取；不会重新提交原操作。",
      },
    }
  }
}
export function retainConfigurationDraft(
  identity: ConfigurationDraftIdentity,
  recordKey: string,
  record: unknown,
  demo = false
) {
  if (demo) return
  // 其他未知副本损坏时也不启动新的设置写入，避免覆盖或绕过待处理身份。
  loadConfigurationDrafts()
  const envelope: Envelope = {
    formatVersion: 1,
    identity,
    record: structuredClone(record),
  }
  if (!validate(envelope, identity.operation))
    throw new Error("无法核对配置恢复副本的身份与结构。")
  const text = JSON.stringify(envelope)
  if (text.length > maximumLength)
    throw new Error("配置恢复副本过大，尚未提交新的配置。")
  retained.set(keyFor(identity.operation, recordKey), envelope)
  localStorage.setItem(keyFor(identity.operation, recordKey), text)
}
export function clearConfigurationDraft(
  operation: string,
  recordKey: string,
  requestId: string,
  demo = false
) {
  if (demo) return
  const key = keyFor(operation, recordKey)
  const value = retained.get(key)
  if (value && value.identity.operationRequestId !== requestId)
    throw new Error("配置恢复身份已变化，未清理另一份副本。")
  localStorage.removeItem(key)
  retained.delete(key)
}
export function saveConfigurationDrafts() {
  // 包括未进入编辑器的持久副本；损坏记录不能被跳过并确认 flush 已成功。
  loadConfigurationDrafts()
  for (const [key, value] of retained)
    localStorage.setItem(key, JSON.stringify(value))
}
export function loadConfigurationDrafts() {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith(prefix)) continue
    let identity: unknown
    try {
      identity = JSON.parse(key.slice(prefix.length))
    } catch {
      throw new Error("配置恢复副本标识损坏，原副本保留。")
    }
    if (
      !Array.isArray(identity) ||
      identity.length !== 2 ||
      !["save", "mcpSave", "extensionConfigure"].includes(identity[0]) ||
      typeof identity[1] !== "string" ||
      identity[1].length > 256
    )
      throw new Error("配置恢复副本标识无效，原副本保留。")
    restoreConfigurationDraft(identity[0], identity[1])
  }
}
export function findConfigurationDraft<R>(identity: {
  operation: string
  operationRequestId: string
  targetId: string
}) {
  loadConfigurationDrafts()
  for (const [key, value] of retained) {
    if (
      value.identity.operation === identity.operation &&
      value.identity.operationRequestId === identity.operationRequestId &&
      value.identity.targetId === identity.targetId
    )
      return {
        recordKey: JSON.parse(key.slice(prefix.length))[1] as string,
        record: value.record as R,
      }
  }
  return undefined
}
export function clearConfigurationDraftByIdentity(
  identity: { operation: string; operationRequestId: string; targetId: string },
  demo = false
) {
  if (demo) return
  const found = findConfigurationDraft(identity)
  if (found)
    clearConfigurationDraft(
      identity.operation,
      found.recordKey,
      identity.operationRequestId
    )
}
export function configurationDraftIdentities(demo = false) {
  if (demo) return []
  loadConfigurationDrafts()
  return [...retained.values()].map((value) => value.identity)
}
