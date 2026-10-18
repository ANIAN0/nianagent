const s = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const o = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const r = ($ref) => ({ $ref })
const a = (items) => ({ type: "array", items, maxItems: 128 })
const id = s("受信清单声明的稳定标识", {
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9_-]+$",
})
const json = s(
  "按所属插件原生操作schema验证的JSON对象；编码后最多16MiB，文件源字节限制独立",
  { maxLength: 16777216 }
)
export const pluginSchemas = {
  PluginContribution: o({
    id,
    kind: s("网页贡献类型", { enum: ["page", "session-tab", "delivery"] }),
    title: s("贡献名称"),
    version: { type: "integer", minimum: 1 },
    remote: { type: "boolean" },
  }),
  PluginDescriptor: o(
    {
      id,
      name: s("名称"),
      description: s("用途"),
      version: s("代码版本"),
      source: s("真实来源路径或包来源"),
      sourceKind: s("来源类型", {
        enum: ["bundled", "local", "npm", "git", "legacy"],
      }),
      installed: { type: "boolean" },
      enabled: { type: "boolean" },
      revision: { type: "integer", minimum: 0 },
      generation: { type: "integer", minimum: 0 },
      state: s("应用激活状态", {
        enum: ["disabled", "loading", "active", "stopping", "failed"],
      }),
      businessState: s("插件业务连接状态"),
      error: s("受控失败及恢复原因"),
      configuration: json,
      configurationSchema: json,
      contributions: a(r("PluginContribution")),
      tools: a(r("SessionTool")),
      webEntry: s("预构建单文件ES模块，相对插件包根目录"),
      webApiVersion: { type: "integer", enum: [1] },
      effects: a(s("作者声明的文件、网络、浏览器或进程影响")),
      registrations: o({
        events: a(s("实际注册的Pi事件")),
        commands: a(s("实际注册的Pi命令")),
        providers: a(s("实际注册的模型提供方")),
      }),
    },
    [
      "id",
      "name",
      "description",
      "version",
      "source",
      "sourceKind",
      "installed",
      "enabled",
      "revision",
      "generation",
      "state",
      "businessState",
      "error",
      "configuration",
      "configurationSchema",
      "contributions",
      "tools",
    ]
  ),
  PluginResource: o({
    data: s("资源base64编码", { maxLength: 12000000 }),
    mime: s("资源MIME"),
  }),
  PluginResponse: o({
    payload: json,
    generation: { type: "integer", minimum: 0 },
  }),
}
const common = {
  module: "插件宿主",
  errors:
    "未启用、加载失败、代次失效、schema不符、执行尚未空闲或释放失败；可选错误不阻断独立聊天。",
  condition: "认证客户端由宿主传输建立；管理仅本机可用，执行和审批空闲才生效。",
  effect:
    "原生Pi注册工具/命令/事件；可选应用入口注册操作，核心不解释业务载荷。",
}
const op = (
  method,
  args,
  request,
  response,
  title,
  example,
  recovery = "reload"
) => ({
  ...common,
  method,
  args,
  request,
  response,
  title,
  input: Object.keys(request.properties),
  result: response.$ref || "PluginDescriptor[]",
  example,
  transportRecovery: recovery,
})
export const pluginOperations = {
  pluginResource: op(
    "plugins.resource",
    ["id", "path", "generation", "$signal"],
    o({
      id,
      path: s("插件包内相对资源路径", { maxLength: 4096 }),
      generation: { type: "integer", minimum: 0 },
    }),
    r("PluginResource"),
    "读取已启用插件的前端资源",
    { id: "plugin-id", path: "dist/moon.js", generation: 1 }
  ),
  pluginList: op(
    "plugins.list",
    ["$signal"],
    o({}),
    a(r("PluginDescriptor")),
    "读取插件及应用状态",
    {}
  ),
  pluginConfigure: op(
    "plugins.configure",
    ["id", "revision", "enabled", "configuration", "$signal"],
    o({
      id,
      revision: { type: "integer", minimum: 0 },
      enabled: { type: "boolean" },
      configuration: json,
    }),
    r("PluginDescriptor"),
    "配置或启停应用插件",
    { id: "plugin-id", revision: 0, enabled: false, configuration: "{}" },
    "check"
  ),
  pluginCall: op(
    "plugins.call",
    ["id", "operation", "payload", "sessionId", "generation", "$signal"],
    o(
      {
        id,
        operation: id,
        payload: json,
        sessionId: id,
        generation: { type: "integer", minimum: 0 },
      },
      ["id", "operation", "payload"]
    ),
    r("PluginResponse"),
    "调用注册的插件操作",
    { id: "plugin-id", operation: "state", payload: "{}" },
    "none"
  ),
  pluginImport: op(
    "plugins.add",
    ["source", "$signal"],
    o({
      source: s("本地绝对路径、npm:包名或Git来源", {
        minLength: 1,
        maxLength: 4096,
      }),
    }),
    r("PluginDescriptor"),
    "显式导入Pi扩展来源",
    { source: "H:/extensions/example.mjs" },
    "check"
  ),
  pluginPackage: op(
    "plugins.packageAction",
    ["id", "action", "$signal"],
    o({
      id,
      action: s("显式包管理操作", { enum: ["install", "update", "remove"] }),
    }),
    a(r("PluginDescriptor")),
    "安装、更新或移除已导入Pi来源",
    { id: "plugin-id", action: "install" },
    "check"
  ),
}
