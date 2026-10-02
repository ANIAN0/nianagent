import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import { ModelRuntime } from "@earendil-works/pi-coding-agent"
import { ModelStore, memoryCredentials } from "./store.mjs"
import { AuthorizationJobs } from "./oauth.mjs"
import { dispatchOperation, assertSchema, schemas } from "./contract.mjs"
import { matchModel } from "./model-metadata.mjs"

const apis = ["openai-responses", "openai-completions", "anthropic-messages"]
const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const providerId = (connection) =>
  connection.kind === "subscription"
    ? connection.providerId
    : `moon-${connection.id}`
function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}
function safeText(value, limit = 1000) {
  return (
    typeof value === "string" &&
    value.length <= limit &&
    !/[\r\n\0]/u.test(value)
  )
}
function headersFor(connection) {
  const headers = JSON.parse(connection.headers || "{}")
  requireValue(
    headers && typeof headers === "object" && !Array.isArray(headers),
    "请求头格式错误。"
  )
  for (const [key, value] of Object.entries(headers)) {
    requireValue(
      /^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) && safeText(value, 8000),
      "请求头格式错误。"
    )
    requireValue(
      !value.trimStart().startsWith("!") && !value.includes("$"),
      "请求头只接受字面值，不执行命令或变量表达式。"
    )
    requireValue(
      ![
        "authorization",
        "x-api-key",
        "cookie",
        "host",
        "content-length",
      ].includes(key.toLowerCase()),
      "认证信息请使用凭据配置，不放入自定义请求头。"
    )
  }
  return headers
}
function validate(connection, models = true) {
  assertSchema(schemas.ModelConnection, connection, "连接")
  requireValue(connection && typeof connection === "object", "缺少连接。")
  requireValue(
    safeText(connection.id, 100) && /^[a-zA-Z0-9_-]+$/.test(connection.id),
    "连接 ID 无效。"
  )
  requireValue(
    safeText(connection.name, 100) && connection.name.trim(),
    "请输入连接名称。"
  )
  requireValue(
    ["api", "subscription"].includes(connection.kind),
    "连接类型无效。"
  )
  requireValue(
    Array.isArray(connection.models) && connection.models.length <= 1000,
    "模型列表无效。"
  )
  if (connection.kind === "api") {
    requireValue(
      ["key", "environment", "none"].includes(connection.credential),
      "凭据方式无效。"
    )
    requireValue(safeText(connection.endpoint), "端点无效。")
    if (connection.endpoint) {
      const url = new URL(connection.endpoint)
      requireValue(
        ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash,
        "端点只允许无内嵌凭据、查询参数和片段的 HTTP(S) 地址。"
      )
    }
    requireValue(
      safeText(connection.apiKey, 16000) &&
        !connection.apiKey.trimStart().startsWith("!") &&
        !connection.apiKey.includes("$"),
      "密钥必须为字面值。"
    )
    if (connection.credential === "environment")
      requireValue(
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(connection.environmentVariable),
        "环境变量名无效。"
      )
    headersFor(connection)
    if (models) {
      const ids = new Set()
      for (const model of connection.models) {
        validateModel(model)
        requireValue(!ids.has(model.id), "模型 ID 重复。")
        ids.add(model.id)
      }
    }
  } else
    requireValue(
      safeText(connection.providerId, 100) && connection.providerId,
      "请选择 Pi 订阅提供者。"
    )
}
function validateModel(model) {
  assertSchema(schemas.ModelDefinition, model, "模型")
  requireValue(
    model &&
      safeText(model.id, 300) &&
      model.id.trim() &&
      safeText(model.name, 300) &&
      model.name.trim(),
    "请输入模型 ID 和名称。"
  )
  requireValue(
    apis.includes(model.api) && typeof model.reasoning === "boolean",
    "请完善模型接口与思考能力。"
  )
  requireValue(
    Array.isArray(model.input) &&
      model.input.length &&
      model.input.every((value) => ["text", "image"].includes(value)),
    "输入能力无效。"
  )
  requireValue(
    Number.isSafeInteger(model.contextWindow) &&
      model.contextWindow > 0 &&
      Number.isSafeInteger(model.maxTokens) &&
      model.maxTokens > 0 &&
      model.maxTokens <= model.contextWindow,
    "请填写有效上下文和输出上限。"
  )
}
export class ModelService {
  constructor(directory) {
    this.store = new ModelStore(directory)
    this.jobs = new AuthorizationJobs(this)
  }
  async initialize() {
    await this.store.initialize()
  }
  async runtime(connection, credentials = this.store.credentialStore()) {
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    if (connection?.kind === "api") {
      const config = {
        name: connection.name,
        baseUrl: connection.endpoint || "http://localhost.invalid",
        headers: headersFor(connection),
        models: connection.models.map((model) => ({ ...model, cost })),
      }
      if (connection.credential === "environment")
        config.apiKey = "${" + connection.environmentVariable + "}"
      if (connection.credential === "none") {
        config.apiKey = "moon-local"
        config.authHeader = false
      }
      runtime.registerProvider(providerId(connection), config)
    }
    return runtime
  }
  async providers() {
    const runtime = await this.runtime()
    return runtime
      .getProviders()
      .filter((value) => value.auth?.oauth)
      .map((value) => ({ id: value.id, name: value.name }))
  }
  async present(connection, data) {
    const id = providerId(connection)
    const credential = data.credentials[id]
    const result = {
      ...connection,
      models: connection.models.map((model) => ({
        ...model,
        supportedThinkingLevels: model.reasoning
          ? getSupportedThinkingLevels(model)
          : [],
      })),
      apiKey: "",
      keySaved:
        connection.credential === "key" && credential?.type === "api_key",
      issue: "",
    }
    if (connection.kind === "subscription") {
      result.account = {
        name: connection.providerId,
        plan: "Pi OAuth",
        loggedIn: credential?.type === "oauth",
      }
      if (!result.account.loggedIn) result.issue = "尚未登录订阅服务。"
    } else if (!connection.endpoint) result.issue = "请填写服务端点。"
    else if (connection.credential === "key" && !result.keySaved)
      result.issue = "请保存 API 密钥。"
    else if (
      connection.credential === "environment" &&
      !process.env[connection.environmentVariable]
    )
      result.issue = `后端进程未读取到环境变量 ${connection.environmentVariable}。`
    return result
  }
  async revealKey(id, revision, signal) {
    signal?.throwIfAborted()
    const data = await this.store.read()
    const connection = data.connections.find((item) => item.id === id)
    requireValue(connection, "连接不存在。")
    requireValue(
      connection.revision === revision,
      "连接已更新，请重新打开连接后查看密钥。"
    )
    requireValue(
      connection.kind === "api" && connection.credential === "key",
      "此连接未使用已保存的API密钥。"
    )
    const credential = data.credentials[providerId(connection)]
    requireValue(
      credential?.type === "api_key" && credential.key,
      "此连接尚未保存密钥。"
    )
    signal?.throwIfAborted()
    return { apiKey: credential.key }
  }
  async list() {
    const data = await this.store.read()
    return Promise.all(
      data.connections.map((connection) => this.present(connection, data))
    )
  }
  async save(connection, signal) {
    validate(connection)
    const before = await this.store.read()
    const previous = before.connections.find(
      (item) => item.id === connection.id
    )
    requireValue(
      previous || connection.revision === undefined,
      "连接已删除，请刷新后重新添加。"
    )
    requireValue(
      !previous || previous.kind === connection.kind,
      "连接类型不能更改。"
    )
    requireValue(
      !previous || previous.revision === connection.revision,
      "连接已被其他窗口更新，请重新打开后修改。"
    )
    requireValue(
      !before.connections.some(
        (item) =>
          item.id !== connection.id &&
          item.name.toLowerCase() === connection.name.trim().toLowerCase()
      ),
      "连接名称已存在。"
    )
    let selectedModels = connection.models
    const credentials = memoryCredentials(before.credentials)
    if (connection.kind === "subscription") {
      requireValue(
        !previous || previous.providerId === connection.providerId,
        "已保存连接不能更换订阅提供者。"
      )
      requireValue(
        (await this.providers()).some(
          (item) => item.id === connection.providerId
        ),
        "Pi 不支持此订阅提供者。"
      )
      requireValue(
        !before.connections.some(
          (item) =>
            item.id !== connection.id &&
            item.providerId === connection.providerId
        ),
        "该订阅提供者已有连接，请编辑原连接。"
      )
      const runtime = await this.runtime()
      selectedModels = connection.models.map((model) => {
        const original = runtime.getModel(connection.providerId, model.id)
        requireValue(original, "订阅模型必须来自 Pi 模型目录。")
        return pickModel(original)
      })
    } else {
      const runtime = await this.runtime(connection, credentials)
      const id = providerId(connection)
      if (connection.credential === "key") {
        if (connection.apiKey.trim())
          await runtime.login(id, "api_key", {
            signal,
            prompt: async () => connection.apiKey.trim(),
            notify() {},
          })
        else if (connection.clearKey) await credentials.delete(id)
      } else await credentials.delete(id)
    }
    const stored = {
      id: connection.id,
      name: connection.name.trim(),
      kind: connection.kind,
      endpoint: connection.endpoint.trim(),
      credential: connection.credential,
      environmentVariable: connection.environmentVariable,
      headers: connection.headers || "{}",
      models: selectedModels,
      providerId: connection.providerId,
      protocol: connection.protocol || "openai-completions",
      revision: (previous?.revision ?? 0) + 1,
    }
    signal?.throwIfAborted()
    await this.store.update((data) => {
      signal?.throwIfAborted()
      const current = data.connections.find((item) => item.id === connection.id)
      requireValue(
        !(data.authorizations[providerId(stored)]?.expiresAt > Date.now()),
        "该连接正在授权，请先取消或等待结束。"
      )
      requireValue(
        current?.revision === previous?.revision,
        "连接已更新，请重新读取。"
      )
      requireValue(
        !data.connections.some(
          (item) =>
            item.id !== stored.id &&
            (item.name.toLowerCase() === stored.name.toLowerCase() ||
              (stored.kind === "subscription" &&
                item.providerId === stored.providerId))
        ),
        "名称或订阅提供者已存在。"
      )
      data.connections = [
        ...data.connections.filter((item) => item.id !== stored.id),
        stored,
      ]
      if (stored.kind === "api") {
        const credential = credentials.data[providerId(stored)]
        if (credential) data.credentials[providerId(stored)] = credential
        else delete data.credentials[providerId(stored)]
      }
    }, signal)
    return this.present(stored, await this.store.read())
  }
  async remove(id, revision, signal) {
    requireValue(!this.jobs.hasConnection(id), "请先结束该连接的授权。")
    await this.store.update((data) => {
      const item = data.connections.find((value) => value.id === id)
      requireValue(
        item && item.revision === revision,
        "连接已更新或删除，请刷新。"
      )
      data.connections = data.connections.filter((value) => value.id !== id)
      delete data.credentials[providerId(item)]
      delete data.authorizations[providerId(item)]
    }, signal)
  }
  async prepared(connection, model) {
    validate(connection, false)
    if (connection.kind === "subscription") return this.runtime()
    const data = await this.store.read()
    const credentials = memoryCredentials(data.credentials)
    const draft = {
      ...connection,
      models: model
        ? [model]
        : connection.models.filter(
            (value) =>
              value.api &&
              value.contextWindow &&
              value.maxTokens &&
              typeof value.reasoning === "boolean"
          ),
    }
    const runtime = await this.runtime(draft, credentials)
    if (connection.kind === "api") {
      const id = providerId(connection)
      if (connection.credential !== "key" || !connection.keySaved)
        await credentials.delete(id)
      if (connection.credential === "key" && connection.apiKey.trim())
        await runtime.setRuntimeApiKey(id, connection.apiKey.trim())
    }
    return runtime
  }
  async discover(connection, signal) {
    validate(connection, false)
    if (connection.kind === "subscription") {
      const runtime = await this.runtime()
      requireValue(
        runtime.getProvider(connection.providerId)?.auth?.oauth,
        "订阅提供者无效。"
      )
      return runtime.getModels(connection.providerId).map(pickModel)
    }
    requireValue(connection.endpoint, "请输入服务端点。")
    const runtime = await this.prepared(connection)
    const auth = await runtime.getAuth(providerId(connection), { signal })
    const headers = new Headers(headersFor(connection))
    const anthropic = connection.protocol === "anthropic-messages"
    if (connection.credential !== "none") {
      requireValue(
        auth?.auth.apiKey,
        "没有可用凭据，请检查密钥或后端环境变量。"
      )
      headers.set(
        anthropic ? "x-api-key" : "authorization",
        anthropic ? auth.auth.apiKey : `Bearer ${auth.auth.apiKey}`
      )
    }
    if (anthropic) headers.set("anthropic-version", "2023-06-01")
    const base = connection.endpoint.replace(/\/+$/, "")
    const url = new URL(
      `${base}${anthropic && !base.endsWith("/v1") ? "/v1" : ""}/models`
    )
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)])
    const entries = []
    const cursors = new Set()
    for (;;) {
      const response = await fetch(url, {
        headers,
        redirect: "error",
        signal: requestSignal,
      })
      requireValue(
        response.ok,
        `模型目录请求失败（HTTP ${response.status}），请检查端点和凭据。`
      )
      const payload = await readJson(response)
      requireValue(
        Array.isArray(payload.data),
        "服务未返回受支持的模型目录；可手工添加模型。"
      )
      entries.push(...payload.data)
      requireValue(
        entries.length <= 10000,
        "模型目录过大，请缩小服务目录范围。"
      )
      if (!anthropic || !payload.has_more) break
      requireValue(
        safeText(payload.last_id, 300) &&
          payload.last_id &&
          !cursors.has(payload.last_id) &&
          cursors.size < 100,
        "模型目录分页游标无效。"
      )
      cursors.add(payload.last_id)
      url.searchParams.set("after_id", payload.last_id)
    }
    const known = runtime.getModels()
    const seen = new Set()
    return entries.flatMap((item) => {
      requireValue(safeText(item?.id, 300) && item.id, "模型目录包含无效 ID。")
      if (seen.has(item.id)) return []
      seen.add(item.id)
      return [matchModel(item, known, connection)]
    })
  }
  async check(connection, model, signal) {
    if (connection.kind === "api") validateModel(model)
    const runtime = await this.prepared(connection, model)
    const selected = runtime.getModel(providerId(connection), model.id)
    requireValue(selected, "Pi 中不存在此模型。")
    try {
      const result = await runtime.completeSimple(
        selected,
        {
          messages: [
            { role: "user", content: "Reply OK.", timestamp: Date.now() },
          ],
        },
        {
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
          maxTokens: 32,
          ...(connection.credential === "none" && connection.kind === "api"
            ? {
                fetch: (input, init) => {
                  const headers = new Headers(
                    init?.headers ??
                      (input instanceof Request ? input.headers : undefined)
                  )
                  headers.delete("authorization")
                  headers.delete("x-api-key")
                  return fetch(input, { ...init, headers, redirect: "error" })
                },
              }
            : {}),
        }
      )
      requireValue(
        !["error", "aborted"].includes(result.stopReason),
        "模型调用失败，请检查凭据、模型接口和服务状态。"
      )
    } catch (error) {
      if (signal.aborted) throw error
      throw new Error(
        "模型调用未成功，请检查凭据、接口或服务状态（请求上限 30 秒）。"
      )
    }
  }
  async logout(id, signal) {
    requireValue(!this.jobs.hasConnection(id), "请先取消授权。")
    const data = await this.store.read()
    const connection = data.connections.find((item) => item.id === id)
    requireValue(connection?.kind === "subscription", "订阅连接不存在。")
    await this.store.update((data) => {
      delete data.authorizations[connection.providerId]
    }, signal)
    await (await this.runtime()).logout(connection.providerId, { signal })
    return this.present(connection, await this.store.read())
  }
  async dispatch(operation, input, signal) {
    return dispatchOperation(this, operation, input, signal)
  }

  close() {
    this.jobs.close()
  }
}
function pickModel(model) {
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    reasoning: model.reasoning,
    ...(model.thinkingLevelMap
      ? { thinkingLevelMap: model.thinkingLevelMap }
      : {}),
    input: model.input,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }
}
async function readJson(response) {
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      requireValue(size <= 4 * 1024 * 1024, "模型目录响应过大。")
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString())
  } catch {
    throw new Error("模型目录不是有效 JSON。")
  }
}
