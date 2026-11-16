const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
export const bootSchemas = {
  BrowserBootStatus: {
    type: "object",
    properties: {
      readable: {
        type: "boolean",
        description:
          "平台层可达且启动确认已完成；各领域存储结果在 domains 中逐域呈现，单域损坏不使其为假",
      },
      domains: {
        type: "array",
        description: "各领域存储核验结果；损坏域以 ok=false 与安全错误说明呈现",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            ok: { type: "boolean" },
            issue: { type: "string" },
          },
          required: ["name", "ok"],
          additionalProperties: false,
        },
      },
    },
    required: ["readable"],
    additionalProperties: false,
  },
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
      "分层启动确认：平台可达即返回，各领域存储（模型/会话/MCP/工作区/队列控制与维护记录）独立核验并逐域呈现；单域损坏明确列出，不阻塞其他域与工作台入口；可选插件/扩展错误由其列表呈现；可取消，不恢复执行、连接MCP、发现扩展或重放unknown请求。",
    errors: "服务不可连接或请求取消。",
    effect:
      "只验证已保存数据是否可读，不写入或启用业务资源；损坏域原数据保留。",
    example: {},
  },
}
