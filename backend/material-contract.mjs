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
const a = (items) => ({ type: "array", items, maxItems: 100 })
const identity = s("会话稳定标识", {
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9_-]+$",
})
const cwd = s("当前会话真实工作目录", { minLength: 1, maxLength: 4096 })
export const materialSchemas = {
  MaterialReference: o(
    {
      id: s("服务准备后返回的稳定材料标识", { minLength: 1, maxLength: 200 }),
      name: s("材料原始名称", { minLength: 1, maxLength: 500 }),
      kind: s("材料类别", { enum: ["附件", "Skill"] }),
      type: s("实际交付方式", { enum: ["file", "image", "skill"] }),
      status: s("准备状态；非 ready 不可交付", {
        enum: ["preparing", "ready", "failed"],
      }),
      source: s("实际绝对路径或图片来源说明", { maxLength: 4096 }),
      description: s("用途或来源摘要"),
      mimeType: s("图片实际 MIME 类型"),
      bytes: { type: "integer", minimum: 0, description: "准备的图片字节数" },
      error: s("材料失败的具体安全原因"),
      retryable: {
        type: "boolean",
        description:
          "失败条目的权威恢复标记；false需重新选择或移除，true允许人工重试准备/核对。旧草稿可缺省，恢复时由服务重新判定。",
      },
      thumbnail: s("固定图片缩略图；仅界面本地使用，不是请求必需字段"),
    },
    ["id", "name", "kind", "type", "status", "source"]
  ),
  MaterialCatalog: o({
    cwd,
    files: a(r("MaterialReference")),
    skills: a(r("MaterialReference")),
    diagnostics: a(s("Pi 资源诊断或目录限制说明")),
  }),
  MaterialPreview: o({
    id: s("材料标识"),
    name: s("材料名称"),
    label: s("当前文件、本次 Skill 内容或待发送/发送时的固定图片"),
    source: s("实际来源"),
    content: s("文本预览；不执行 HTML 或脚本"),
    mimeType: s("图片 MIME"),
    data: s("保存图片的 base64 内容"),
    truncated: {
      type: "boolean",
      description: "文本只读取前128KiB，明确非全文",
    },
  }),
}
const common = {
  module: "消息材料",
  errors:
    "工作目录失效、材料不存在、读取权限不足、格式或大小不支持、Skill来源失效；取消提交前不保存。",
  condition:
    "当前本地用户操作；图片保存固定内容，普通文件保存路径；材料引用不自动授予工具。",
}
export const materialOperations = {
  materialChoose: {
    ...common,
    method: "materials.choose",
    args: ["sessionId", "cwd", "$signal"],
    request: o({ sessionId: identity, cwd }),
    response: a(r("MaterialReference")),
    title: "从系统选择本地附件",
    input: ["sessionId", "cwd"],
    result: "MaterialReference[]",
    effect:
      "打开原生多选文件窗口；取消返回空数组；逐项准备，不删除或改写源文件。",
    example: { sessionId: "sample-session", cwd: "H:/workspace/moon" },
  },
  materialPrepare: {
    ...common,
    method: "materials.prepare",
    args: ["sessionId", "cwd", "paths", "scope", "$signal"],
    request: o({
      sessionId: identity,
      cwd,
      paths: a(s("明确选择的文件绝对路径", { maxLength: 4096 })),
      scope: s("selected用于用户明确系统选择绝对路径；workspace用于Agent正文链接/本地图像/成果，可使用相对cwd路径，必须realpath位于cwd内", { enum: ["selected", "workspace"] }),
    }, ["sessionId", "cwd", "paths"]),
    response: a(r("MaterialReference")),
    title: "准备附件或资源路径",
    input: ["sessionId", "cwd", "paths"],
    result: "MaterialReference[]",
    effect:
      "图片最多8MiB，验证实际解码并按Pi官方尺寸与传输预算准备，历史保存原图；普通文件只保存真实路径；Skill通过Pi目录识别。默认selected保留用户明确选择工作区外文件的能力；Agent正文或成果打开必须使用workspace，拒绝realpath越界及符号链接绕过。单项失败返回failed条目及权威retryable，内容/格式无效不可重复准备同一来源。",
    example: {
      sessionId: "sample-session",
      cwd: "H:/workspace/moon",
      paths: ["H:/workspace/moon/README.md"],
    },
  },
  materialUpload: {
    ...common,
    method: "materials.upload",
    args: ["sessionId", "cwd", "name", "mimeType", "data", "$signal"],
    request: o({
      sessionId: identity,
      cwd,
      name: s("粘贴或拖入的图片名", { maxLength: 500 }),
      mimeType: s("image/png、jpeg、webp、gif"),
      data: s("图片base64；解码后最多8MiB", { maxLength: 12 * 1024 * 1024 }),
    }),
    response: r("MaterialReference"),
    title: "准备粘贴或拖入的图片",
    input: ["sessionId", "cwd", "name", "mimeType", "data"],
    result: "MaterialReference",
    effect:
      "图片固定保存至Moon材料目录；正常消息传材料ID而非重复传输大图；提交前取消不会安装记录。无效类型、内容、尺寸或无法解码返回material_invalid/recovery=none，需重新选择；暂时存储失败可重试原文件。",
    example: {
      sessionId: "sample-session",
      cwd: "H:/workspace/moon",
      name: "粘贴图片.png",
      mimeType: "image/png",
      data: "",
    },
  },
  materialCatalog: {
    ...common,
    method: "materials.catalog",
    args: ["sessionId", "cwd", "query", "$signal"],
    request: o({
      sessionId: identity,
      cwd,
      query: s("文件相对路径或Skill名称搜索", { maxLength: 500 }),
    }),
    response: r("MaterialCatalog"),
    title: "发现工作区文件与Skills",
    input: ["sessionId", "cwd", "query"],
    result: "MaterialCatalog",
    effect:
      "文件仅列当前工作目录内实际可读来源，不沿符号链接越界；Skills由Pi ResourceLoader发现，不执行工具。",
    example: {
      sessionId: "sample-session",
      cwd: "H:/workspace/moon",
      query: "readme",
    },
  },
  materialPreview: {
    ...common,
    method: "materials.preview",
    args: ["cwd", "id", "$signal"],
    request: o({
      cwd,
      id: s("准备完成的材料ID", { minLength: 1, maxLength: 200 }),
    }),
    response: r("MaterialPreview"),
    title: "查看实际材料内容",
    input: ["cwd", "id"],
    result: "MaterialPreview",
    effect:
      "文件读取磁盘当前版本，最多128KiB；图片与Skill读取本次准备的固定内容；历史显示不冒充原文件版本。",
    example: { cwd: "H:/workspace/moon", id: "material-id" },
  },
  materialRestore: {
    ...common,
    method: "materials.restore",
    args: ["sessionId", "cwd", "materials", "$signal"],
    request: o({
      sessionId: identity,
      cwd,
      materials: a(r("MaterialReference")),
    }),
    response: a(r("MaterialReference")),
    title: "核对草稿或队列材料",
    input: ["sessionId", "cwd", "materials"],
    result: "MaterialReference[]",
    effect:
      "恢复已准备图片、文件引用和Skills；失效材料保留名称、失败原因及权威retryable。固定图片内容/缓存损坏或不存在不可原地修复，需重新选择；临时读写失败与文件/Skill来源失效允许人工核对。调用方的恢复标记不参与服务判定，不重新上传、丢弃或发送消息。",
    example: {
      sessionId: "sample-session",
      cwd: "H:/workspace/moon",
      materials: [],
    },
  },
}
