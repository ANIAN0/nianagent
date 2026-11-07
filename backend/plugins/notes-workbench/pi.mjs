import { pageMetaInfo, pageStateInfo } from "./contract.mjs"

const CODE_CONVENTION =
  '组件源码约定：可从 "moon-ui" 具名导入白名单组件（Button、Badge、Checkbox、Collapsible、Dialog、DropdownMenu、Empty、Input、Field、Label、Popover、RadioGroup、Select、Separator、Skeleton、Switch、Table、Tabs、Textarea、Tooltip、Alert 等）；不支持其他 import 语句。可用作用域为 React、Fragment、useState、useEffect、useRef、useMemo、useCallback、useReducer、useLayoutEffect 和 cn()；样式用 tailwind 工具类，可在组件内内联 <style> 定义动画；源码末尾必须定义 function Page() {...}。Page 可声明 props 参数，状态的 args 会作为 props 传入。演示项目既有组件时也可改用 meta.preview 指向预览条目（catalog:<目录 id> 为组件目录桥，或 home-story、notification-toast 等独立条目），code 留空。'

const op = (application, name) => {
  const operation = application?.operations?.[name]
  if (!operation) throw new Error("笔记存储不可用，请确认插件已启用。")
  return operation
}
const call = async (application, name, input, signal) => {
  const { value } = await op(application, name).execute(
    input,
    undefined,
    signal
  )
  return value
}
const describePage = (page, directory) =>
  `「${directory || "未分组"} / ${page.title || page.name}」${
    page.status === "confirmed" ? "（已确认）" : ""
  }，${page.commentCount} 条评论，${page.states?.length || 0} 个状态`
const formatComments = (comments) => {
  if (!comments.length) return "（暂无评论）"
  const roots = comments.filter((comment) => !comment.parentId)
  const repliesOf = (commentId) =>
    comments.filter((comment) => comment.parentId === commentId)
  const line = (comment, indent) =>
    `${"  ".repeat(indent)}- ${comment.author === "agent" ? "agent" : "用户"}${
      comment.target ? ` @ ${comment.target}` : " @ 整页"
    }${comment.resolved ? "（已解决）" : ""}：${comment.text}` +
    repliesOf(comment.id)
      .map((reply) => `\n${line(reply, indent + 1)}`)
      .join("")
  return roots.map((comment) => line(comment, 0)).join("\n")
}
const formatMeta = (meta) => {
  if (!meta) return ""
  const parts = []
  if (meta.description) parts.push(`描述：${meta.description}`)
  if (meta.boundary) parts.push(`边界：${meta.boundary}`)
  if (meta.story) {
    const story = [
      meta.story.goal ? `目标：${meta.story.goal}` : "",
      meta.story.preconditions.length
        ? `前置：${meta.story.preconditions.join("；")}`
        : "",
      meta.story.result ? `结果：${meta.story.result}` : "",
    ].filter(Boolean)
    if (story.length) parts.push(`用户故事：\n  ${story.join("\n  ")}`)
  }
  if (meta.standards.length)
    parts.push(
      `设计标准：\n${meta.standards
        .map(
          (item) =>
            `  - ${item.name}${item.rule ? `：${item.rule}` : ""}${
              item.check ? `（核查：${item.check}）` : ""
            }`
        )
        .join("\n")}`
    )
  if (meta.tags.length) parts.push(`标签：${meta.tags.join("、")}`)
  if (meta.relatedOperations.length)
    parts.push(`关联接口：${meta.relatedOperations.join("、")}`)
  return parts.join("\n")
}
const formatStates = (states) =>
  states.length
    ? `状态（args 会作为 props 传给 Page）：\n${states
        .map((state) => {
          const detail = [
            state.condition ? `条件：${state.condition}` : "",
            state.expected ? `预期：${state.expected}` : "",
            state.steps.length ? `步骤：${state.steps.join(" → ")}` : "",
            state.knownIssue ? `已知问题：${state.knownIssue}` : "",
          ]
            .filter(Boolean)
            .map((item) => `    ${item}`)
            .join("\n")
          return `  - ${state.id}（${
            { normal: "正常流程", exception: "异常流程", states: "不同状态" }[
              state.section
            ] || state.section
          }）/${state.name}，args=${JSON.stringify(state.args)}${
            detail ? `\n${detail}` : ""
          }`
        })
        .join("\n")}`
    : ""

