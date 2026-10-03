const text = (description, extra = {}) => ({
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
const ref = (name) => ({ $ref: name })
const id = text("稳定操作或会话标识", { pattern: "^[a-zA-Z0-9_-]{1,128}$" })
export const controlSchemas = {
  ConversationControlOperation: obj(
    {
      id,
      kind: text("操作类型", { enum: ["compact", "fork"] }),
      sessionId: id,
      status: text("实际操作结果；unknown必须查询原标识", {
        enum: [
          "running",
          "cancelling",
          "completed",
          "cancelled",
          "failed",
          "unknown",
        ],
      }),
      createdAt: text("接受时间"),
      updatedAt: text("更新时点"),
      error: text("安全错误原因"),
      focus: text("压缩时希望保留的重点"),
      anchorId: text("Pi权威历史边界"),
      compactionEntryId: text("实际保存的Pi压缩条目标识"),
      targetSessionId: id,
    },
    ["id", "kind", "sessionId", "status", "createdAt", "updatedAt", "error"]
  ),
  ConversationControl: obj(
    {
      busy: { type: "boolean" },
      compactDisabledReason: text("不能开始压缩的具体原因；可用时为空"),
      forkDisabledReason: text("不能创建会话分支的具体原因；可用时为空"),
      operation: ref("ConversationControlOperation"),
    },
    ["busy", "compactDisabledReason", "forkDisabledReason"]
  ),
  ConversationCompaction: obj({
    id: text("Pi压缩entryId"),
    time: text("Pi实际保存时间"),
    summary: text("真实只读摘要"),
    firstKeptEntryId: text("保留历史起点的Pi entryId"),
    tokensBefore: {
      type: "number",
      minimum: 0,
      description: "Pi保存的压缩前估算用量",
    },
    source: text(
      "实际压缩来源；派生保留原摘要来源，不因新会话没有来源操作回执改标自动",
      { enum: ["manual", "automatic"] }
    ),
    historyIndex: {
      type: "integer",
      minimum: 0,
      description: "当前Pi分支中的排列位置",
    },
    firstKeptHistoryIndex: {
      type: "integer",
      minimum: -1,
      description: "保留起点在当前分支的位置；-1表示原记录不存在",
    },
  }),
}
const common = {
  module: "上下文压缩",
  response: ref("ConversationControlOperation"),
  result: "ConversationControlOperation",
  errors:
    "会话不存在、执行中、待答、队列未处理、操作未确认、模型不可用、历史不足、操作标识冲突或存储失败。",
}
export const controlOperations = {
  conversationFork: {
    module: "会话派生",
    method: "conversations.controls.forkStart",
    args: ["sessionId", "operationId", "entryId", "$signal"],
    title: "从已完成回复创建独立会话",
    input: ["sessionId", "operationId", "entryId"],
    request: obj({
      sessionId: id,
      operationId: id,
      entryId: text("精确Pi assistant entryId", {
        minLength: 1,
        maxLength: 128,
      }),
    }),
    response: ref("ConversationControlOperation"),
    result: "ConversationControlOperation",
    condition:
      "来源空闲、无待答/待发送/未决操作，目标是当前Pi路径中已完成且没有未匹配工具调用的Agent回复；旧格式只读历史须先显式发送，由Pi完成持久迁移后才可派生，避免使用临时标识或改写来源。相同标识与边界幂等。接受前可取消，接受后查询原操作，不重复创建。",
    effect:
      "Pi官方createBranchedSession复制根到选定回复的真实前缀，保留已继承摘要的手动或自动来源。新会话拥有独立标识、配置和运行时；保留来源，不复制草稿、队列或未决操作，不回滚磁盘。",
    errors:
      "来源忙、边界无效、模型或工具失效、配置/历史损坏、请求标识冲突、存储失败或结果待确认。",
    example: {
      sessionId: "sample-session",
      operationId: "sample-fork",
      entryId: "pi-assistant-entry",
    },
  },
  conversationCompact: {
    ...common,
    method: "conversations.controls.compactStart",
    args: ["sessionId", "operationId", "focus", "$signal"],
    title: "手动压缩当前上下文",
    input: ["sessionId", "operationId", "focus"],
    request: obj({
      sessionId: id,
      operationId: id,
      focus: text("可空保留重点", { maxLength: 10000 }),
    }),
    condition:
      "锁内检查空闲且没有待答、待发送队列或未决操作；同标识同重点幂等，不再次调用模型。接受前取消不开始；接受后使用专属取消接口。",
    effect:
      "Pi compact生成并追加真实摘要，可能产生模型费用；后台运行，通过读取原操作对账。完整历史保留，不发送普通消息、不回滚文件。",
    example: {
      sessionId: "sample-session",
      operationId: "sample-compact",
      focus: "保留当前任务目标和已完成的工作",
    },
  },
  conversationControlRead: {
    ...common,
    method: "conversations.controls.read",
    args: ["sessionId", "operationId", "$signal"],
    title: "检查会话操作状态",
    input: ["sessionId", "operationId"],
    request: obj({ sessionId: id, operationId: id }),
    response: {
      anyOf: [ref("ConversationControlOperation"), { type: "null" }],
    },
    result: "ConversationControlOperation | null",
    condition:
      "查询原操作；终态回执不受后续操作影响。未决操作阻止新的发送与压缩，依据隔离期间的实际Pi提交边界恢复结果，不重新执行模型、不重新创建历史。派生对账可补齐已创建Pi路径对应的配置和目录索引。",
    effect:
      "返回原操作结果及权威摘要标识，重启恢复不重发；取消或失败的旧操作不认领后续摘要。",
    example: { sessionId: "sample-session", operationId: "sample-compact" },
  },
  conversationCompactCancel: {
    ...common,
    method: "conversations.controls.compactCancel",
    args: ["sessionId", "operationId", "$signal"],
    title: "取消本次手动压缩",
    input: ["sessionId", "operationId"],
    request: obj({ sessionId: id, operationId: id }),
    condition: "仅针对匹配的手动压缩；重复幂等，不能停止其他运行。",
    effect:
      "Pi abortCompaction取消摘要提交前的操作；摘要已保存则仍返回completed，不假称撤销。",
    example: { sessionId: "sample-session", operationId: "sample-compact" },
  },
}
