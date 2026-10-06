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
const id = str("稳定标识", {
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9_-]+$",
})
const mode = str("文件工具范围与命令审批策略，不等同操作系统沙箱", {
  enum: ["read-only", "workspace", "full-access"],
})
export const permissionSchemas = {
  ConversationPermission: obj({
    sessionId: id,
    mode,
    revision: num("权限配置CAS版本，运行中禁止更改"),
  }),
  ConversationApproval: obj(
    {
      id,
      runId: str("所属运行，扩展空闲命令为空"),
      kind: str("请求类型", { enum: ["tool", "confirm", "select", "input"] }),
      title: str("请求标题"),
      message: str("请求说明"),
      toolName: str("工具名称"),
      toolCallId: str("Pi 工具调用标识，与 runId 共同关联当前待执行工具"),
      input: str("完整工具参数JSON"),
      options: { type: "array", items: str("允许选项") },
      expiresAt: str("到期自动拒绝，ISO时间"),
    },
    ["id", "runId", "kind", "title", "message", "expiresAt"]
  ),
}
const common = {
  module: "会话权限",
  errors: "保存失败、版本冲突、运行中修改、审批已过期或回答不合法。",
}
export const permissionOperations = {
  conversationPermissionRead: {
    ...common,
    method: "conversations.permissions.read",
    args: ["sessionId", "$signal"],
    request: obj({ sessionId: id }),
    response: ref("ConversationPermission"),
    result: "ConversationPermission",
    title: "读取会话权限",
    input: ["sessionId"],
    condition: "未保存会话默认工作区模式；不激活agent。",
    effect: "只读，未知保存结果以此核对。",
    example: { sessionId: "sample-session" },
  },
  conversationPermissionSet: {
    ...common,
    method: "conversations.permissions.set",
    args: ["sessionId", "mode", "revision", "$signal"],
    request: obj({ sessionId: id, mode, revision: num("已读CAS版本") }),
    response: ref("ConversationPermission"),
    result: "ConversationPermission",
    title: "修改会话权限",
    input: ["sessionId", "mode", "revision"],
    condition: "仅空闲，原子保存，相同模式重复设置幂等。",
    effect:
      "只读允许工作区读取；工作区允许文件修改，命令、外部文件与扩展逐次审批；完全访问取消范围审批但仍尊重工具启用状态。",
    example: { sessionId: "sample-session", mode: "workspace", revision: 0 },
  },
  conversationApprovalReply: {
    ...common,
    method: "conversations.permissions.reply",
    args: ["sessionId", "approvalId", "runId", "value"],
    request: obj({
      sessionId: id,
      approvalId: id,
      runId: str("精确运行身份"),
      value: str(
        "工具/confirm为allow或deny；select为选项；input为文字；cancel取消",
        { maxLength: 16000 }
      ),
    }),
    response: { type: "null" },
    result: "null",
    title: "回答审批或扩展提示",
    input: ["sessionId", "approvalId", "runId", "value"],
    condition:
      "仅精确当前请求，同一答案重复幂等，冲突或过期拒绝。停止和到期自动拒绝。",
    effect: "解除SDK tool_call或ExtensionUIContext等待，关闭页面不批准。",
    example: {
      sessionId: "sample-session",
      approvalId: "sample-approval",
      runId: "sample-run",
      value: "deny",
    },
  },
}
