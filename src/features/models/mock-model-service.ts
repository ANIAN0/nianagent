import type {
  ModelConnection,
  ModelDefinition,
  ModelService,
} from "./model-types"
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
  failure?: "list" | "save" | "remove" | "discover" | "check" | "authorize"
  oauthDelay?: number
}
/** Memory-only adapter. Never sends credentials or requests to the listed endpoints. */
export function createMockModelService(
  seed = connectionFixtures,
  options: MockModelOptions = {}
): ModelService {
  let connections = structuredClone(seed)
  let failure = options.failure
  async function operation(
    name: NonNullable<MockModelOptions["failure"]>,
    signal: AbortSignal
  ) {
    await delay(
      name === "authorize" ? (options.oauthDelay ?? 2200) : 450,
      signal
    )
    if (failure === name) {
      failure = undefined
      throw new Error("模拟服务暂时不可用，请重试。原有数据未改变。")
    }
  }
  return {
    async list(signal) {
      await operation("list", signal)
      return structuredClone(connections)
    },
    async save(value, signal) {
      await operation("save", signal)
      const saved = {
        ...structuredClone(value),
        name: value.name.trim(),
        endpoint: value.endpoint.trim(),
        apiKey: "",
        keySaved:
          value.credential === "key" &&
          (!!value.apiKey.trim() || value.keySaved),
      }
      connections = connections.some((item) => item.id === saved.id)
        ? connections.map((item) => (item.id === saved.id ? saved : item))
        : [...connections, saved]
      return structuredClone(saved)
    },
    async remove(id, signal) {
      await operation("remove", signal)
      connections = connections.filter((item) => item.id !== id)
    },
    async discover(value, signal) {
      await operation("discover", signal)
      const issue = connectionIssue(value)
      if (issue) throw new Error(issue)
      return structuredClone([
        ...modelFixtures,
        model("local-reasoner", "Local Reasoner", "openai-completions"),
      ])
    },
    async check(value, _model, signal) {
      const validation = Object.values(
        connectionErrors(value, [], value.kind === "api")
      )[0]
      if (validation) throw new Error(validation)
      await operation("check", signal)
      const issue = connectionIssue(value)
      if (issue) throw new Error(issue)
    },
    async authorize(signal, response) {
      await operation("authorize", signal)
      if (!response?.confirmation) return { kind: "prompt" }
      if (!response.scope) return { kind: "select" }
      return {
        kind: "complete",
        account: {
          name: "demo@example.invalid",
          plan: "个人订阅",
          loggedIn: true,
        },
      }
    },
  }
}
