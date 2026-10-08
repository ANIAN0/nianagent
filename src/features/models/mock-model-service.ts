import type {
  ModelConnection,
  ModelDefinition,
  ModelService,
  AuthState,
} from "./model-types"
import type { WriteReceipt, OperationIssue } from "@/contracts/rpc.generated"
import { connectionIssue, connectionErrors } from "./model-types"

const model = (
  id: string,
  name: string,
  api: ModelDefinition["api"] = "openai-responses"
): ModelDefinition => ({
  id,
  name,
  api,
  reasoning: true,
  input: ["text", "image"],
  contextWindow: 200000,
  maxTokens: 32768,
})
export const modelFixtures: ModelDefinition[] = [
  model("gpt-5.6-terra", "GPT-5.6 Terra"),
  model("gpt-4.1", "GPT-4.1"),
  model("o3", "o3"),
]
export const connectionFixtures: ModelConnection[] = [
  {
    id: "openai",
    name: "OpenAI",
    kind: "api",
    endpoint: "https://api.openai.com/v1",
    credential: "key",
    keySaved: true,
    apiKey: "",
    environmentVariable: "",
    headers: "{}",
    models: modelFixtures,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "api",
    endpoint: "https://api.deepseek.com",
    credential: "key",
    keySaved: true,
    apiKey: "",
    environmentVariable: "",
    headers: "{}",
    models: [model("deepseek-chat", "DeepSeek V3.2", "openai-completions")],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "api",
    endpoint: "https://api.anthropic.com",
    credential: "key",
    keySaved: true,
    apiKey: "",
    environmentVariable: "",
    headers: "{}",
    models: [
      model("claude-sonnet-4-5", "Claude Sonnet 4.5", "anthropic-messages"),
    ],
  },
  {
    id: "local",
    name: "本地推理服务",
    kind: "api",
    endpoint: "http://localhost:11434/v1",
    credential: "none",
    keySaved: false,
    apiKey: "",
    environmentVariable: "",
    headers: "{}",
    models: [],
  },
  {
    id: "subscription",
    name: "订阅账号",
    kind: "subscription",
    endpoint: "",
    credential: "none",
    keySaved: false,
    apiKey: "",
    environmentVariable: "",
    headers: "{}",
    account: {
      name: "demo@example.invalid",
      plan: "个人订阅",
      loggedIn: false,
    },
    models: [model("subscription-model", "订阅模型")],
  },
  {
    id: "team",
    issue: "无法读取 TEAM_MODEL_API_KEY，请检查变量名或环境配置。",
    name: "团队模型网关",
    kind: "api",
    endpoint:
      "https://model-gateway.example.invalid/team/workspace/production/v1",
    credential: "environment",
    keySaved: false,
    apiKey: "",
    environmentVariable: "TEAM_MODEL_API_KEY",
    headers: "{}",
    models: [
      model(
        "team-reasoning-model-long-context",
        "团队推理模型",
        "openai-completions"
      ),
    ],
  },
]

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("已取消", "AbortError"))
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException("已取消", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, ms)
    signal.addEventListener("abort", abort, { once: true })
  })
}
export type MockModelOptions = {
  failure?:
    | "list"
    | "save"
    | "remove"
    | "discover"
    | "check"
    | "authorize"
    | "save-unknown"
    | "save-unknown-pending"
    | "remove-unknown"
    | "list-restart"
    | "discover-restart"
    | "check-unknown"
    | "authorize-restart"
    | "authorize-unknown"
    | "logout-unknown"
    | "logout-read-error"
    | "logout-read-restart"
    | "logout-read-busy"
    | "logout-read-unsupported"
  oauthDelay?: number
}
const demoIssue = (
  summary: string,
  recovery: OperationIssue["recovery"] = "retry",
  code = "demo_failed",
  severity: OperationIssue["severity"] = "error"
) =>
  Object.assign(new Error(summary), {
    issue: { summary, recovery, code, severity },
  })