export const toolPolicy = (name) =>
  ["create_page", "write_page", "add_comment", "export_page"].includes(name)
    ? { effect: "write", resource: "record" }
    : { effect: "read", resource: "record" }

export default function extension(pi, { application, cwd }) {
  pi.registerTool({
    name: "moon_ext__notes-workbench__list",
    label: "笔记目录",
    description:
      "列出笔记工作台的全部目录、页面与评论概况。用户提到笔记、页面、工作台时先用它定位页面标识。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_id, _input, signal) {
      signal?.throwIfAborted()
      const value = await call(application, "list", {}, signal)
      const directories = new Map(
        value.directories.map((item) => [item.id, item.name])
      )
      const text = value.pages.length
        ? value.pages
            .map((page) =>
              describePage(page, directories.get(page.directoryId))
            )
            .join("\n")
        : "笔记工作台还没有目录或页面。"
      return { content: [{ type: "text", text }] }
    },
  })
  pi.registerTool({
    name: "moon_ext__notes-workbench__read_page",
    label: "读取笔记页面",
    description:
      "读取笔记页面的源码、设计元数据（描述、story、标准、标签、关联接口）、全部状态（含 args、条件、预期、步骤）与评论线程。需要吸收用户评论、核对设计标准、或把确认后的源码写入项目时使用。",
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", minLength: 1, description: "页面标识" },
      },
      required: ["pageId"],
      additionalProperties: false,
    },
    async execute(_id, input, signal) {
      signal?.throwIfAborted()
      const value = await call(application, "read_page", input, signal)
      const page = value.page
      const text = [
        `# ${page.title || page.name}（${page.status === "confirmed" ? "已确认" : "草稿"}）`,
        "",
        "```tsx",
        page.source,
        "```",
        "",
      ]
      const meta = formatMeta(page.meta)
      if (meta) text.push(`## 设计说明`, meta, "")
      const states = formatStates(page.states)
      if (states) text.push(`## 状态`, states, "")
      text.push(`## 评论`, formatComments(value.comments))
      return { content: [{ type: "text", text }] }
    },
  })
  pi.registerTool({
    name: "moon_ext__notes-workbench__create_directory",
    label: "新建笔记目录",
    description: "在笔记工作台新建一个目录，用于组织页面。",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "目录名，如「首页改版」",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async execute(_id, input, signal) {
      signal?.throwIfAborted()
      const value = await call(application, "create_directory", input, signal)
      const text = `目录「${value.directory.name}」已创建。`
      return { content: [{ type: "text", text }] }
    },
  })
  pi.registerTool({
    name: "moon_ext__notes-workbench__create_page",
    label: "新建笔记页面",
    description: `在笔记工作台的目录下新建页面并交付。用户沟通前端样式时用它创建页面草稿；建议同时提供描述与状态。${CODE_CONVENTION}`,
    parameters: {
      type: "object",
      properties: {
        directoryId: { type: "string", minLength: 1, description: "目录标识" },
        name: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "页面名，如「首页-v1」",
        },
        title: {
          type: "string",
          maxLength: 120,
          description: "页面标题，展示给用户",
        },
        code: {
          type: "string",
          maxLength: 200000,
          description: "React 组件源码；meta.preview 指向预览条目时可省略",
        },
        meta: {
          ...pageMetaInfo,
          description:
            "设计元数据：描述、边界、预览条目、story、设计标准、标签、预览视口、属性控件、关联接口；可省略",
        },
        states: {
          type: "array",
          items: pageStateInfo,
          maxItems: 32,
          description:
            "页面状态：id、name、section（normal/exception/states）与 args（传给 Page 的属性覆盖），可附条件、预期、步骤；可省略",
        },
      },
      required: ["directoryId", "name", "title"],
      additionalProperties: false,
    },
    async execute(_id, input, signal) {
      signal?.throwIfAborted()
      const value = await call(application, "create_page", input, signal)
      const summary = `笔记页面「${value.page.title || value.page.name}」已创建，可在笔记工作台查看与圈评。`
      return {
        content: [{ type: "text", text: summary }],
        details: {
          moonDelivery: {
            kind: "notes-page",
            version: 1,
            payload: JSON.stringify({
              pageId: value.page.id,
              name: value.page.name,
              title: value.page.title,
              commentCount: value.page.commentCount,
              updatedAt: value.page.updatedAt,
            }),
            summary,
          },
        },
      }
    },
  })
  pi.registerTool({
    name: "moon_ext__notes-workbench__write_page",
    label: "更新笔记页面",
    description: `替换页面源码、设计元数据或状态定义，用于按评论迭代样式；提供哪项就替换哪项，至少一项。${CODE_CONVENTION}`,
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", minLength: 1, description: "页面标识" },
        code: {
          type: "string",
          minLength: 1,
          maxLength: 200000,
          description: "React 组件源码",
        },
        meta: {
          ...pageMetaInfo,
          description: "设计元数据全量替换；可省略",
        },
        states: {
          type: "array",
          items: pageStateInfo,
          maxItems: 32,
          description: "状态定义全量替换；可省略",
        },
      },
      required: ["pageId"],
      additionalProperties: false,
    },
    async execute(_id, input, signal) {
      signal?.throwIfAborted()
      const value = await call(application, "write_page", input, signal)
      const summary = `笔记页面「${value.page.title || value.page.name}」已更新，工作台将自动刷新。`
      return {
        content: [{ type: "text", text: summary }],
        details: {
          moonDelivery: {
            kind: "notes-page",
            version: 1,
            payload: JSON.stringify({
              pageId: value.page.id,
              name: value.page.name,
              title: value.page.title,
              commentCount: value.page.commentCount,
              updatedAt: value.page.updatedAt,
            }),
            summary,
          },
        },
      }
    },
  })
  pi.registerTool({
    name: "moon_ext__notes-workbench__add_comment",
    label: "添加页面评论",
    description:
      "以 agent 身份在笔记页面上添加评论，向用户说明设计意图或请求确认；用户在工作台的对应元素旁可见。target 填元素 CSS 选择器，无法定位时留空表示整页评论；需要回应某条用户评论时传 parentId。",
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", minLength: 1, description: "页面标识" },
        target: {
          type: "string",
          maxLength: 2000,
          description: "目标元素 CSS 选择器；空字符串表示整页评论",
        },
        text: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description: "评论内容",
        },
        parentId: {
          type: "string",
          maxLength: 64,
          description: "父评论标识；空字符串表示顶层评论",
        },
      },
      required: ["pageId", "target", "text"],
      additionalProperties: false,
    },
    async execute(_id, input, signal) {
      signal?.throwIfAborted()
      const value = await call(application, "add_comment", input, signal)
      const text = `评论已添加：${value.comment.text}`
      return { content: [{ type: "text", text }] }
    },
  })
  pi.registerTool({
    name: "moon_ext__notes-workbench__export_page",
    label: "导出页面源码",
    description:
      "把已确认（confirmed）的笔记页面源码写入工作目录文件。仅用于用户确认后的组件落盘；目标路径需为工作目录内的相对 .tsx 路径。",
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", minLength: 1, description: "页面标识" },
        path: {
          type: "string",
          minLength: 1,
          maxLength: 400,
          description: "目标文件相对路径，如 src/components/foo.tsx",
        },
      },
      required: ["pageId", "path"],
      additionalProperties: false,
    },
    async execute(_id, input, signal) {
      signal?.throwIfAborted()
      const value = await call(
        application,
        "read_page",
        { pageId: input.pageId },
        signal
      )
      if (value.page.status !== "confirmed")
        throw new Error("仅已确认的页面可导出；请先在工作台确认。")
      if (!value.page.source)
        throw new Error("该页面没有源码（预览条目页面无需导出）。")
      const relativePath = input.path.replaceAll("\\", "/")
      if (
        relativePath.startsWith("/") ||
        relativePath.split("/").includes("..") ||
        !relativePath.endsWith(".tsx")
      )
        throw new Error("目标路径需为工作目录内的相对 .tsx 路径。")
      const workspace = cwd || process.cwd()
      const { writeFile, mkdir } = await import("node:fs/promises")
      const { dirname, resolve, sep } = await import("node:path")
      const absolute = resolve(workspace, relativePath)
      if (!absolute.startsWith(resolve(workspace) + sep))
        throw new Error("目标路径需位于工作目录内。")
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, value.page.source, "utf8")
      const text = `已导出「${value.page.title || value.page.name}」到 ${relativePath}。`
      return { content: [{ type: "text", text }] }
    },
  })
}
