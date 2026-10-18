const object = (properties = {}, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const string = { type: "string" }
const integer = { type: "integer", minimum: 0 }
const path = { type: "string", minLength: 1, maxLength: 4096 }
const output = object({ value: { type: "object", additionalProperties: true } })
const definition = (title, input, effect, example, details = "") => ({
  title,
  input,
  output,
  example,
  scope: "session",
  remote: true,
  module: "文件工作栏",
  effect,
  condition:
    "文件插件已启用，提供现有sessionId。宿主核对会话和工作目录；相对路径以会话cwd解析，目录树限cwd，单文件按实际路径读取。主动取消结束本次等待/读取。" +
    details,
  errors:
    "插件停用或代次变化、会话失效、来源不可读或改变、文件格式/大小/位置超限返回明确错误；git初次仓库定位失败在value中说明不可用，后续状态/差异读取失败仍拒绝。只读可重新读取，材料准备失败不表示消息已发送。",
})

/** The app registers these exact schemas; the API catalog reads the same registry. */
export const fileModule = {
  source:
    "backend/plugins/file-workbench/host.mjs → documents.mjs / git.mjs；contract.mjs为实际注册schema",
  storage:
    "当前工作文件及Git只读；选区/路径材料沿MaterialService缓存；会话操作沿Pi历史；可见租约仅内存",
  responsibility:
    "当前文件阅读/引用、可见消费者及Git差异，实际传输复用插件宿主pluginCall和会话授权。",
}
export const fileOperations = {
  git: definition(
    "读取Git当前状态",
    object(),
    "只读当前整仓Git状态；不推断会话操作，不暂存或写文件。",
    {},
    "Git命令每次输出最多4MiB，执行等待最多15秒。"
  ),
  gitDiff: definition(
    "读取所选Git差异",
    object({
      path,
      stage: { type: "string", enum: ["staged", "unstaged", "untracked"] },
    }),
    "只读当前所选路径及Git来源的patch。",
    { path: "H:/工作目录/README.md", stage: "unstaged" },
    "先调用git，再将目标entries.path绝对路径和stage原样填入；不会按相对路径猜测另一条变更。Git命令每次输出最多4MiB，执行等待最多15秒。"
  ),
  tree: definition(
    "读取当前目录树",
    object({ path }, []),
    "只读一层实际目录，返回entries和truncated；最多2000项。",
    { path: "." }
  ),
  info: definition(
    "读取当前文件信息",
    object({ path }),
    "只读实际路径、格式、字节数和版本；不保存历史全文。",
    { path: "README.md" }
  ),
  text: definition(
    "读取当前文本页",
    object(
      {
        path,
        offset: integer,
        line: { type: "integer", minimum: 1 },
        atLine: { type: "integer", minimum: 1 },
        expected: string,
      },
      ["path"]
    ),
    "只读当前源码页，返回content/offset/next/line/nextLine/complete；每页最多2MiB和5000行，CRLF/CR/LF均计一行。",
    { path: "README.md" },
    "expected可校验原读取版本；atLine按实际换行定位，不与另一版本拼页。"
  ),
  bytes: definition(
    "读取当前文件字节窗口",
    object(
      {
        path,
        offset: integer,
        expected: string,
        purpose: { type: "string", enum: ["preview", "download"] },
      },
      ["path"]
    ),
    "只读base64字节窗口，返回offset/next/complete/version；每窗口最多2MiB。图片/PDF预览及远程完整下载限32MiB；本机原生导出仍读取原文件。",
    { path: "README.md", purpose: "download" },
    "后续窗口携带expected；来源变化时拒绝拼接。"
  ),
  state: definition(
    "读取当前文件版本",
    object({ path }),
    "只读当前路径和版本，供可见文件更新观察。",
    { path: "README.md" }
  ),
  reference: definition(
    "准备当前路径引用",
    object({ path }),
    "准备既有材料缓存记录，返回material；只引用路径，不采用或发送消息。已知上传路径关联原上传归属。",
    { path: "README.md" }
  ),
  selection: definition(
    "准备实际选区引用",
    object(
      {
        path,
        text: { type: "string", minLength: 1 },
        selectionKind: { type: "string", enum: ["source", "markdown", "pdf"] },
        lineStart: { type: "integer", minimum: 1 },
        lineEnd: { type: "integer", minimum: 1 },
        columnStart: { type: "integer", minimum: 1 },
        columnEnd: { type: "integer", minimum: 1 },
        pageStart: { type: "integer", minimum: 1 },
        pageEnd: { type: "integer", minimum: 1 },
      },
      ["path", "text", "selectionKind"]
    ),
    "在原材料缓存保存这次实际选区文字和范围，返回material；不保存文件全文版本，也不发送消息。",
    {
      path: "README.md",
      text: "Moon",
      selectionKind: "source",
      lineStart: 1,
      lineEnd: 1,
      columnStart: 1,
      columnEnd: 5,
    },
    "选区最多2MiB。source须实际行列，pdf须实际起止页；前端传实际选区，后端不推断未选内容。"
  ),
  view: definition(
    "更新可见文件消费者",
    object({
      token: string,
      generation: { type: "integer", minimum: 1 },
      active: { type: "boolean" },
    }),
    "更新当前客户端/会话的短期可见租约，并消费匹配的打开请求；不持久化用户数据。",
    { token: "catalog-view", generation: 1, active: false },
    "租约15秒，打开请求5秒/最多8项。旧token/代次不能替换当前消费者；active=false只结束匹配者。"
  ),
}

// Observed output shapes for documentation only. Runtime output remains open.
const described = (type, description) => ({ type, description })
const text = (description) => described("string", description)
const number = (description) => described("integer", description)
const flag = (description) => described("boolean", description)
const list = (items) => ({ type: "array", items })
const material = object({ material: { $ref: "MaterialReference" } })
const fileIdentity = {
  path: text("解析后的实际绝对文件路径"),
  version: text("当前文件观察版本；供后续读取 expected 核对"),
}
export const fileDocumentationOutputs = {
  git: {
    anyOf: [
      object({
        available: { type: "boolean", enum: [false] },
        error: text("仓库定位失败原因"),
      }),
      object({
        available: { type: "boolean", enum: [true] },
        root: text("Git 仓库绝对根目录"),
        entries: list(
          object(
            {
              name: text("Git 路径名称"),
              path: text("变更文件绝对路径"),
              status: text("Git porcelain 双字符状态"),
              previous: text("重命名或复制前路径；只有 R/C 时返回"),
              stage: {
                ...text("差异来源"),
                enum: ["staged", "unstaged", "untracked"],
              },
            },
            ["name", "path", "status", "stage"]
          )
        ),
      }),
    ],
  },
  gitDiff: object({
    patch: text("Git 原始 unified diff"),
    path: text("匹配当前状态的绝对路径"),
    stage: text("原 staged / unstaged / untracked 来源"),
    root: text("仓库根目录"),
  }),
  tree: object({
    cwd: text("会话工作目录"),
    path: text("当前层实际绝对目录"),
    entries: list(
      object({
        name: text("直属文件或目录名"),
        path: text("直属条目的绝对路径"),
        directory: flag("是否目录"),
        linked: flag("是否符号链接"),
      })
    ),
    truncated: flag("超过2000项截断"),
  }),
  info: object({
    ...fileIdentity,
    requested: text("原请求路径，保留符号链接名称"),
    name: text("原请求文件名"),
    displayPath: text("相对会话cwd的展示路径"),
    bytes: number("实际文件总字节数"),
    kind: {
      ...text("实际可预览类别"),
      enum: ["image", "pdf", "unsupported", "markdown", "text"],
    },
    mimeType: text("内容识别出的 MIME 类型"),
  }),
  text: object({
    ...fileIdentity,
    content: text("当前 UTF-8 文本页"),
    offset: number("本页开始字节偏移；省略时0"),
    next: number("下一页字节偏移"),
    line: number("本页起始行，1基"),
    nextLine: number("下一页起始行，按实际换行计数"),
    complete: flag("已读至文件末尾"),
  }),
  bytes: object({
    ...fileIdentity,
    name: text("实际文件名"),
    bytes: number("总字节数"),
    data: text("当前窗口的 base64 编码字节"),
    offset: number("本窗口开始字节偏移"),
    next: number("下一窗口偏移"),
    complete: flag("已到文件末尾"),
  }),
  state: object(fileIdentity),
  reference: material,
  selection: material,
  view: object({
    requests: list(
      object({
        path: text("原请求文件路径"),
        until: number("打开请求失效时间，Unix毫秒"),
        token: text("匹配的可见消费者令牌"),
      })
    ),
  }),
}
