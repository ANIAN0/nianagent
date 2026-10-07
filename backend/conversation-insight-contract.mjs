const s = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const n = (description) => ({ type: "integer", minimum: 0, description })
const o = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const r = (name) => ({ $ref: name })
const id = s("稳定标识", {
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9_-]+$",
})
export const insightSchemas = {
  ConversationStatistics: o(
    {
      input: n("Pi provider input tokens"),
      output: n("Pi provider output tokens"),
      cacheRead: n("Pi缓存读tokens"),
      cacheWrite: n("Pi缓存写tokens"),
      totalTokens: n("Pi会话tokens总和"),
      toolCalls: n("正式分支工具调用数"),
      turns: n("正式Pi分支中有assistant消息的用户轮次数"),
      steps: n("正式Pi分支assistant消息数，含工具调用步骤"),
      durationMs: n("本轮总耗时，包含工具与等待"),
      modelDurationMs: n("本轮模型消息生成耗时，不含工具与审批"),
      outputTokens: n("本轮Pi output tokens，未返回usage时省略"),
      tokensPerSecond: {
        type: "number",
        minimum: 0,
        description:
          "本轮output/modelDuration估算，等待不算生成，缺usage不返回",
      },
      cost: {
        type: "number",
        minimum: 0,
        description: "Pi模型费率估算USD；无费率不返回，不能当实际账单",
      },
      restored: { type: "boolean", description: "历史恢复" },
    },
    ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "toolCalls"]
  ),
  ConversationCommand: o(
    {
      name: s("精确调用名"),
      description: s("命令描述"),
      kind: s("命令类型", { enum: ["host", "extension"] }),
      available: { type: "boolean" },
      reason: s("禁用原因"),
    },
    ["name", "description", "kind", "available"]
  ),
  ConversationCommandReceipt: o(
    {
      id,
      sessionId: id,
      name: s("精确命令名"),
      status: s("命令状态，started先于副作用；unknown不能重发", {
        enum: ["started", "completed", "failed", "unknown"],
      }),
      issue: r("OperationIssue"),
    },
    ["id", "sessionId", "name", "status"]
  ),
}
const common = {
  module: "会话命令",
  errors: "未注册命令、会话运行中、相同ID内容冲突、存储失败。",
}
export const insightOperations = {
  conversationCommandRun: {
    ...common,
    method: "conversations.commands.run",
    args: ["sessionId", "commandRequestId", "name", "arguments", "$signal"],
    request: o({
      sessionId: id,
      commandRequestId: id,
      name: s("精确注册名", { minLength: 1, maxLength: 200 }),
      arguments: s("参数", { maxLength: 100000 }),
    }),
    response: r("ConversationCommandReceipt"),
    result: "ConversationCommandReceipt",
    title: "执行已注册扩展命令",
    input: ["sessionId", "commandRequestId", "name", "arguments"],
    condition:
      "仅正式空闲会话；先保存started回执再调用SDK注册handler，同ID不得重复效果。",
    effect:
      "后台执行，按原IDCommandRead核对；不是模型用户消息。扩展需可信；经SDK执行的工具受会话策略约束，扩展直接调用宿主API不构成沙箱。会话切换由Moon正式控制提供。",
    example: {
      sessionId: "sample-session",
      commandRequestId: "sample-command",
      name: "status",
      arguments: "",
    },
  },
  conversationCommandRead: {
    ...common,
    method: "conversations.commands.read",
    args: ["sessionId", "commandRequestId", "$signal"],
    request: o({ sessionId: id, commandRequestId: id }),
    response: r("ConversationCommandReceipt"),
    result: "ConversationCommandReceipt",
    title: "核对扩展命令原回执",
    input: ["sessionId", "commandRequestId"],
    condition: "只读，缺失或冷恢复started返回unknown。",
    effect: "不重放命令。",
    example: {
      sessionId: "sample-session",
      commandRequestId: "sample-command",
    },
  },
}
