// @ts-check
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
const int = (description, minimum, maximum) => ({
  type: "integer",
  description,
  minimum,
  maximum,
})
const array = (items, maxItems) => ({ type: "array", items, maxItems })

/** 页面属性声明：控件映射与取值约束由 store 做语义校验。 */
export const argTypeInfo = object(
  {
    name: str("Page 属性名", { maxLength: 64 }),
    label: str("控件展示名", { maxLength: 64 }),
    description: str("属性说明", { maxLength: 500 }),
    control: str(
      "控件类型：boolean、number、string 或 select",
      { maxLength: 16 },
    ),
    min: { type: "number", description: "number 控件下界" },
    max: { type: "number", description: "number 控件上界" },
    options: array(str("select 选项", { maxLength: 200 }), 32),
  },
  ["name", "control"],
)
/** 单个状态 = 基组件 Page + args 属性覆盖；args 键值仅基础类型，动态键由 store 校验。 */
export const pageStateInfo = object(
  {
    id: str("状态标识", { maxLength: 64 }),
    name: str("状态名", { maxLength: 64 }),
    section: str(
      "所属分栏：normal 正常流程、exception 异常流程、states 不同状态",
      { maxLength: 16 },
    ),
    args: { type: "object", description: "传给 Page 的属性覆盖，仅基础类型值" },
    condition: str("出现条件", { maxLength: 2000 }),
    expected: str("预期表现", { maxLength: 2000 }),
    steps: array(str("操作步骤", { maxLength: 500 }), 16),
    knownIssue: str("已知问题", { maxLength: 2000 }),
  },
  ["id", "name", "section", "args"],
)
/** 页面设计元数据：目录条目协议的迁移形态。 */
export const pageMetaInfo = object(
  {
    description: str("页面描述", { maxLength: 4000 }),
    boundary: str("职责边界", { maxLength: 2000 }),
    story: object(
      {
        goal: str("用户目标", { maxLength: 1000 }),
        preconditions: array(str("前置条件", { maxLength: 500 }), 16),
        result: str("预期结果", { maxLength: 1000 }),
      },
      [],
    ),
    standards: array(
      object({
        id: str("标准标识", { maxLength: 64 }),
        name: str("标准名称", { maxLength: 64 }),
        rule: str("规则", { maxLength: 1000 }),
        reason: str("理由", { maxLength: 1000 }),
        check: str("核查方式", { maxLength: 1000 }),
      }),
      32,
    ),
    tags: array(str("标签", { maxLength: 32 }), 8),
    viewport: object(
      {
        width: int("预览宽度", 240, 2560),
        height: int("预览高度", 96, 1600),
      },
      [],
    ),
    argTypes: array(argTypeInfo, 32),
    relatedOperations: array(str("关联接口标识", { maxLength: 200 }), 32),
  },
  [],
)
export const directoryInfo = object({
  id: str("目录标识"),
  name: str("目录名"),
  createdAt: str("创建时间"),
})
export const pageInfo = object({
  id: str("页面标识"),
  directoryId: str("所属目录标识"),
  name: str("页面名"),
  title: str("页面标题"),
  status: str("draft 或 confirmed"),
  createdAt: str("创建时间"),
  updatedAt: str("更新时间"),
  commentCount: int("评论数量", 0),
})
export const commentInfo = object({
  id: str("评论标识"),
  pageId: str("所属页面标识"),
  target: str("目标元素 CSS 选择器；空字符串表示整页评论"),
  text: str("评论内容"),
  author: str("user 或 agent"),
  resolved: { type: "boolean", description: "是否已解决" },
  parentId: str("父评论标识；空字符串表示顶层评论"),
  createdAt: str("创建时间"),
})
export const workspaceSnapshot = object({
  directories: array(directoryInfo, 512),
  pages: array(pageInfo, 2048),
  comments: array(commentInfo, 4096),
})
/** 页面记录：快照不含 meta/states；详情在此之上附源码。 */
const pageRecordProperties = {
  ...pageInfo.properties,
  meta: pageMetaInfo,
  states: array(pageStateInfo, 32),
}
const pageRecord = object(
  pageRecordProperties,
  Object.keys(pageInfo.properties),
)
const pageSource = object(
  { ...pageRecordProperties, source: str("组件源码") },
  [...Object.keys(pageInfo.properties), "source"],
)
const serviceStatus = object({
  running: { type: "boolean" },
  url: str("仅 loopback 的工作台地址"),
  port: int("配置端口", 1024, 65535),
  revision: int("配置版本", 0),
  issue: str("监听错误"),
  logIssue: str("日志写入故障"),
  directories: int("目录数量", 0),
  pages: int("页面数量", 0),
})

