// Independent definitions are merged into the single RPC authority in schema/contract.
const text = (description, extra = {}) => ({
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
const ref = (name) => ({ $ref: name })
const id = text("工作区稳定标识", { minLength: 1, maxLength: 128 })
export const workspaceSchemas = {
  WorkspaceRecord: object({
    id,
    name: text("真实目录名称"),
    path: text("realpath 解析的绝对目录路径"),
    available: { type: "boolean", description: "本次读取时目录是否仍可访问" },
    unavailableReason: text("目录失效说明；可用时为空"),
  }),
  WorkspaceList: object({
    items: {
      type: "array",
      items: ref("WorkspaceRecord"),
      description: "已登记工作区，包括失效目录",
    },
    selectedId: {
      anyOf: [id, { type: "null" }],
      description: "上次选中的工作区，失效时仍保留标识",
    },
  }),
}
const shared = {
  module: "工作区",
  errors:
    "目录不存在或不可访问、工作区不存在、数据文件损坏、存储失败或请求取消。",
}
export const workspaceOperations = {
  workspaceList: {
    ...shared,
    method: "workspaces.list",
    args: ["$signal"],
    request: object({}),
    response: ref("WorkspaceList"),
    title: "读取工作区",
    input: [],
    result: "WorkspaceList",
    condition:
      "首次无数据时仅登记实际宿主 cwd；之后不隐式添加。返回实时可用性，失效目录不自动删除；可取消。",
    effect: "首次原子建立目录文件；其余读取不写入。",
    example: {},
  },
  workspaceAdd: {
    ...shared,
    method: "workspaces.add",
    args: ["path", "$signal"],
    request: object({
      path: text("用户明确选择的存在目录", { minLength: 1, maxLength: 4096 }),
    }),
    response: ref("WorkspaceRecord"),
    title: "登记并选择工作区",
    input: ["path"],
    result: "WorkspaceRecord",
    condition:
      "仅接受存在的绝对目录。realpath 后按 Windows 大小写规则去重；重复登记返回原稳定 ID。锁内提交前取消无写入；rename 提交后不回滚。",
    effect:
      "新增目录或复用已有目录，并原子保存当前选择；不扫描或改动目录文件。",
    example: { path: "H:/workspace/moon" },
  },
  workspaceSelect: {
    ...shared,
    method: "workspaces.select",
    args: ["id", "$signal"],
    request: object({ id }),
    response: ref("WorkspaceRecord"),
    title: "选择工作区",
    input: ["id"],
    result: "WorkspaceRecord",
    condition:
      "选中前重新验证目录存在且可访问；失效目录拒绝。锁内提交前取消无写入，rename 后不回滚。",
    effect: "仅持久化 selectedId，不改已有会话的工作目录。",
    example: { id: "工作区ID" },
  },
  workspaceGet: {
    ...shared,
    method: "workspaces.get",
    args: ["id", "$signal"],
    request: object({ id }),
    response: { anyOf: [ref("WorkspaceRecord"), { type: "null" }] },
    title: "读取单个工作区",
    input: ["id"],
    result: "WorkspaceRecord | null",
    condition:
      "只读；不存在返回 null；存在但目录失效时 available=false，不伪造可用目录。",
    effect: "不修改已有数据。",
    example: { id: "工作区ID" },
  },
  workspaceChoose: {
    ...shared,
    method: "workspaces.choose",
    args: ["$signal"],
    request: object({}),
    response: { anyOf: [ref("WorkspaceRecord"), { type: "null" }] },
    title: "打开系统目录选择器",
    input: [],
    result: "WorkspaceRecord | null",
    condition:
      "仅用户点击时调用；Windows 原生目录窗由唯一桌面宿主打开，浏览器共用此宿主。一次一个选择窗；系统取消返回 null；请求取消后丢弃迟到结果，不登记目录。",
    effect: "选择成功后登记并选中目录；取消不写入；不自动创建文件夹。",
    example: {},
  },
}
