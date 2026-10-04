const text = (description) => ({ type: "string", description })
export const issueSchemas = {
  OperationIssue: {
    type: "object",
    additionalProperties: false,
    properties: {
      code: text("稳定问题类别，不能通过解析显示文案决定恢复动作"),
      summary: text("已脱敏的用户原因；不包含提供方响应、凭据或内部文件标识"),
      details: text("可选安全诊断，只含允许公开的错误码与操作类别"),
      recovery: {
        type: "string",
        enum: ["retry", "reload", "check", "settings", "restart", "none"],
        description: "所属操作允许的恢复方向；具体按钮由该操作的调用方提供",
      },
      severity: {
        type: "string",
        enum: ["error", "warning", "info"],
        description: "取消/等待属于info，非阻断问题warning，操作失败error",
      },
    },
    required: ["code", "summary", "recovery", "severity"],
  },
  RpcFailure: {
    type: "object",
    additionalProperties: false,
    properties: {
      error: text("兼容旧客户端的安全错误摘要"),
      issue: { $ref: "OperationIssue" },
    },
    required: ["error", "issue"],
  },
}
