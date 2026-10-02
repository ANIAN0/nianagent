import type {
  ModelDefinition,
  ModelConnection,
  AuthState,
} from "./model-contract.generated"
export type {
  ModelApi,
  ModelDefinition,
  ModelConnection,
  AuthState,
} from "./model-contract.generated"
export const thinkingNames = {
  off: "关闭",
  minimal: "极少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "更高",
  max: "最高",
}
export function thinkingLevels(model: ModelDefinition) {
  if (!model.reasoning) return []
  return (Object.keys(thinkingNames) as (keyof typeof thinkingNames)[]).filter(
    (level) =>
      model.thinkingLevelMap?.[level] !== null &&
      ((level !== "xhigh" && level !== "max") ||
        model.thinkingLevelMap?.[level] !== undefined)
  )
}
export type ModelService = {
  revealKey?: (
    id: string,
    revision: number,
    signal: AbortSignal
  ) => Promise<{ apiKey: string }>
  providers?: (signal: AbortSignal) => Promise<{ id: string; name: string }[]>
  auth?: {
    start(connection: ModelConnection, signal: AbortSignal): Promise<AuthState>
    poll(id: string, signal: AbortSignal): Promise<AuthState>
    reply(
      id: string,
      promptId: string,
      value: string,
      signal: AbortSignal
    ): Promise<AuthState>
    cancel(id: string): Promise<void>
    logout(id: string, signal: AbortSignal): Promise<ModelConnection>
  }
  list(signal: AbortSignal): Promise<ModelConnection[]>
  save(
    connection: ModelConnection,
    signal: AbortSignal
  ): Promise<ModelConnection>
  remove(id: string, signal: AbortSignal, revision?: number): Promise<void>
  discover(
    connection: ModelConnection,
    signal: AbortSignal
  ): Promise<ModelDefinition[]>
  check(
    connection: ModelConnection,
    model: ModelDefinition,
    signal: AbortSignal
  ): Promise<void>
  authorize(
    signal: AbortSignal,
    response?: { confirmation?: string; scope?: string }
  ): Promise<
    | { kind: "prompt" | "select" }
    | { kind: "complete"; account: NonNullable<ModelConnection["account"]> }
  >
}
export function blankConnection(
  kind: ModelConnection["kind"]
): ModelConnection {
  return {
    id: crypto.randomUUID(),
    name: "",
    kind,
    endpoint: "",
    protocol: "openai-completions",
    credential: "key",
    keySaved: false,
    apiKey: "",
    environmentVariable: "",
    headers: "{}",
    models: [],
  }
}
export const blankModel = (): ModelDefinition => ({
  id: "",
  name: "",
  api: "",
  input: ["text"],
})
export function credentialLabel(item: ModelConnection) {
  return item.kind === "subscription"
    ? "OAuth 登录"
    : item.credential === "key"
      ? "密钥保管"
      : item.credential === "environment"
        ? `环境变量 · ${item.environmentVariable}`
        : "无凭据"
}
export function connectionIssue(item: ModelConnection) {
  return (
    item.issue ??
    (item.kind === "subscription" && !item.account?.loggedIn
      ? "尚未登录订阅服务。"
      : "")
  )
}
export function connectionErrors(
  item: ModelConnection,
  others: ModelConnection[],
  testing = false
) {
  const errors: Record<string, string> = {}
  if (!item.name.trim()) errors.name = "请输入连接名称。"
  else if (
    others.some(
      (value) =>
        value.id !== item.id &&
        value.name.trim().toLowerCase() === item.name.trim().toLowerCase()
    )
  )
    errors.name = "该名称已被使用，请换一个名称。"
  if (
    item.kind === "subscription" &&
    !item.providerId &&
    item.revision !== undefined
  )
    errors.name = "请选择订阅提供者。"
  if (item.kind === "api") {
    if (testing && !item.endpoint.trim())
      errors.endpoint = "测试连接前请输入服务端点。"
    if (item.endpoint.trim()) {
      try {
        if (!["http:", "https:"].includes(new URL(item.endpoint).protocol))
          throw new Error()
      } catch {
        errors.endpoint = "请输入完整的 HTTP 或 HTTPS 地址。"
      }
    }
    if (
      testing &&
      item.credential === "key" &&
      !item.keySaved &&
      !item.apiKey.trim()
    )
      errors.credential = "请输入 API 密钥。"
    if (
      item.credential === "environment" &&
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.environmentVariable)
    )
      errors.credential = "请输入有效的环境变量名。"
    try {
      const headers: unknown = JSON.parse(item.headers || "{}")
      if (
        !headers ||
        typeof headers !== "object" ||
        Array.isArray(headers) ||
        !Object.values(headers).every((value) => typeof value === "string")
      )
        throw new Error()
    } catch {
      errors.headers = "请输入键和值均为字符串的 JSON 对象。"
    }
  }
  return errors
}
export function modelErrors(
  item: ModelDefinition,
  existing: ModelDefinition[],
  originalId?: string
) {
  const errors: Record<string, string> = {}
  if (!item.id.trim()) errors.id = "请输入模型 ID。"
  else if (
    existing.some(
      (value) => value.id === item.id.trim() && value.id !== originalId
    )
  )
    errors.id = "该模型 ID 已存在。"
  if (!item.name.trim()) errors.name = "请输入显示名称。"
  if (!item.api) errors.api = "请选择接口方式。"
  if (item.reasoning === undefined) errors.reasoning = "请选择思考能力。"
  if (!item.input.length) errors.input = "至少选择一种输入能力。"
  if (
    !Number.isSafeInteger(item.contextWindow) ||
    (item.contextWindow ?? 0) < 1
  )
    errors.contextWindow = "请输入正整数。"
  if (!Number.isSafeInteger(item.maxTokens) || (item.maxTokens ?? 0) < 1)
    errors.maxTokens = "请输入正整数。"
  else if (item.contextWindow && item.maxTokens! > item.contextWindow)
    errors.maxTokens = "最大输出不能超过上下文上限。"
  return errors
}

export function modelSelectionId(
  connection: ModelConnection,
  model: ModelDefinition
) {
  const legacy: Record<string, string> = {
    "openai/gpt-5.6-terra": "GPT-5.6 Terra",
    "deepseek/deepseek-chat": "DeepSeek V3.2",
    "anthropic/claude-sonnet-4-5": "Claude Sonnet 4.5",
  }
  return (
    legacy[`${connection.id}/${model.id}`] ?? `${connection.id}/${model.id}`
  )
}
