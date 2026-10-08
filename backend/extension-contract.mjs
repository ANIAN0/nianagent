import { writeRequestId } from "./write-receipt-contract.mjs"
const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const ref = ($ref) => ({ $ref })
const arr = (items) => ({ type: "array", items })
export const extensionSchemas = {
  ExtensionPresentation: obj({
    kind: str(
      "声明中的稳定结果种类；按kind/version选择展示，不按工具或插件名称分支"
    ),
    version: {
      type: "integer",
      minimum: 1,
      description: "结果协议版本；不支持的版本仍呈现原始文本",
    },
    payload: str(
      "经过声明结果schema核对的JSON对象字符串，最多64KiB；不含宿主对象或函数",
      { maxLength: 65536 }
    ),
  }),
  ExtensionResultKind: obj({
    kind: str("稳定展示种类"),
    version: { type: "integer", minimum: 1 },
    schema: str("权威结果JSON Schema，来自模块声明"),
  }),
  ExtensionDescriptor: obj(
    {
      id: str("稳定模块身份，与名称/安装目录显示文字无关"),
      name: str("模块名称"),
      description: str("能力及适用场景"),
      apiVersion: {
        type: "integer",
        enum: [1],
        description: "Moon公开扩展契约版本",
      },
      version: str("模块代码版本"),
      revision: {
        type: "integer",
        minimum: 0,
        description: "配置CAS版本；未保存时为0",
      },
      enabled: {
        type: "boolean",
        description: "下一次空闲加载启停，当前已接受运行保持快照",
      },
      configuration: str("已保存JSON配置；默认配置同样经过声明schema核对"),
      configurationSchema: str(
        "模块权威JSON Schema，title/description/default用于设置字段展示"
      ),
      tools: arr(ref("SessionTool")),
      resultKinds: arr(ref("ExtensionResultKind")),
      state: str("声明能否加载；不会把测试成功当持续连接", {
        enum: ["ready", "failed"],
      }),
      issue: ref("OperationIssue"),
      activeSessions: {
        type: "integer",
        minimum: 0,
        description:
          "持有此模块工具快照的正式会话数，资源按首次执行创建；不含只读目录",
      },
    },
    [
      "id",
      "name",
      "description",
      "apiVersion",
      "version",
      "revision",
      "enabled",
      "configuration",
      "configurationSchema",
      "tools",
      "resultKinds",
      "state",
      "activeSessions",
    ]
  ),
}
export const extensionOperations = {
  extensionList: {
    module: "本地扩展",
    method: "extensions.list",
    args: ["$signal"],
    request: obj({}),
    response: arr(ref("ExtensionDescriptor")),
    title: "读取扩展能力和配置",
    input: [],
    result: "ExtensionDescriptor[]",
    condition:
      "只发现宿主固定正式目录内的受信模块；不加载工作区脚本、不启动工具资源、不发模型请求。损坏模块单独显示failed，其他能力保持可用。",
    errors: "配置文件损坏或权限不足。",
    effect: "只读模块声明与保存配置；不执行工具、不更改会话。",
    example: {},
  },
  extensionConfigure: {
    module: "本地扩展",
    method: "extensions.configure",
    args: [
      "id",
      "revision",
      "enabled",
      "configuration",
      "$signal",
      "operationRequestId",
    ],
    request: obj(
      {
        id: str("已发现模块稳定ID", { minLength: 1, maxLength: 64 }),
        revision: { type: "integer", minimum: 0 },
        enabled: { type: "boolean" },
        configuration: str("JSON对象，按模块configurationSchema验证", {
          maxLength: 65536,
        }),
        operationRequestId: writeRequestId,
      },
      ["id", "revision", "enabled", "configuration"]
    ),
    response: ref("ExtensionDescriptor"),
    title: "保存扩展配置及启停",
    input: ["id", "revision", "enabled", "configuration"],
    result: "ExtensionDescriptor",
    condition:
      "revision锁内CAS；配置由模块声明schema核对。提交前取消不写入，提交后不回滚。运行中使用原快照；下一次空闲发送重载资源，停用工具保留原选择并要求取消失效项。结果未知只查询writeReceiptRead原身份，不重复执行。",
    errors: "模块失效、配置类型或约束不满足、版本冲突、存储失败。",
    effect: "原子保存独立应用配置和写入回执；不改Pi历史、队列或发送控制。",
    example: {
      id: "example-note",
      revision: 0,
      enabled: true,
      configuration: '{"prefix":"记录"}',
      operationRequestId: "extension-original-operation",
    },
  },
}
