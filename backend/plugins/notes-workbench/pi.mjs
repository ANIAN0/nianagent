const CODE_CONVENTION =
  "组件源码约定：不写 import 语句；可用作用域为 React、Fragment、useState、useEffect、useRef、useMemo、useCallback、useReducer、useLayoutEffect 和 cn()；样式用 tailwind 工具类，可在组件内内联 <style> 定义动画；源码末尾必须定义 function Page() {...}。"

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
  }，${page.commentCount} 条评论`
const formatComments = (comments) =>
  comments.length
    ? comments
        .map(
          (comment) =>
            `- ${comment.author === "agent" ? "agent" : "用户"}${
              comment.target ? ` @ ${comment.target}` : " @ 整页"
            }：${comment.text}`
        )
        .join("\n")
    : "（暂无评论）"

export const toolPolicy = (name) =>
  ["create_page", "write_page", "add_comment"].includes(name)
    ? { effect: "write", resource: "record" }
    : { effect: "read", resource: "record" }

export default function extension(pi, { application }) {
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
      "读取笔记页面的组件源码与全部评论。需要吸收用户评论、或把确认后的源码写入项目时使用。",
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
      const text = [
        `# ${value.page.title || value.page.name}（${value.page.status === "confirmed" ? "已确认" : "草稿"}）`,
        "",
        "```tsx",
        value.page.source,
        "```",
        "",
        "## 评论",
        formatComments(value.comments),
      ].join("\n")
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
    description: `在笔记工作台的目录下新建页面并交付。用户沟通前端样式时用它创建页面草稿。${CODE_CONVENTION}`,
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
          minLength: 1,
          maxLength: 200000,
          description: "React 组件源码",
        },
      },
      required: ["directoryId", "name", "title", "code"],
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
    description: `替换笔记页面的组件源码，用于按评论迭代样式。${CODE_CONVENTION}`,
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
      },
      required: ["pageId", "code"],
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
      "以 agent 身份在笔记页面上添加评论，向用户说明设计意图或请求确认；用户在工作台的对应元素旁可见。target 填元素 CSS 选择器，无法定位时留空表示整页评论。",
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
}