const operation = (title, input, value, effect, example = {}) => ({
  title,
  input,
  output: object({ value }),
  documentationOutput: object({ value }),
  module: "Moon 笔记工作台",
  remote: false,
  effect,
  example,
  condition:
    "笔记工作台插件已启用，仅本机插件页与 Pi 工具可操作；数据保存在插件数据目录。",
  errors: "名称冲突、条目缺失、存储故障或服务已停止；不会静默重建数据。",
})

export const notesWorkbenchOperations = {
  status: operation(
    "读取工作台运行状态与数据规模",
    object(),
    serviceStatus,
    "读取端口、运行状态与条目计数，不返回 token。",
  ),
  reveal: operation(
    "显示独立工作台 token",
    object(),
    object({ token: str("仅本机显式读取的私密 token") }),
    "读取私密 token，页面按用户操作显示或复制，不写入普通配置和日志。",
  ),
  ticket: operation(
    "签发一次性工作台打开票据",
    object(),
    object({ ticket: str("一次性打开票据，30 秒内单次有效") }),
    "生成一次性票据拼入打开地址；页面以票据换取资源与 token，长期 token 不进入浏览器历史。",
  ),
  save: operation(
    "保存工作台端口",
    object({
      revision: int("读取时配置版本", 0),
      port: int("固定监听端口", 1024, 65535),
    }),
    serviceStatus,
    "端口变更先确认新监听可用，再切换监听地址。",
    { revision: 0, port: 19830 },
  ),
  reload: operation(
    "重载工作台页面资源",
    object(),
    object({ version: int("重载后的资源文件版本", 0) }),
    "按文件版本重新读取页面构建产物；监听、配置与笔记数据不受影响，已打开的工作台自动刷新。",
  ),
  list: operation(
    "读取目录、页面与评论快照",
    object(),
    workspaceSnapshot,
    "读取全部笔记元数据与评论，不含页面源码、设计元数据与状态。",
  ),
  read_page: operation(
    "读取页面源码、设计元数据、状态与评论",
    object({ pageId: str("页面标识", { minLength: 1 }) }),
    object({
      page: pageSource,
      comments: array(commentInfo, 4096),
    }),
    "读取单个页面的源码、设计元数据、全部状态与评论。",
  ),
  create_directory: operation(
    "新建笔记目录",
    object({ name: str("目录名", { minLength: 1, maxLength: 64 }) }),
    object({ directory: directoryInfo }),
    "在笔记存储内新增一个目录。",
  ),
  create_page: operation(
    "新建笔记页面",
    object({
      directoryId: str("所属目录标识", { minLength: 1 }),
      name: str("页面名", { minLength: 1, maxLength: 64 }),
      title: str("页面标题", { maxLength: 120 }),
      code: str("React 组件源码", { minLength: 1, maxLength: 200000 }),
      meta: pageMetaInfo,
      states: array(pageStateInfo, 32),
    }),
    object({ page: pageRecord }),
    "在目录内新增页面并保存组件源码；设计元数据与状态可留空后续补写。",
  ),
  write_page: operation(
    "更新页面源码或设计元数据",
    object({
      pageId: str("页面标识", { minLength: 1 }),
      code: str("React 组件源码", { minLength: 1, maxLength: 200000 }),
      meta: pageMetaInfo,
      states: array(pageStateInfo, 32),
    }),
    object({ page: pageRecord }),
    "替换提供的字段（源码、设计元数据、状态至少一项），未提供的字段保持不变；不改评论。",
  ),
  set_state_args: operation(
    "更新单个状态的属性覆盖",
    object({
      pageId: str("页面标识", { minLength: 1 }),
      stateId: str("状态标识", { minLength: 1 }),
      args: { type: "object", description: "替换该状态的属性覆盖" },
    }),
    object({ page: pageRecord }),
    "仅替换指定状态的 args；工作台 controls 与 agent 共用同一份数据。",
  ),
  set_comment_resolved: operation(
    "标记评论已解决或重新打开",
    object({
      commentId: str("评论标识", { minLength: 1 }),
      resolved: { type: "boolean" },
    }),
    object({ comment: commentInfo }),
    "更新评论解决标记；解决与否由用户在工作台判断。",
  ),
  add_comment: operation(
    "为页面添加评论",
    object({
      pageId: str("页面标识", { minLength: 1 }),
      target: str("目标元素 CSS 选择器；空字符串表示整页评论", {
        maxLength: 2000,
      }),
      text: str("评论内容", { minLength: 1, maxLength: 4000 }),
      parentId: str("父评论标识；空字符串表示顶层评论", { maxLength: 64 }),
    }),
    object({ comment: commentInfo }),
    "以 agent 身份写入一条评论，用户在工作台可见。",
  ),
}
