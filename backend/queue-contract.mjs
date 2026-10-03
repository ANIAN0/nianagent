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
const id = str("稳定会话、消息或提交标识", {
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9_-]+$",
})
const materials = {
  type: "array",
  items: ref("MaterialReference"),
  maxItems: 100,
}
export const queueSchemas = {
  ConversationQueueItem: obj({
    id,
    clientRequestId: id,
    text: str("本次原始文字", { maxLength: 100000 }),
    materials,
    status: str("未进入历史的交付状态", {
      enum: ["pending", "dispatching", "failed"],
    }),
    delivery: str("下一处交付边界", { enum: ["followUp", "steer"] }),
    error: str("失败原因，保留原项"),
    createdAt: str("提交时间"),
  }),
  ConversationQueue: obj({
    revision: { type: "integer", minimum: 0, description: "队列乐观并发版本" },
    mode: str("会话级交付数量；下次边界生效", { enum: ["single", "all"] }),
    paused: {
      type: "boolean",
      description: "停止、终止失败、重启或材料失效后暂停",
    },
    items: { type: "array", items: ref("ConversationQueueItem") },
    acceptedRequestIds: {
      type: "array",
      items: id,
      description: "已持久接受的提交回执，用于原请求核对，已交付/已删除仍保留",
    },
  }),
}
const common = {
  module: "运行中消息",
  response: ref("ConversationSnapshot"),
  result: "ConversationSnapshot",
  errors:
    "会话不存在、会话控制操作未完成、队列版本冲突、消息已进入交付、材料未就绪或失效、保存失败。",
  condition:
    "同会话串行处理；已进入交付的消息不能编辑或删除。停止不回滚已经执行的工具。",
}
export const queueOperations = {
  conversationQueueEdit: {
    ...common,
    method: "conversations.queueEdit",
    args: ["sessionId", "itemId", "text", "revision", "$signal"],
    request: obj({
      sessionId: id,
      itemId: id,
      text: str("修改后的原始文字，材料保留", { maxLength: 100000 }),
      revision: { type: "integer", minimum: 0 },
    }),
    title: "编辑待处理消息",
    input: ["sessionId", "itemId", "text", "revision"],
    effect:
      "原子修改尚未交付条目，保留材料、消息身份和顺序。取消提交前不修改。",
    example: {
      sessionId: "sample-session",
      itemId: "sample-item",
      text: "补充验收要求",
      revision: 1,
    },
  },
  conversationQueueRemove: {
    ...common,
    method: "conversations.queueRemove",
    args: ["sessionId", "itemId", "revision", "$signal"],
    request: obj({
      sessionId: id,
      itemId: id,
      revision: { type: "integer", minimum: 0 },
    }),
    title: "删除待处理消息",
    input: ["sessionId", "itemId", "revision"],
    effect: "只删除待处理条目；提交回执仍保留，不删除原附件、文件或已存历史。",
    example: {
      sessionId: "sample-session",
      itemId: "sample-item",
      revision: 1,
    },
  },
  conversationQueueMode: {
    ...common,
    method: "conversations.queueMode",
    args: ["sessionId", "mode", "revision", "$signal"],
    request: obj({
      sessionId: id,
      mode: str("交付模式", { enum: ["single", "all"] }),
      revision: { type: "integer", minimum: 0 },
    }),
    title: "保存消息交付模式",
    input: ["sessionId", "mode", "revision"],
    effect:
      "保存此会话的下一批交付模式；不改其他会话、当前已经开始交付的批次或草稿。",
    example: { sessionId: "sample-session", mode: "single", revision: 1 },
  },
  conversationQueueDeliver: {
    ...common,
    method: "conversations.queueDeliver",
    args: ["sessionId", "itemId", "revision", "$signal"],
    request: obj({
      sessionId: id,
      itemId: id,
      revision: { type: "integer", minimum: 0 },
    }),
    title: "立即交付待处理消息",
    input: ["sessionId", "itemId", "revision"],
    effect:
      "运行中转为 steer，在工具结束的安全边界交付；空闲时恢复该项和后续队列，逐项再校验材料。结果未知读取原提交，不能重复发起。",
    example: {
      sessionId: "sample-session",
      itemId: "sample-item",
      revision: 1,
    },
  },
}
