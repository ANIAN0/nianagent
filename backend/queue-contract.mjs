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
export const queueReceiptOperationNames = ["conversationQueueRemove", "conversationQueueMode", "conversationQueueDeliver"]
const receiptFields = {
  sessionId: id,
  operationRequestId: id,
  operation: str("原队列操作名，不按当前队列外观推断", { enum: queueReceiptOperationNames }),
  baseRevision: { type: "integer", minimum: 0, description: "冻结请求的原队列CAS版本" },
  revision: { type: "integer", minimum: 0, description: "本次动作采用时原子提交的队列版本，不是当前最新版本" },
  itemId: id,
  mode: str("本次请求的交付模式", { enum: ["single", "all"] }),
  issue: ref("OperationIssue"),
}
export const queueOperationReceiptStorageSchema = obj({
  ...receiptFields,
  fingerprint: str("原操作和冻结目标/CAS的SHA256；不复制消息和材料", { pattern: "^[a-f0-9]{64}$" }),
  ownerEpoch: str("登记准备的会话服务宿主身份", { minLength: 1 }),
  status: str("准备、已采用或明确未提交", { enum: ["preparing", "committed", "rejected"] }),
  updatedAt: str("最近回执更新时间"),
}, ["sessionId", "operationRequestId", "operation", "baseRevision", "fingerprint", "ownerEpoch", "status", "updatedAt"])
export const queueSchemas = {
  ConversationQueueOperationReceipt: obj({
    ...receiptFields,
    state: str("committed证明原动作采用；不是Pi输入ACK或回答完成。missing/current preparing为unknown，cold preparing为rejected", { enum: ["committed", "rejected", "unknown"] }),
    retryOriginalAllowed: { type: "boolean", enum: [true], description: "仅宿主确认原ID无登记时为true，允许用户显式恢复冻结同ID/同内容/同CAS的原操作；不是新ID重发或自动补发" },
  }, ["sessionId", "operationRequestId", "state"]),
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
    editBaseRevision: { type: "integer", minimum: 0, description: "最后成功编辑的原队列版本，需与编辑请求身份一起匹配" },
    editRequestId: { ...id, description: "最后成功编辑的clientEditId；即使交付失败仍保留" },
  }, ["id", "clientRequestId", "text", "materials", "status", "delivery", "error", "createdAt"]),
  ConversationQueue: obj({
    revision: { type: "integer", minimum: 0, description: "队列乐观并发版本" },
    mode: str("会话级交付数量；下次边界生效", { enum: ["single", "all"] }),
    paused: {
      type: "boolean",
      description: "停止、终止失败、重启或材料失效后暂停",
    },
    items: { type: "array", items: ref("ConversationQueueItem") },
    retiredItems: {
      type: "array",
      description: "已交付/已删除原项的最小终态回执，用于核对未知编辑；不返回文字、材料或媒体正文。",
      items: obj({
        id, clientRequestId: id,
        status: str("不可再修改的原项终态", { enum: ["delivered", "removed"] }),
        editBaseRevision: { type: "integer", minimum: 0, description: "最后成功编辑请求的原队列版本；需同时匹配editRequestId证明本次编辑已提交" },
        editRequestId: { ...id, description: "最后成功编辑请求的clientEditId；与冻结提交身份核对，不返回编辑正文" },
      }, ["id", "clientRequestId", "status"]),
    },
    acceptedRequestIds: {
      type: "array",
      items: id,
      description: "已持久接受的提交回执，用于原请求核对，已交付/已删除仍保留",
    },
  }, ["revision", "mode", "paused", "items", "acceptedRequestIds"]),
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
    args: ["sessionId", "itemId", "text", "revision", "materials", "$signal", "clientEditId"],
    request: obj({
      sessionId: id,
      itemId: id,
      text: str("修改后的原始文字", { maxLength: 100000 }),
      revision: { type: "integer", minimum: 0 },
      materials: { ...materials, description: "可选完整材料选择；省略保留旧材料，空数组解除全部引用。提交前重新核对，不删除源文件。" },
      clientEditId: { ...id, description: "可选冻结编辑身份；界面在RPC前持久保存，未知时只核对，不重发" },
    }, ["sessionId", "itemId", "text", "revision"]),
    title: "编辑待处理消息",
    input: ["sessionId", "itemId", "text", "revision", "materials?", "clientEditId?"],
    effect:
      "同会话锁/CAS内重核对所选材料后，原子修改尚未交付条目的文字与材料，保留消息身份和顺序。失败或提交前取消不修改。成功原子保存editBaseRevision与editRequestId，交付失败或退休仍可按本次身份核对；结果未知不按新revision盲目重存。",
    example: {
      sessionId: "sample-session",
      itemId: "sample-item",
      text: "补充验收要求",
      revision: 1,
    },
  },
  conversationQueueRemove: {
    ...common,
    queueReceipt: true,
    method: "conversations.queueRemove",
    args: ["sessionId", "itemId", "revision", "$signal", "operationRequestId"],
    request: obj({
      sessionId: id,
      itemId: id,
      revision: { type: "integer", minimum: 0 },
      operationRequestId: id,
    }, ["sessionId", "itemId", "revision"]),
    title: "删除待处理消息",
    input: ["sessionId", "itemId", "revision"],
    effect: "只删除待处理条目；原operationRequestId回执与删除同次rename提交。相同原ID重放不再次删除；结果未知只核对原回执。missing可显式同ID/同内容/同CAS恢复，不按目录外观猜测；不删除原附件、文件或已存历史。",
    example: {
      sessionId: "sample-session",
      itemId: "sample-item",
      revision: 1,
    },
  },
  conversationQueueMode: {
    ...common,
    queueReceipt: true,
    method: "conversations.queueMode",
    args: ["sessionId", "mode", "revision", "$signal", "operationRequestId"],
    request: obj({
      sessionId: id,
      mode: str("交付模式", { enum: ["single", "all"] }),
      revision: { type: "integer", minimum: 0 },
      operationRequestId: id,
    }, ["sessionId", "mode", "revision"]),
    title: "保存消息交付模式",
    input: ["sessionId", "mode", "revision"],
    effect:
      "保存此会话的下一批交付模式与原operationRequestId回执；相同原ID不再次覆盖后来模式。missing可显式冻结同ID恢复；同ID不同内容拒绝。不改其他会话、当前已经开始交付的批次或草稿。",
    example: { sessionId: "sample-session", mode: "single", revision: 1 },
  },
  conversationQueueDeliver: {
    ...common,
    queueReceipt: true,
    method: "conversations.queueDeliver",
    args: ["sessionId", "itemId", "revision", "$signal", "operationRequestId"],
    request: obj({
      sessionId: id,
      itemId: id,
      revision: { type: "integer", minimum: 0 },
      operationRequestId: id,
    }, ["sessionId", "itemId", "revision"]),
    title: "立即交付待处理消息",
    input: ["sessionId", "itemId", "revision"],
    errors:
      "空闲恢复交付时，队列文件或会话索引提交失败在快照error区分存储来源，并仅显示白名单code/syscall，不返回路径或原始诊断；未进入Pi用户历史的条目继续保留并暂停。",
    effect:
      "committed仅证明paused=false/该项steer+pending的交付动作与原回执同次rename采用，不是Pi输入ACK或模型回答结束。运行中在安全边界交付；空闲首次采用才启动既有resume。查询及同ID重放绝不resume；missing只允许用户显式冻结同ID/同内容/同CAS恢复一次，不创建新请求身份。",
    example: {
      sessionId: "sample-session",
      itemId: "sample-item",
      revision: 1,
    },
  },
  conversationQueueReceiptRead: {
    module: "运行中消息", method: "conversations.queueReceiptRead", args: ["sessionId", "operationRequestId", "$signal"],
    request: obj({ sessionId: id, operationRequestId: id }), response: ref("ConversationQueueOperationReceipt"), result: "ConversationQueueOperationReceipt",
    title: "核对原队列操作", input: ["sessionId", "operationRequestId"],
    condition: "只读会话队列原JSON，不restore/Pi/reconcile/交付；旧无回执数据可读。missing返回unknown且retryOriginalAllowed=true，只允许用户显式使用冻结同ID/同输入/同CAS恢复原操作；存在preparing不允许恢复，冷宿主preparing证明未提交。相同ID不同输入拒绝，绝不根据模式/条目相等推断成功。",
    errors: "标识无效、队列或回执结构损坏、读取权限不足；原文件不覆盖。", effect: "仅核对原请求身份与动作采用结论，不写文件，不启动会话或模型，不交付消息。",
    example: { sessionId: "sample-session", operationRequestId: "original-queue-operation" },
  },
}
