// Shared input/output registration; no WebSocket, plugin activation or service access.
const object = (properties = {}, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const bool = (description) => ({ type: "boolean", description })
const num = (description, extra = {}) => ({
  type: "integer",
  description,
  ...extra,
})
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] })
const text = { type: "string", maxLength: 4096 },
  token = { type: "string", pattern: "^[a-f0-9-]{36}$" }
const output = object({ value: { type: "object", additionalProperties: true } })
const connection = object({
  online: bool("与 evework 控制通道在线"),
  issue: str("当前连接说明"),
  clients: num("已完成握手的客户端数量"),
  url: str("在线时的 Moon 连接链接；离线为空，包含访问能力"),
})
const definition = (
  title,
  input,
  result,
  effect,
  example = {},
  remote = true
) => ({
  title,
  input,
  output,
  documentationOutput: object({ value: result }),
  module: "远程访问",
  remote,
  effect,
  example,
  condition:
    "远程访问插件已启用。上传按当前客户端及 profile 归属核对；connection/reset/接收占位管理只允许本机。",
  errors:
    "实际连接、目录、归属或上传状态失败会明确返回；结果不确定时通过原 token 查询状态，不创建重复上传。",
})
export const remoteModule = {
  source:
    "backend/plugins/remote-access/host.mjs → uploads.mjs / directories.mjs",
  storage:
    "插件身份 connection.json；材料目录中的 uploads 接收记录；网页草稿、原请求及上传记录按认证主机和数据集隔离；在线通道在内存中",
  responsibility:
    "连接 evework 网页入口，并向已认证客户端提供目录选择和分块文件接收。",
}
export const remoteOperations = {
  connection: definition(
    "读取远程连接",
    object(),
    connection,
    "只读控制通道、客户端数和连接链接。",
    {},
    false
  ),
  directories: definition(
    "浏览主机目录",
    object({ path: { type: "string", maxLength: 4096 } }),
    object({
      path: str("解析后的绝对目录；根列表为空"),
      parent: str("父目录；根列表为空"),
      entries: {
        type: "array",
        items: object({ name: str("目录名称"), path: str("目录绝对路径") }),
      },
      truncated: bool("最多1000项，是否截断"),
    }),
    "只读实际一层目录；空 path 列出可访问磁盘根。",
    { path: "" }
  ),
  reset: definition(
    "重置远程连接身份",
    object(),
    connection,
    "保存新身份、断开原客户端并重新连接，原连接链接失效。",
    {},
    false
  ),
  uploadReservations: definition(
    "读取未完成接收占位",
    object(),
    object({
      items: {
        type: "array",
        items: object({
          token: str("原接收记录标识"),
          version: str("本次列表观察身份，用于主动取消占位"),
          name: str("文件名或归属损坏说明"),
          bytes: nullable(num("声明的文件字节数")),
          offset: nullable(num("已接收字节位置")),
          uncertain: bool("记录损坏或已有准备/采用状态需核对"),
        }),
      },
      more: bool("超过最多100条"),
    }),
    "读取未完成接收及观察身份，不删除副本。",
    {},
    false
  ),
  uploadIsolate: definition(
    "取消原接收占位",
    object({ token, version: token }),
    object({
      isolated: bool("占位已取消"),
      retained: bool("原文件副本和归属记录保留"),
    }),
    "核对本次列表身份后保存隔离标记，只释放接收配额，保留原副本。",
    { token: "token-uuid", version: "version-uuid" },
    false
  ),
  uploadStart: definition(
    "开始文件接收",
    object({
      sessionId: text,
      cwd: text,
      name: text,
      mimeType: text,
      bytes: { type: "integer", minimum: 0, maximum: 8 * 1024 * 1024 },
    }),
    object({
      token: str("接收稳定标识"),
      offset: num("当前字节位置，初始为0"),
    }),
    "创建当前客户端拥有的文件接收记录及空文件；单文件最多8MiB，全局16/当前端2个接收占位。",
    {
      sessionId: "session-id",
      cwd: "H:/workspace",
      name: "notes.txt",
      mimeType: "text/plain",
      bytes: 100,
    }
  ),
  uploadChunk: definition(
    "接收字节窗口",
    object({
      token,
      offset: { type: "integer", minimum: 0, maximum: 8 * 1024 * 1024 },
      data: { type: "string", maxLength: Math.ceil((2 * 1024 * 1024) / 3) * 4 },
    }),
    object({ offset: num("提交后的下一字节位置") }),
    "按原 offset 写入最多2MiB字节窗口并保存接收位置；不能重放已提交窗口。",
    { token: "token-uuid", offset: 0, data: "SGVsbG8=" }
  ),
  uploadFinish: definition(
    "完成接收并准备材料",
    object({ token }),
    object({ material: { $ref: "MaterialReference" } }),
    "完整接收后准备原材料缓存记录，返回同一材料；不发送消息。",
    { token: "token-uuid" }
  ),
  uploadStatus: definition(
    "核对原接收状态",
    object({ token }),
    object({
      offset: num("已持久化的接收位置"),
      phase: str("receiving / prepared / discarded 等实际接收阶段"),
      material: nullable({ $ref: "MaterialReference" }),
    }),
    "只读原接收记录；prepared 时返回材料，其他阶段为空。",
    { token: "token-uuid" }
  ),
  uploadDiscard: definition(
    "丢弃尚未采用的接收",
    object({ token }),
    object({
      removed: bool("未采用的副本已移除"),
      retained: bool("已采用或结果未确认，副本仍保留"),
    }),
    "核对采用回执，只清理当前接收的未采用文件及材料缓存，保留归属记录。",
    { token: "token-uuid" }
  ),
}
