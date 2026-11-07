const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
export const bootSchemas = {
  BrowserBootStatus: object({
    readable: {
      type: "boolean",
      description:
        "启动所需模型、会话、MCP、工作区、队列/控制和维护记录通过纯schema读取验证；可选插件错误单独呈现",
    },
  }),
}
export const bootOperations = {
  bootStatus: {
    module: "启动",
    method: "boot.status",
    args: ["$signal"],
    request: object({}),
    response: { $ref: "BrowserBootStatus" },
    title: "检查服务与已保存数据",
    input: [],
    result: "BrowserBootStatus",
    condition:
      "纯读取启动所需模型、会话、MCP、工作区、队列/控制与维护记录schema；可选插件/扩展错误由其列表呈现，不阻断独立聊天；可取消，不恢复执行、连接MCP、发现扩展或重放unknown请求。",
    errors: "服务不可连接、已保存JSON/schema损坏或请求取消。",
    effect: "只验证已保存数据是否可读，不写入或启用业务资源。",
    example: {},
  },
}
