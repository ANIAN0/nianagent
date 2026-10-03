// RPC contract for the real Pi conversation lifecycle. Merged into schema.mjs.
const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const num = (description) => ({ type: "integer", minimum: 0, description })
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const ref = (name) => ({ $ref: name })
const arr = (items) => ({ type: "array", items })
const id = str("稳定的业务会话/请求标识", {
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9_-]+$",
})
const thinking = str("Pi 原生思考等级；不支持思考的模型只能使用 off", {
  enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
})
const tool = obj(
  {
    id: str("Pi toolCallId"),
    name: str("工具名称"),
    source: str("工具来源"),
    status: str("实际执行状态", {
      enum: ["running", "success", "failed", "stopped", "not-run"],
    }),
    input: str("序列化工具输入"),
    result: str("实际工具结果"),
    exitCode: {
      type: "integer",
      description: "Pi shell 实际退出码，0 是成功；未返回时省略，不从文本推断",
    },
    durationMs: {
      type: "number",
      minimum: 0,
      description: "Pi shell 实际 wall_time_seconds 换算为毫秒；未返回时省略",
    },
  },
  ["id", "name", "source", "status", "input", "result"]
)
export const conversationSchemas = {
  ConversationChatTool: tool,
  ConversationRuntime: obj(
    {
      phase: str(
        "本次回复的实时执行阶段；只在 running 返回，不代表任务验收结果",
        {
          enum: ["responding", "tool", "retrying", "compacting"],
        }
      ),
      updatedAt: str("阶段发生时的 ISO 时间"),
      toolName: str("当前运行的 Pi 工具名称"),
      attempt: num("Pi 当前自动重试次数"),
      maxAttempts: num("Pi 本次自动重试上限"),
      retryAt: str("Pi 重试等待结束的 ISO 时间；等待结束后下一次事件更新阶段"),
      reason: str("固定安全原因，不包含提供者原始响应或凭据"),
      retrySource: str("自动重试属于回复请求还是上下文压缩", {
        enum: ["response", "compaction"],
      }),
    },
    ["phase", "updatedAt"]
  ),
  ConversationChatMessage: obj(
    {
      id: str("由 Pi 消息时间和顺序生成的稳定展示标识"),
      role: str("消息角色", { enum: ["user", "assistant"] }),
      text: str("消息文本"),
      time: str("ISO 时间"),
      model: str("实际模型"),
      status: str("消息状态", {
        enum: ["sending", "streaming", "settled", "interrupted", "failed"],
      }),
      thinking: obj({ text: str("Pi 实际返回的思考内容") }),
      tools: arr(ref("ConversationChatTool")),
      blocks: arr({
        anyOf: [
          obj({
            id: str("内容标识"),
            type: { type: "string", enum: ["text"] },
            text: str("文本"),
          }),
          obj({
            id: str("内容标识"),
            type: { type: "string", enum: ["tool"] },
            tool: ref("ConversationChatTool"),
          }),
        ],
      }),
    },
    ["id", "role", "text", "time", "status"]
  ),
  ConversationSnapshot: {
    ...obj(
      {
        id,
        title: str("会话标题"),
        workspaceId: id,
        cwd: str("真实工作目录"),
        version: num("当前宿主单调更新版本，结合 epoch 判断新宿主"),
        epoch: str("宿主启动标识"),
        clientRequestId: str("最后接受的客户端请求标识；空会话为空"),
        inputAccepted: {
          type: "boolean",
          description:
            "仅在 Pi 持久化方法成功返回后确认用户消息（或继续指令）已接受；消息事件本身不代表保存成功。该输入写入失败时返回 false、保留草稿，明确重发使用新请求标识；相同标识不重复执行。",
        },
        runId: str("本次或最后一次运行标识"),
        phase: str(
          "真实回复运行状态；completed 仅表示本轮运行结束，不代表用户任务验收成功",
          {
            enum: [
              "idle",
              "running",
              "stopping",
              "completed",
              "failed",
              "interrupted",
            ],
          }
        ),
        modelId: str("连接 ID/模型 ID 的选择值"),
        connectionId: str("模型连接 ID"),
        providerModelId: str("服务端模型 ID"),
        thinking,
        error: str("错误说明，成功为空"),
        messages: arr(ref("ConversationChatMessage")),
        runtime: ref("ConversationRuntime"),
        notice: obj({
          kind: str("非阻断执行提醒", { enum: ["compaction-failed"] }),
          message: str("安全说明；不把压缩失败等同任务失败"),
          occurredAt: str("提醒发生时的 ISO 时间"),
          runId: str("此提醒所属回复运行标识；新回复清除旧提醒"),
        }),
        context: obj(
          {
            usedTokens: num(
              "Pi getContextUsage 提供的上下文 token 估算，不等同完整请求或精确计费"
            ),
            contextWindow: num("当前模型上下文上限"),
            source: str("统计的权威来源", { enum: ["pi-context-estimate"] }),
            estimated: {
              type: "boolean",
              description: "Pi 统计为上下文估算，正式实现为 true",
            },
            observedAt: str("统计读取时点的 ISO 时间"),
            restored: {
              type: "boolean",
              description:
                "true 表示从正式历史恢复的已记录统计，并非当前实时请求",
            },
          },
          ["usedTokens", "contextWindow"]
        ),
        contextState: obj(
          {
            status: str("未知用量的原因分类；不会同时返回 context", {
              enum: ["awaiting-response", "unavailable"],
            }),
            contextWindow: num("已知的模型上下文上限"),
            observedAt: str("未知状态确认时点的 ISO 时间"),
            reason: str("未知用量的安全说明"),
          },
          ["status", "observedAt", "reason"]
        ),
      },
      [
        "id",
        "title",
        "workspaceId",
        "cwd",
        "version",
        "epoch",
        "clientRequestId",
        "inputAccepted",
        "runId",
        "phase",
        "modelId",
        "connectionId",
        "providerModelId",
        "thinking",
        "error",
        "messages",
      ]
    ),
    description:
      "运行结束仅表示本轮回复结束，任务应依据实际文件、命令和用户验收确认。执行阶段来自 Pi 官方事件；命令退出码不从文本猜测。上下文统计为 Pi 估算，标明统计时点；历史恢复的值不是当前请求统计，未知用量不会补成 0。",
  },
}
const selection = {
  connectionId: str("连接目录中的精确 ID", { minLength: 1, maxLength: 100 }),
  modelId: str("模型的精确 ID，允许斜杠", { minLength: 1, maxLength: 300 }),
  thinking,
}
const common = {
  module: "真实对话",
  response: ref("ConversationSnapshot"),
  result: "ConversationSnapshot",
  errors:
    "会话或工作区不存在、目录不可用、配置损坏、模型不可用、同一会话正在运行、请求标识冲突、存储失败。",
}
export const conversationOperations = {
  conversationSend: {
    ...common,
    method: "conversations.send",
    args: [
      "sessionId",
      "workspaceId",
      "clientRequestId",
      "text",
      "connectionId",
      "modelId",
      "thinking",
      "$signal",
    ],
    title: "发送真实多轮消息",
    input: [
      "sessionId",
      "workspaceId",
      "clientRequestId",
      "text",
      "connectionId",
      "modelId",
      "thinking",
    ],
    request: obj({
      sessionId: id,
      workspaceId: id,
      clientRequestId: id,
      text: str("本轮用户文本", { minLength: 1, maxLength: 100000 }),
      ...selection,
    }),
    condition:
      "需保存工作区、会话配置与可用模型；同一会话串行。clientRequestId 对相同内容幂等，改变内容须新标识。提交前取消不开始生成；接受后需 Stop 明确停止，不因断开轮询取消。",
    effect:
      "Pi 官方 JSONL 保存消息，后台发起真实推理与已启用工具，可能产生费用并修改所选目录；快速返回后轮询 Read。",
    example: {
      sessionId: "sample-session",
      workspaceId: "sample-workspace",
      clientRequestId: "sample-request",
      text: "列出当前目录的文件",
      connectionId: "sample",
      modelId: "sample-model",
      thinking: "off",
    },
  },
  conversationRead: {
    ...common,
    method: "conversations.read",
    args: ["sessionId", "afterVersion", "$signal"],
    title: "读取对话与流式进度",
    input: ["sessionId"],
    request: obj(
      {
        sessionId: id,
        afterVersion: num("可选：客户端已见版本；本版始终返回完整快照"),
      },
      ["sessionId"]
    ),
    condition:
      "不触发推理；每 200–300ms 轮询，失败保留旧画面；epoch 改变时接纳新宿主快照。读取不标记已读，不迁移或修复磁盘 JSONL。非空行 JSON 损坏、文件头无效、工作目录不匹配或历史版本过新时明确拒绝，原文件不改写。",
    effect:
      "通过 Pi 官方内存 SessionManager 恢复合法历史及分支；v1/v2 只在内存迁移，缺少末尾换行不补写；正式发送才交由 Pi 打开持久化历史并迁移。模型配置或工作目录被移除仍可查看已存消息。runtime 仅表示当前执行阶段；context 是 Pi 估算，未知时返回 contextState，重启统计标记 restored。shell 结果可含实际 exitCode/durationMs，缺失不推断。",
    errors:
      "会话不存在、历史不存在或无法读取、历史 JSON 或文件头损坏、工作目录元数据不匹配、历史版本高于当前 Pi 支持版本；失败不会覆盖原历史。",
    example: { sessionId: "sample-session" },
  },
  conversationStop: {
    ...common,
    method: "conversations.stop",
    args: ["sessionId", "runId", "$signal"],
    title: "停止本次生成",
    input: ["sessionId", "runId"],
    request: obj({ sessionId: id, runId: id }),
    condition:
      "runId 必须匹配；重复停止幂等；设置 stopping 后后台等待 Pi abort 完成。",
    effect: "停止模型与工具，保留已写入消息和真实工具结果，不回滚已执行操作。",
    example: { sessionId: "sample-session", runId: "sample-run" },
  },
  conversationRetry: {
    ...common,
    method: "conversations.retry",
    args: [
      "sessionId",
      "clientRequestId",
      "connectionId",
      "modelId",
      "thinking",
      "$signal",
    ],
    title: "继续上次未完成回复",
    input: [
      "sessionId",
      "clientRequestId",
      "connectionId",
      "modelId",
      "thinking",
    ],
    request: obj({ sessionId: id, clientRequestId: id, ...selection }),
    condition:
      "仅失败或中断会话；本轮 inputAccepted 必须为 true 且需要已有用户历史，clientRequestId 幂等。预检未接受输入时须保留草稿重新发送，旧用户历史不能代替本轮接受边界。不重发原始用户请求。",
    effect:
      "通过 Pi sendCustomMessage 添加可见的继续指令后发起下一轮，保留先前回复与工具结果。",
    example: {
      sessionId: "sample-session",
      clientRequestId: "sample-retry",
      connectionId: "sample",
      modelId: "sample-model",
      thinking: "off",
    },
  },
}