/** Memory-only implementation of the formal service contract; no listed endpoint is called. */
export function createMockModelService(
  seed = connectionFixtures,
  options: MockModelOptions = {}
): ModelService {
  let connections = structuredClone(
    seed.map((item) => ({
      ...item,
      revision: item.revision ?? 1,
      ...(item.kind === "subscription"
        ? {
            providerId: item.providerId ?? "example",
            accountOperationBusy: item.accountOperationBusy ?? false,
          }
        : {}),
    }))
  )
  let failure = options.failure
  let logoutPendingReads = 0
  let logoutPendingProvider: string | undefined
  const secrets = new Map(
    connections
      .filter((item) => item.keySaved)
      .map((item) => [item.id, "moon-demo-key-not-a-real-secret"])
  )
  const receipts = new Map<string, WriteReceipt>()
  const authorizations = new Map<string, AuthState>()
  const authorizationControllers = new Map<string, AbortController>()
  const authorizationStarts = new Map<string, Promise<AuthState>>()
  async function operation(name: string, signal: AbortSignal) {
    await delay(
      name === "authorize" ? (options.oauthDelay ?? 450) : 450,
      signal
    )
    if (failure === `${name}-restart`) {
      failure = undefined
      throw demoIssue(
        "示例：桌面服务版本不匹配，请重启 Moon。",
        "restart",
        "host_version"
      )
    }
    if (failure === name) {
      failure = undefined
      throw demoIssue("示例服务暂时不可用，原有数据未改变。")
    }
    if (name === "check" && failure === "check-unknown") {
      failure = undefined
      throw demoIssue(
        "未收到推理检查结果，检查可能已完成；再次检查会发起新的模型请求。",
        "none",
        "result_unknown",
        "warning"
      )
    }
  }
  const service: ModelService = {
    evidence: "demo",
    async readWriteReceipt(
      operation,
      operationRequestId,
      signal = new AbortController().signal
    ) {
      await delay(250, signal)
      return structuredClone(
        receipts.get(operationRequestId) ?? {
          operationRequestId,
          operation,
          targetId: "",
          state: "unknown",
        }
      )
    },
    async revealKey(id, revision, signal) {
      await delay(250, signal)
      const item = connections.find((value) => value.id === id)
      if (!item || item.revision !== revision)
        throw demoIssue(
          "连接已更新，请重新打开连接后查看密钥。",
          "reload",
          "revision_conflict"
        )
      const apiKey = secrets.get(id)
      if (!apiKey)
        throw demoIssue("此连接没有已保存的密钥。", "none", "key_missing")
      return { apiKey }
    },
    async providers(signal) {
      await delay(250, signal)
      return [{ id: "example", name: "示例订阅提供者" }]
    },
    async list(signal) {
      await operation("list", signal)
      const snapshot = structuredClone(connections)
      if (logoutPendingReads > 0) {
        logoutPendingReads--
        if (logoutPendingReads === 0)
          connections = connections.map((item) =>
            item.kind === "subscription" &&
            item.providerId === logoutPendingProvider
              ? { ...item, accountOperationBusy: false }
              : item
          )
      }
      return snapshot
    },
    async save(value, signal, operationRequestId) {
      await operation("save", signal)
      const existing = connections.find((item) => item.id === value.id)
      if (existing && existing.revision !== value.revision)
        throw demoIssue(
          "连接已由另一处更新，草稿保留，请返回目录读取最新版本。",
          "reload",
          "revision_conflict"
        )
      if (operationRequestId && failure === "save-unknown-pending") {
        receipts.set(operationRequestId, {
          operationRequestId,
          operation: "save",
          targetId: value.id,
          state: "unknown",
        })
        throw demoIssue(
          "示例：服务尚未确认保存结果。",
          "check",
          "result_unknown",
          "warning"
        )
      }
      const saved = {
        ...structuredClone(value),
        ...(value.kind === "subscription"
          ? { accountOperationBusy: false }
          : {}),
        revision: (existing?.revision ?? 0) + 1,
        name: value.name.trim(),
        endpoint: value.endpoint.trim(),
        apiKey: "",
        keySaved:
          value.credential === "key" &&
          (!!value.apiKey.trim() || value.keySaved),
      }
      if (saved.keySaved && value.apiKey) secrets.set(value.id, value.apiKey)
      else if (!saved.keySaved) secrets.delete(value.id)
      connections = connections.some((item) => item.id === saved.id)
        ? connections.map((item) => (item.id === saved.id ? saved : item))
        : [...connections, saved]
      if (operationRequestId)
        receipts.set(operationRequestId, {
          operationRequestId,
          operation: "save",
          targetId: value.id,
          state: "committed",
          revision: saved.revision,
        })
      if (failure === "save-unknown") {
        failure = undefined
        throw demoIssue(
          "未收到本次保存的结果，草稿保留，请核对原请求。",
          "check",
          "result_unknown",
          "warning"
        )
      }
      return structuredClone(saved)
    },
    async remove(id, signal, revision, operationRequestId) {
      await operation("remove", signal)
      const existing = connections.find((item) => item.id === id)
      if (!existing || existing.revision !== revision)
        throw demoIssue(
          "连接已更新，原删除未提交，请重新读取目录。",
          "reload",
          "revision_conflict"
        )
      connections = connections.filter((item) => item.id !== id)
      secrets.delete(id)
      if (operationRequestId)
        receipts.set(operationRequestId, {
          operationRequestId,
          operation: "remove",
          targetId: id,
          state: "committed",
          revision,
        })
      if (failure === "remove-unknown") {
        failure = undefined
        throw demoIssue(
          "未收到删除结果，请核对原请求。",
          "check",
          "result_unknown",
          "warning"
        )
      }
    },
    async discover(value, signal) {
      await operation("discover", signal)
      const issue = connectionIssue(value)
      if (issue) throw demoIssue(issue, "settings")
      return structuredClone([
        ...modelFixtures,
        model("local-reasoner", "Local Reasoner", "openai-completions"),
      ])
    },
    async check(value, _model, signal) {
      const validation = Object.values(
        connectionErrors(value, [], value.kind === "api")
      )[0]
      if (validation) throw demoIssue(validation, "settings")
      await operation("check", signal)
      const issue = connectionIssue(value)
      if (issue) throw demoIssue(issue, "settings")
    },
    auth: {
      async start(connection, signal, operationRequestId) {
        const id = operationRequestId ?? crypto.randomUUID()
        const existing = authorizations.get(id)
        if (existing) return structuredClone(existing)
        signal.throwIfAborted()
        if (
          connections.some(
            (item) =>
              item.kind === "subscription" &&
              item.providerId === connection.providerId &&
              item.accountOperationBusy
          )
        )
          throw demoIssue(
            "示例：账号清理仍在进行，请先核对当前状态。",
            "check",
            "account_operation_pending",
            "warning"
          )
        const controller = new AbortController()
        const abort = () => controller.abort()
        signal.addEventListener("abort", abort, { once: true })
        authorizationControllers.set(id, controller)
        authorizations.set(id, {
          id,
          status: "pending",
          stage: "preparing",
          connection,
          events: [],
        })
        const start = (async () => {
          try {
            await operation("authorize", controller.signal)
            const saved = await service.save(connection, controller.signal)
            controller.signal.throwIfAborted()
            const state: AuthState = {
              id,
              status: "pending",
              stage: "authorizing",
              connection: saved,
              events: [
                {
                  type: "device_code",
                  userCode: "DEMO-1234",
                  instructions:
                    "演示授权不会连接真实账号。输入任意示例授权码，查看完成状态。",
                },
              ],
              prompt: {
                id: "demo-prompt",
                type: "manual_code",
                message: "填写示例授权码",
              },
            }
            authorizations.set(id, state)
            if (failure === "authorize-unknown") {
              failure = undefined
              throw demoIssue(
                "示例：未收到授权开始结果，请核对原授权任务；不要再次启动授权。",
                "check",
                "result_unknown",
                "warning"
              )
            }
            return structuredClone(state)
          } catch (reason) {
            const current = authorizations.get(id)!
            const issue = (reason as { issue?: OperationIssue }).issue
            if (controller.signal.aborted) {
              const cancelled: AuthState = {
                ...current,
                status: "cancelled",
                prompt: undefined,
              }
              authorizations.set(id, cancelled)
              return structuredClone(cancelled)
            }
            if (issue?.code !== "result_unknown")
              authorizations.set(id, {
                ...current,
                status: "error",
                prompt: undefined,
                error: issue?.summary ?? "示例授权未完成。",
                issue,
              })
            throw reason
          } finally {
            signal.removeEventListener("abort", abort)
            authorizationControllers.delete(id)
          }
        })()
        authorizationStarts.set(id, start)
        return start
      },
      async poll(id, signal) {
        await delay(100, signal)
        const state = authorizations.get(id)
        if (!state) throw demoIssue("授权已结束，请重新开始。", "none")
        return structuredClone(state)
      },
      async reply(id, _, value, signal) {
        await delay(250, signal)
        const state = authorizations.get(id)
        if (!state || state.status !== "pending")
          throw demoIssue("授权已结束，请重新开始。", "none")
        if (!value.trim()) throw demoIssue("请填写示例授权码。", "none")
        const saved = await service.save(
          {
            ...state.connection,
            account: {
              name: "demo@example.invalid",
              plan: "演示订阅",
              loggedIn: true,
            },
          },
          signal
        )
        const completed: AuthState = {
          ...state,
          status: "complete",
          prompt: undefined,
          connection: saved,
        }
        authorizations.set(id, completed)
        return structuredClone(completed)
      },
      async cancel(id) {
        const state = authorizations.get(id)
        if (!state)
          throw demoIssue(
            "无法核对原授权，请保留此窗口。",
            "check",
            "authorization_unknown",
            "warning"
          )
        if (state.status === "pending") {
          authorizations.set(id, {
            ...state,
            status: "cancelled",
            prompt: undefined,
          })
          authorizationControllers.get(id)?.abort()
        }
        await authorizationStarts.get(id)?.catch(() => {})
      },
      async logout(id, signal) {
        const item = connections.find((value) => value.id === id)
        if (!item) throw demoIssue("连接不存在。", "reload")
        if (
          connections.some(
            (value) =>
              value.kind === "subscription" &&
              value.providerId === item.providerId &&
              value.accountOperationBusy
          )
        )
          throw demoIssue(
            "示例：账号清理仍在进行，请先核对当前状态。",
            "check",
            "account_operation_pending",
            "warning"
          )
        const saved = {
          ...item,
          accountOperationBusy: false,
          account: { ...item.account!, loggedIn: false },
        }
        connections = connections.map((value) =>
          value.kind === "subscription" && value.providerId === item.providerId
            ? { ...value, accountOperationBusy: true }
            : value
        )
        try {
          await operation("logout", signal)
        } catch (reason) {
          connections = connections.map((value) =>
            value.kind === "subscription" &&
            value.providerId === item.providerId
              ? { ...value, accountOperationBusy: false }
              : value
          )
          throw reason
        }
        connections = connections.map((value) =>
          value.kind === "subscription" && value.providerId === item.providerId
            ? {
                ...value,
                accountOperationBusy: false,
                account: { ...value.account!, loggedIn: false },
              }
            : value
        )
        if (
          failure === "logout-unknown" ||
          failure === "logout-read-error" ||
          failure === "logout-read-restart" ||
          failure === "logout-read-busy" ||
          failure === "logout-read-unsupported"
        ) {
          if (failure === "logout-read-busy") {
            logoutPendingReads = 2
            logoutPendingProvider = item.providerId
            connections = connections.map((value) =>
              value.kind === "subscription" &&
              value.providerId === item.providerId
                ? { ...value, accountOperationBusy: true }
                : value
            )
          }
          if (failure === "logout-read-unsupported")
            connections = connections.map((value) =>
              value.kind === "subscription" &&
              value.providerId === item.providerId
                ? { ...value, accountOperationBusy: undefined }
                : value
            )
          failure =
            failure === "logout-read-error"
              ? "list"
              : failure === "logout-read-restart"
                ? "list-restart"
                : undefined
          throw demoIssue(
            "示例：退出响应丢失，请读取当前登录状态，不会再次退出。",
            "check",
            "result_unknown",
            "warning"
          )
        }
        return structuredClone(saved)
      },
    },
  }
  return service
}
