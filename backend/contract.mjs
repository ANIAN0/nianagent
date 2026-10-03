import { workspaceOperations } from "./workspace-contract.mjs"
import { schemas, object, ref, assertSchema } from "./schema.mjs"
export { schemas, assertSchema } from "./schema.mjs"
// Authority for RPC names, required input fields, documentation and dispatch.
export const operations = {
  ...workspaceOperations,
  sessionCatalog: {
    module: "会话配置",
    method: "sessions.catalog",
    args: ["cwd", "$signal"],
    request: object({ cwd: { type: "string", maxLength: 4096 } }),
    response: ref("SessionCatalog"),
    title: "会话工具与指令目录",
    input: ["cwd"],
    result: "SessionCatalog",
    condition:
      "空 cwd 使用服务当前目录；显式路径必须为存在的绝对目录；只读，可取消；使用 Pi 发现规则，只注册内置工具，不执行工具、插件或模型调用。",
    errors: "目录无效、指令文件读取失败、Pi 初始化失败。",
    effect: "读取工具和指令，不保存会话配置。",
    example: { cwd: "H:/workspace/moon" },
  },
  sessionRead: {
    module: "会话配置",
    method: "sessions.read",
    args: ["sessionId", "$signal"],
    request: object({
      sessionId: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[a-zA-Z0-9_-]+$",
      },
    }),
    response: { anyOf: [ref("SessionConfiguration"), { type: "null" }] },
    title: "读取会话生效配置",
    input: ["sessionId"],
    result: "SessionConfiguration | null",
    condition:
      "无记录返回 null；恢复真实 Pi 会话和指令快照。保留保存的toolIds/revision；未知或依赖失效项列入unavailableToolIds，effectiveToolIds仅为实际可用活动集，允许用户取消失效项后重新应用。",
    errors:
      "配置文件损坏、工作目录失效；工具失效作为可编辑结果返回，不阻断读取。",
    effect: "恢复内存会话，不发起推理、不写配置。",
    example: { sessionId: "sample-session" },
  },
  sessionApply: {
    module: "会话配置",
    method: "sessions.apply",
    args: [
      "sessionId",
      "cwd",
      "toolIds",
      "instructionScope",
      "revision",
      "$signal",
    ],
    request: object(
      {
        sessionId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[a-zA-Z0-9_-]+$",
        },
        cwd: { type: "string", minLength: 1, maxLength: 4096 },
        toolIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          maxItems: 32,
        },
        instructionScope: ref("InstructionScope"),
        revision: { type: "integer", minimum: 1 },
      },
      ["sessionId", "cwd", "toolIds", "instructionScope"],
    ),
    response: ref("SessionConfiguration"),
    title: "应用会话配置",
    input: ["sessionId", "cwd", "toolIds", "instructionScope"],
    result: "SessionConfiguration",
    condition:
      "新建省略 revision；更新必须带当前 revision，cwd 不可变。锁内复查版本，未知/重复工具拒绝。构建真实 Pi 会话成功才提交；rename 前取消无写入，提交后取消不回滚，可读取确认。正在运行的会话拒绝更改。",
    errors: "版本冲突、目录无效、工具不可用、指令读取失败、会话忙、存储失败。",
    effect:
      "原子保存工具选择和实际指令快照，并替换生效 Pi 会话。只配置不调用模型。",
    example: {
      sessionId: "sample-session",
      cwd: "H:/workspace/moon",
      toolIds: ["read"],
      instructionScope: "directory",
    },
  },

  list: {
    method: "list",
    args: [],
    request: object({}),
    response: { type: "array", items: ref("ModelConnection") },
    condition:
      "只读；可取消等待，不写入配置。初始化失败后修复文件，再次调用会重试，无需重启。",
    errors: "配置文件损坏或读取权限不足。",
    title: "连接目录",
    input: [],
    result: "ModelConnection[]（无明文密钥）",
    effect: "只读",
    example: {},
  },
  revealKey: {
    method: "revealKey",
    args: ["id", "revision", "$signal"],
    request: object({
      id: { type: "string", minLength: 1 },
      revision: { type: "integer", minimum: 1 },
    }),
    response: object({ apiKey: { type: "string" } }),
    condition:
      "只读；用户显式显示或复制时调用。仅已保存API密钥，不读取环境变量或OAuth令牌；旧版本拒绝读取。",
    errors: "连接不存在、版本已变更、不是API密钥方式、尚未保存密钥。",
    title: "查看已保存密钥",
    input: ["id", "revision"],
    result: "{apiKey}",
    effect: "返回敏感值，不写入配置；调用页面离开后清理，不记录日志。",
    example: { id: "sample", revision: 1 },
  },
  providers: {
    method: "providers",
    args: [],
    request: object({}),
    response: {
      type: "array",
      items: object({ id: { type: "string" }, name: { type: "string" } }),
    },
    condition: "只读；返回当前安装 Pi 支持的 OAuth 提供者。",
    errors: "SDK 加载失败或依赖缺失。",
    title: "Pi 订阅提供者",
    input: [],
    result: "{id,name}[]",
    effect: "只读",
    example: {},
  },
  save: {
    method: "save",
    args: ["connection", "$signal"],
    request: object({ connection: ref("ModelConnection") }),
    response: ref("ModelConnection"),
    condition:
      "提交前取消不写入；rename 为提交边界，提交后取消不回滚。新建不传 revision；编辑必须携带原版本。",
    errors:
      "字段不合法、模型能力不完整、重名、旧版本、连接已删除、授权租约占用、文件写入失败。",
    title: "保存连接与模型",
    input: ["connection"],
    result: "ModelConnection",
    effect: "原子持久化；revision 冲突拒绝覆盖",
    example: {
      connection: {
        id: "sample",
        name: "本地模型",
        kind: "api",
        endpoint: "http://localhost:11434/v1",
        credential: "none",
        keySaved: false,
        apiKey: "",
        environmentVariable: "",
        headers: "{}",
        models: [],
      },
    },
  },
  remove: {
    method: "remove",
    args: ["id", "revision", "$signal"],
    request: object({
      id: { type: "string", minLength: 1 },
      revision: { type: "integer", minimum: 1 },
    }),
    response: { type: "null" },
    condition:
      "必须带当前 revision；锁等待和提交前取消都保留连接、模型和凭据；提交后不可回滚。",
    errors: "连接不存在/版本冲突、授权尚未结束、锁或文件错误。",
    title: "删除连接",
    input: ["id", "revision"],
    result: "null",
    effect: "删除连接、模型及该连接凭据",
    example: { id: "sample", revision: 1 },
  },
  discover: {
    method: "discover",
    args: ["connection", "$signal"],
    request: object({ connection: ref("ModelConnection") }),
    response: { type: "array", items: ref("ModelDefinition") },
    condition:
      "API 连接需端点和所选凭据；订阅读取内置目录。只返回候选，不保存。20秒内可取消。协议不因能力匹配改变。",
    errors:
      "端点/凭据无效、HTTP失败、非法目录、分页游标无效、超时；未知能力作为未匹配结果返回。",
    title: "发现候选模型",
    input: ["connection"],
    result: "ModelDefinition[]",
    effect: "请求外部目录，不保存草稿；未知能力留空",
    example: {
      connection: {
        id: "sample",
        name: "本地模型",
        kind: "api",
        endpoint: "http://localhost:11434/v1",
        credential: "none",
        keySaved: false,
        apiKey: "",
        environmentVariable: "",
        headers: "{}",
        models: [],
      },
    },
  },
  check: {
    method: "check",
    args: ["connection", "model", "$signal"],
    request: object({
      connection: ref("ModelConnection"),
      model: ref("ModelDefinition"),
    }),
    response: { type: "null" },
    condition:
      "需要完整模型能力和可用凭据；Pi 发起短推理，可能收费；30秒超时，取消不代表提供者退费。",
    errors: "凭据/模型无效、提供者请求失败、超时或取消。",
    title: "检查模型调用",
    input: ["connection", "model"],
    result: "null",
    effect: "Pi 发起最小真实推理，可能产生费用",
    example: {
      connection: {
        id: "sample",
        name: "本地模型",
        kind: "api",
        endpoint: "http://localhost:11434/v1",
        credential: "none",
        keySaved: false,
        apiKey: "",
        environmentVariable: "",
        headers: "{}",
        models: [],
      },
      model: {
        id: "example",
        name: "示例模型",
        api: "openai-completions",
        input: ["text"],
        reasoning: false,
        contextWindow: 4096,
        maxTokens: 128,
      },
    },
  },
  authStart: {
    method: "jobs.start",
    args: ["connection", "$signal"],
    request: object({ connection: ref("ModelConnection") }),
    response: ref("AuthState"),
    condition:
      "先保存连接再开始授权；取消不会删除已保存连接。启动请求取消后，不保留尚未启动的任务；任务开始后使用 authCancel。",
    errors:
      "非订阅连接、不支持的提供者、版本冲突、重复授权、保存或授权初始化失败。",
    title: "开始订阅授权",
    input: ["connection"],
    result: "AuthState",
    effect: "调用 Pi OAuth；成功立即持久化凭据",
    example: {
      connection: {
        id: "sample",
        name: "订阅",
        kind: "subscription",
        providerId: "anthropic",
        endpoint: "",
        credential: "none",
        keySaved: false,
        apiKey: "",
        environmentVariable: "",
        headers: "{}",
        models: [],
      },
    },
  },
  authPoll: {
    method: "jobs.poll",
    args: ["id"],
    request: object({ id: { type: "string", minLength: 1 } }),
    response: ref("AuthState"),
    condition: "只读；任务最长10分钟，结束后状态保留5分钟。",
    errors: "任务不存在或已过期。",
    title: "读取授权状态",
    input: ["id"],
    result: "AuthState（无 token）",
    effect: "只读",
    example: { id: "授权任务ID" },
  },
  authReply: {
    method: "jobs.reply",
    args: ["id", "promptId", "value"],
    request: object({
      id: { type: "string", minLength: 1 },
      promptId: { type: "string", minLength: 1 },
      value: { type: "string", maxLength: 16000 },
    }),
    response: ref("AuthState"),
    condition:
      "只接受当前提示 ID；select 输入必须是允许选项。输入交给 Pi 后取消不撤回。",
    errors: "过期提示、非法选项、任务不存在或输入过长。",
    title: "提交授权提示输入",
    input: ["id", "promptId", "value"],
    result: "AuthState",
    effect: "提交给 Pi 当前 prompt，拒绝过期输入",
    example: { id: "授权任务ID", promptId: "提示ID", value: "" },
  },
  authCancel: {
    method: "jobs.cancel",
    args: ["id"],
    request: object({ id: { type: "string", minLength: 1 } }),
    response: { type: "null" },
    condition:
      "显式取消授权任务并等待结束；重复取消无副作用；已完成授权凭据不会自动退出。",
    errors: "存储清理失败；不存在任务视作已结束。",
    title: "取消授权",
    input: ["id"],
    result: "null",
    effect: "中止 Pi 登录并释放提示监听",
    example: { id: "授权任务ID" },
  },
  logout: {
    method: "logout",
    args: ["id", "$signal"],
    request: object({ id: { type: "string", minLength: 1 } }),
    response: ref("ModelConnection"),
    condition:
      "取消提交前可中止；Pi 删除凭据，连接和模型保留。已提交删除不回滚。",
    errors: "订阅连接不存在、任务尚未取消、凭据写入/删除失败。",
    title: "退出订阅",
    input: ["id"],
    result: "ModelConnection",
    effect: "Pi 删除凭据，模型保留但不可用",
    example: { id: "连接ID" },
  },
}
export function validateRequest(operation, input) {
  if (!Object.hasOwn(operations, operation)) throw new Error("未知接口。")
  const definition = operations[operation]
  assertSchema(definition.request, input)
  return definition
}
export async function dispatchOperation(service, operation, input, signal) {
  const definition = validateRequest(operation, input)
  signal?.throwIfAborted()
  const path = definition.method.split(".")
  const method = path.pop()
  const owner = path.reduce((value, key) => value[key], service)
  const result =
    (await owner[method](
      ...definition.args.map((key) =>
        key === "$signal" ? signal : input[key],
      ),
    )) ?? null
  assertSchema(definition.response, result, "返回结果")
  return result
}
