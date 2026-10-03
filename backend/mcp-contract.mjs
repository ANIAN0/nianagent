const string = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const ref = ($ref) => ({ $ref })
const array = (items) => ({ type: "array", items })
export const mcpSchemas = {
  McpEnvironmentEntry: object({
    name: string("环境变量或请求头名称", { minLength: 1 }),
    value: string("字面值或 ${ENV_NAME}，不执行命令"),
  }),
  McpConfiguration: object({
    name: string("稳定服务名称；横线与下划线视为相同身份", {
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-zA-Z0-9_-]+$",
    }),
    transport: string("Pi 原生传输", { enum: ["stdio", "http"] }),
    command: string("单一可执行文件，不是 shell 命令"),
    args: array(string("单个参数")),
    cwd: string("可选工作目录，相对路径以会话目录为基准"),
    env: array(ref("McpEnvironmentEntry")),
    url: string("Streamable HTTP URL"),
    headers: array(ref("McpEnvironmentEntry")),
    description: string("服务用途"),
    enabled: { type: "boolean", description: "新会话及空闲会话下一次操作生效" },
    exposure: string("未另行选择时的 Pi 工具暴露方式", {
      enum: ["codemode", "deferred", "direct", "hidden"],
    }),
    timeout: {
      type: "integer",
      minimum: 1,
      description: "每个协议请求超时秒数，最大 120",
    },
  }),
  McpDiscoveredTool: object({
    name: string("服务器工具原名"),
    id: string("Pi 模型工具名"),
    description: string("实际工具说明"),
    inputSchema: string("真实 JSON 参数 schema"),
  }),
  McpTestResult: object({
    state: string("本次真实验证结果；验证结束即关闭测试连接", {
      enum: ["connected", "needs-auth", "failed"],
    }),
    error: string("脱敏后失败原因"),
    tools: array(ref("McpDiscoveredTool")),
    testedAt: string("验证时间 ISO 格式"),
  }),
  McpRuntimeState: object({
    state: string("当前正式会话连接状态，不来自测试缓存", {
      enum: ["connecting", "connected", "disconnected", "needs-auth", "failed"],
    }),
    connections: {
      type: "integer",
      minimum: 0,
      description: "当前正式会话已连接数",
    },
    error: string("当前连接的安全错误说明"),
  }),
  McpServer: object(
    {
      configuration: ref("McpConfiguration"),
      revision: { type: "integer", minimum: 1 },
      source: string("配置绝对路径，个人服务归 Moon agent/mcp.json"),
      test: ref("McpTestResult"),
      runtime: ref("McpRuntimeState"),
    },
    ["configuration", "revision", "source"]
  ),
}
const base = {
  module: "MCP 服务",
  condition: "使用 Moon 同一宿主；不读取其他应用的服务配置。",
  errors: "配置无效、文件损坏或权限不足。",
}
export const mcpOperations = {
  mcpList: {
    ...base,
    method: "mcp.list",
    args: ["$signal"],
    request: object({}),
    response: array(ref("McpServer")),
    title: "读取 MCP 服务",
    input: [],
    result: "McpServer[]",
    effect: "只读配置与当前宿主验证缓存；不启动服务器、不自动测试。",
    example: {},
  },
  mcpSave: {
    ...base,
    method: "mcp.save",
    args: ["configuration", "revision", "$signal"],
    request: object(
      {
        configuration: ref("McpConfiguration"),
        revision: { type: "integer", minimum: 1 },
      },
      ["configuration"]
    ),
    response: ref("McpServer"),
    title: "保存 MCP 服务",
    input: ["configuration"],
    result: "McpServer",
    condition:
      "新服务省略 revision；更新必须带当前版本。禁止规范化名称冲突；锁内复查，rename 前取消不写入，提交后取消不回滚。运行会话维持快照，下一次空闲发送或应用配置生效。",
    effect: "原子保存 Pi mcpServers 格式；不连接服务器、不调用模型。",
    example: {
      configuration: {
        name: "local",
        transport: "stdio",
        command: "node",
        args: ["H:/tools/mcp.mjs"],
        cwd: "",
        env: [],
        url: "",
        headers: [],
        description: "本地工具",
        enabled: true,
        exposure: "codemode",
        timeout: 60,
      },
    },
  },
  mcpRemove: {
    ...base,
    method: "mcp.remove",
    args: ["name", "revision", "$signal"],
    request: object({
      name: string("服务名", { minLength: 1 }),
      revision: { type: "integer", minimum: 1 },
    }),
    response: { type: "null" },
    title: "删除 MCP 服务",
    input: ["name", "revision"],
    result: "null",
    condition:
      "必须带当前 revision。提交前取消保留记录；已运行会话继续当前轮，下一次空闲操作断开删除的服务。",
    effect: "删除个人配置与验证缓存，不回滚已有 MCP 操作。",
    example: { name: "local", revision: 1 },
  },
  mcpTest: {
    ...base,
    method: "mcp.test",
    args: ["configuration", "cwd", "$signal"],
    request: object({
      configuration: ref("McpConfiguration"),
      cwd: string("真实会话目录，可空使用宿主目录"),
    }),
    response: ref("McpTestResult"),
    title: "测试 MCP 连接",
    input: ["configuration", "cwd"],
    result: "McpTestResult",
    condition:
      "真实 initialize 与 tools/list，不执行工具、不保存配置。可取消，取消或结束都等待关闭本次客户端/子进程。认证不足返回 needs-auth；具体服务错误脱敏。测试成功不是持续已连接或任务成功。",
    effect:
      "临时建立真实 MCP 连接，测试完成立即关闭；候选草稿不持久化。与已保存配置匹配时，仅更新验证目录元数据，不修改服务参数或版本。",
    example: {
      configuration: {
        name: "local",
        transport: "stdio",
        command: "node",
        args: ["H:/tools/mcp.mjs"],
        cwd: "",
        env: [],
        url: "",
        headers: [],
        description: "本地工具",
        enabled: true,
        exposure: "codemode",
        timeout: 60,
      },
      cwd: "",
    },
  },
}
