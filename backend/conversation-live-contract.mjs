import { conversationSchemas } from "./conversation-contract.mjs"
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
const id = str("稳定业务标识", {
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9_-]+$",
})
const { messages: _messages, ...metadata } =
  conversationSchemas.ConversationSnapshot.properties
export const liveSchemas = {
  ConversationMetadata: obj(
    metadata,
    conversationSchemas.ConversationSnapshot.required.filter(
      (name) => name !== "messages"
    )
  ),
  ConversationFrame: obj(
    {
      kind: str(
        "首次/失去版本基线返回snapshot；变化返回update；无变化返回heartbeat",
        { enum: ["snapshot", "update", "heartbeat"] }
      ),
      epoch: str("宿主身份"),
      version: num("变化版本"),
      baseVersion: num("增量所需的精确基线"),
      snapshot: ref("ConversationSnapshot"),
      metadata: ref("ConversationMetadata"),
      upserts: { type: "array", items: ref("ConversationChatMessage") },
      order: {
        type: "array",
        items: str("当前分支的稳定消息展示ID；按此顺序重建，不拼接重复delta"),
      },
    },
    ["kind", "epoch", "version"]
  ),
}
export const liveOperations = {
  conversationFollow: {
    module: "真实对话",
    method: "conversations.follow",
    args: ["sessionId", "epoch", "afterVersion", "$signal"],
    request: obj(
      {
        sessionId: id,
        epoch: str("客户端宿主身份"),
        afterVersion: num("已应用版本"),
      },
      ["sessionId"]
    ),
    response: ref("ConversationFrame"),
    result: "ConversationFrame",
    title: "事件驱动增量订阅",
    input: ["sessionId"],
    condition:
      "可取消的25秒长连接等待；不占用会话写锁，不因断开停止agent。读取和执行复用HTTP/Tauri RPC。",
    effect:
      "Pi事件唤醒并合并30ms内变化，只返回变化消息和会话元数据；32个基线之外或宿主变化返回完整快照。无变化返回心跳，客户端立即续订，无250ms整份历史轮询。",
    errors:
      "会话不存在、历史无法读取、宿主关闭、订阅取消；重连只读取，不重发消息。",
    example: { sessionId: "sample-session" },
  },
}
