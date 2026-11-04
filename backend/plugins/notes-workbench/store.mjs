// @ts-check
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { replaceJson } from "../../atomic-file.mjs"

/** 源码是裸 .tsx 文本（可直接用于项目）；用与 stageJson 相同的原子替换写入。 */
async function writeSource(file, text) {
  const directory = dirname(file)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.${basename(file)}-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, text, { flag: "wx", mode: 0o600 })
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/** 页面源码约定：无 import，末尾定义组件 Page；渲染与落盘均基于同一段源码。 */
export const starterPageCode = [
  "function Page() {",
  "  return (",
  '    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-10">',
  '      <h1 className="text-2xl font-semibold text-neutral-900">新页面</h1>',
  '      <p className="text-sm text-neutral-500">让 agent 改写这个组件，或直接圈选元素添加评论。</p>',
  "    </div>",
  "  )",
  "}",
].join("\n")

const namePattern = /^[\p{L}\p{N}][\p{L}\p{N}_. -]{0,63}$/u
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const pageStatuses = new Set(["draft", "confirmed"])
const sections = new Set(["normal", "exception", "states"])
const controls = new Set(["boolean", "number", "string", "select"])
const now = () => new Date().toISOString()

const assertName = (value, label) => {
  if (typeof value !== "string" || !namePattern.test(value))
    throw new Error(
      `${label}需为 1–64 位字母、数字、点、空格、下划线或连字符。`
    )
}
const assertCode = (value) => {
  if (typeof value !== "string" || value.length < 1 || value.length > 200000)
    throw new Error("组件源码需为 1–200000 字符的文本。")
}
const assertText = (value, label, max) => {
  if (typeof value !== "string" || value.length < 1 || value.length > max)
    throw new Error(`${label}需为 1–${max} 字符的文本。`)
}
const assertId = (value, label) => {
  if (typeof value !== "string" || !idPattern.test(value))
    throw new Error(`${label}需为 1–64 位字母开头的字母、数字、下划线或连字符。`)
}
const optionalText = (value, label, max) => {
  if (value === undefined || value === null) return ""
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${label}需为不超过 ${max} 字符的文本。`)
  return value
}
const textList = (value, label, max, maxItems) => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maxItems)
    throw new Error(`${label}最多 ${maxItems} 项。`)
  return value.map((item) => optionalText(item, `${label}条目`, max))
}

/** args 是动态键对象：仅允许基础类型值，结构与规模在此收敛。 */
const assertArgs = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("状态 args 需为对象。")
  const keys = Object.keys(value)
  if (keys.length > 32) throw new Error("状态 args 最多 32 个属性。")
  const args = {}
  for (const key of keys) {
    if (key.length > 64) throw new Error("状态 args 属性名最长 64 字符。")
    const item = value[key]
    if (
      item === null ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      args[key] = item
      continue
    }
    if (typeof item === "string") {
      if (item.length > 2000)
        throw new Error("状态 args 字符串值最长 2000 字符。")
      args[key] = item
      continue
    }
    throw new Error("状态 args 仅支持字符串、数字、布尔或 null 值。")
  }
  return args
}

/** 设计元数据是目录条目协议的迁移形态；字段可选，提供即全量替换。
 *  可选对象与数字以「键省略」表达缺省（undefined），避免 JSON null 与契约冲突。 */
const normalizeMeta = (value) => {
  if (value === undefined || value === null) return null
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("设计元数据需为对象。")
  const meta = {
    description: optionalText(value.description, "页面描述", 4000),
    boundary: optionalText(value.boundary, "职责边界", 2000),
    preview: optionalText(value.preview, "预览条目", 200),
    standards: [],
    tags: textList(value.tags, "标签", 32, 8),
    argTypes: [],
    relatedOperations: textList(
      value.relatedOperations,
      "关联接口",
      200,
      32
    ),
  }
  if (!meta.preview) delete meta.preview
  const story = value.story
  if (story) {
    if (typeof story !== "object" || Array.isArray(story))
      throw new Error("story 需为对象。")
    meta.story = {
      goal: optionalText(story.goal, "用户目标", 1000),
      preconditions: textList(story.preconditions, "前置条件", 500, 16),
      result: optionalText(story.result, "预期结果", 1000),
    }
  }
  if (value.standards !== undefined && value.standards !== null) {
    if (!Array.isArray(value.standards) || value.standards.length > 32)
      throw new Error("standards 最多 32 条。")
    meta.standards = value.standards.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("standards 条目需为对象。")
      return {
        id: optionalText(item.id, "标准标识", 64),
        name: optionalText(item.name, "标准名称", 64),
        rule: optionalText(item.rule, "标准规则", 1000),
        reason: optionalText(item.reason, "标准理由", 1000),
        check: optionalText(item.check, "标准核查", 1000),
      }
    })
    if (new Set(meta.standards.map((item) => item.id)).size !== meta.standards.length)
      throw new Error("standards 标识不得重复。")
  }
  const viewport = value.viewport
  if (viewport) {
    if (typeof viewport !== "object" || Array.isArray(viewport))
      throw new Error("viewport 需为对象。")
    const width = viewport.width,
      height = viewport.height
    if (
      !Number.isInteger(width) ||
      width < 240 ||
      width > 2560 ||
      !Number.isInteger(height) ||
      height < 96 ||
      height > 1600
    )
      throw new Error("viewport 需为 240–2560 × 96–1600 的整数。")
    meta.viewport = { width, height }
  }
  if (value.argTypes !== undefined && value.argTypes !== null) {
    if (!Array.isArray(value.argTypes) || value.argTypes.length > 32)
      throw new Error("argTypes 最多 32 条。")
    meta.argTypes = value.argTypes.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("argTypes 条目需为对象。")
      assertId(item.name, "argTypes 属性名")
      if (!controls.has(item.control))
        throw new Error("argTypes 控件仅支持 boolean、number、string、select。")
      const entry = {
        name: item.name,
        label: optionalText(item.label, "控件展示名", 64),
        description: optionalText(item.description, "属性说明", 500),
        control: item.control,
        options: [],
      }
      if (item.control === "number") {
        const min = item.min ?? 0,
          max = item.max ?? 100
        if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max)
          throw new Error("number 控件需提供 min < max 的有限数值。")
        entry.min = min
        entry.max = max
      }
      if (item.control === "select") {
        entry.options = textList(item.options, "select 选项", 200, 32)
        if (!entry.options.length)
          throw new Error("select 控件需至少一个选项。")
      }
      return entry
    })
    if (new Set(meta.argTypes.map((item) => item.name)).size !== meta.argTypes.length)
      throw new Error("argTypes 属性名不得重复。")
  }
  return meta
}

const normalizeStates = (value) => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 32)
    throw new Error("states 最多 32 个。")
  const states = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("状态需为对象。")
    assertId(item.id, "状态标识")
    assertName(item.name, "状态名")
    if (!sections.has(item.section))
      throw new Error("状态分栏仅支持 normal、exception、states。")
    return {
      id: item.id,
      name: item.name,
      section: item.section,
      args: assertArgs(item.args ?? {}),
      condition: optionalText(item.condition, "出现条件", 2000),
      expected: optionalText(item.expected, "预期表现", 2000),
      steps: textList(item.steps, "操作步骤", 500, 16),
      knownIssue: optionalText(item.knownIssue, "已知问题", 2000),
    }
  })
  if (new Set(states.map((item) => item.id)).size !== states.length)
    throw new Error("状态标识不得重复。")
  return states
}

/** 旧数据缺省字段就地补齐，避免读写路径各自判空。 */
const normalizeStore = (value) => ({
  directories: value.directories,
  pages: value.pages.map((page) => ({
    ...page,
    meta: normalizeMeta(page.meta ?? null),
    states: normalizeStates(page.states ?? []),
  })),
  comments: value.comments.map((comment) => ({
    ...comment,
    resolved: comment.resolved === true,
    parentId: typeof comment.parentId === "string" ? comment.parentId : "",
  })),
})

async function readStore(file) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"))
    if (
      !value ||
      typeof value !== "object" ||
      !Array.isArray(value.directories) ||
      !Array.isArray(value.pages) ||
      !Array.isArray(value.comments)
    )
      throw new Error("数据结构无效")
    return normalizeStore(value)
  } catch (error) {
    if (error.code === "ENOENT")
      return { directories: [], pages: [], comments: [] }
    throw new Error("笔记工作台数据无法读取，原文件已保留。", { cause: error })
  }
}

/** 同进程单例：host.mjs 与 pi.mjs 共享同一实例，互斥队列串行化全部变更。 */
export async function openStore(directory) {
  const storeFile = join(directory, "store.json")
  const sourceFile = (pageId) => join(directory, "pages", `${pageId}.tsx`)
  let state = await readStore(storeFile)
  let chain = Promise.resolve()
  const serialize = (action) => {
    const task = chain.then(action)
    chain = task.then(
      () => {},
      () => {}
    )
    return task
  }
  const commentCount = (pageId) =>
    state.comments.filter((comment) => comment.pageId === pageId).length
  /** 快照走轻量投影（不含 meta/states）；详情与变更结果附完整元数据。 */
  const lightPage = (page) => {
    const { meta: _meta, states: _states, ...rest } = page
    return { ...rest, commentCount: commentCount(page.id) }
  }
  const fullPage = (page) => ({
    ...lightPage(page),
    meta: page.meta ?? undefined,
    states: page.states,
  })
  const findPage = (pageId) => {
    const page = state.pages.find((item) => item.id === pageId)
    if (!page) throw new Error("页面不存在。")
    return page
  }
  const findComment = (commentId) => {
    const comment = state.comments.find((item) => item.id === commentId)
    if (!comment) throw new Error("评论不存在。")
    return comment
  }
  const persist = () => replaceJson(storeFile, state)

  const store = {
    snapshot: () => ({
      directories: state.directories.map((item) => ({ ...item })),
      pages: state.pages.map(lightPage),
      comments: state.comments.map((item) => ({ ...item })),
    }),
    async readPage(pageId) {
      if (typeof pageId !== "string" || !pageId)
        throw new Error("页面标识无效。")
      const page = findPage(pageId)
      let source
      try {
        source = await readFile(sourceFile(pageId), "utf8")
      } catch (error) {
        if (error.code === "ENOENT")
          throw new Error("页面源码文件缺失，请重建该页面。", { cause: error })
        throw error
      }
      return {
        page: { ...fullPage(page), source },
        comments: state.comments
          .filter((comment) => comment.pageId === pageId)
          .map((item) => ({ ...item })),
      }
    },
    createDirectory: (input) =>
      serialize(async () => {
        assertName(input?.name, "目录名")
        if (state.directories.some((item) => item.name === input.name))
          throw new Error("已存在同名目录。")
        const directory = {
          id: randomUUID(),
          name: input.name,
          createdAt: now(),
        }
        state.directories.push(directory)
        await persist()
        return { directory: { ...directory } }
      }),
    createPage: (input) =>
      serialize(async () => {
        assertName(input?.name, "页面名")
        assertText(input?.title ?? "", "页面标题", 120)
        const meta = normalizeMeta(input.meta)
        const states = normalizeStates(input.states)
        // 源码为空仅当页面指向预览 bundle 条目（演示既有组件，无源码可写）。
        if (input.code) assertCode(input.code)
        else if (!meta?.preview)
          throw new Error("页面需提供组件源码，或指向预览条目。")
        const code = input.code || ""
        const directory = state.directories.find(
          (item) => item.id === input.directoryId
        )
        if (!directory) throw new Error("目录不存在。")
        if (
          state.pages.some(
            (item) =>
              item.directoryId === directory.id && item.name === input.name
          )
        )
          throw new Error("目录内已存在同名页面。")
        const page = {
          id: randomUUID(),
          directoryId: directory.id,
          name: input.name,
          title: typeof input.title === "string" ? input.title : "",
          status: "draft",
          createdAt: now(),
          updatedAt: now(),
          meta,
          states,
        }
        await writeSource(sourceFile(page.id), code)
        state.pages.push(page)
        try {
          await persist()
        } catch (error) {
          state.pages.pop()
          await rm(sourceFile(page.id), { force: true }).catch(() => {})
          throw error
        }
        return { page: fullPage(page) }
      }),
    writePage: (input) =>
      serialize(async () => {
        if (typeof input?.pageId !== "string" || !input.pageId)
          throw new Error("页面标识无效。")
        const page = findPage(input.pageId)
        if (input.code === undefined && input.meta === undefined && input.states === undefined)
          throw new Error("源码、设计元数据、状态至少提供一项。")
        if (input.code !== undefined) assertCode(input.code)
        const meta = input.meta !== undefined ? normalizeMeta(input.meta) : page.meta
        const states = input.states !== undefined ? normalizeStates(input.states) : page.states
        if (input.code !== undefined)
          await writeSource(sourceFile(input.pageId), input.code)
        state.pages = state.pages.map((item) =>
          item.id === input.pageId ? { ...item, meta, states, updatedAt: now() } : item
        )
        await persist()
        return { page: fullPage(findPage(input.pageId)) }
      }),
    setStateArgs: (input) =>
      serialize(async () => {
        const page = findPage(input?.pageId)
        if (typeof input.stateId !== "string") throw new Error("状态标识无效。")
        if (!page.states.some((item) => item.id === input.stateId))
          throw new Error("状态不存在。")
        const args = assertArgs(input.args)
        const states = page.states.map((item) =>
          item.id === input.stateId ? { ...item, args } : item
        )
        state.pages = state.pages.map((item) =>
          item.id === input.pageId ? { ...item, states, updatedAt: now() } : item
        )
        await persist()
        return { page: fullPage(findPage(input.pageId)) }
      }),
    setPageStatus: (input) =>
      serialize(async () => {
        findPage(input?.pageId)
        if (!pageStatuses.has(input.status))
          throw new Error("页面状态仅支持 draft 或 confirmed。")
        state.pages = state.pages.map((item) =>
          item.id === input.pageId ? { ...item, status: input.status } : item
        )
        await persist()
        return { page: fullPage(findPage(input.pageId)) }
      }),
    addComment: (input) =>
      serialize(async () => {
        findPage(input?.pageId)
        if (typeof input.target !== "string" || input.target.length > 2000)
          throw new Error("评论目标需为不超过 2000 字符的选择器或空字符串。")
        assertText(input.text, "评论内容", 4000)
        const parentId =
          typeof input.parentId === "string" ? input.parentId : ""
        if (parentId) {
          const parent = findComment(parentId)
          if (parent.pageId !== input.pageId)
            throw new Error("父评论不属于该页面。")
          if (parent.parentId)
            throw new Error("评论最多两级，不能再回复回复。")
        }
        const comment = {
          id: randomUUID(),
          pageId: input.pageId,
          target: input.target,
          text: input.text,
          author: input.author === "agent" ? "agent" : "user",
          resolved: false,
          parentId,
          createdAt: now(),
        }
        state.comments.push(comment)
        await persist()
        return { comment: { ...comment } }
      }),
    setCommentResolved: (input) =>
      serialize(async () => {
        findComment(input?.commentId)
        if (typeof input.resolved !== "boolean")
          throw new Error("解决标记需为布尔值。")
        state.comments = state.comments.map((item) =>
          item.id === input.commentId ? { ...item, resolved: input.resolved } : item
        )
        await persist()
        return { comment: { ...findComment(input.commentId) } }
      }),
    deletePage: (input) =>
      serialize(async () => {
        findPage(input?.pageId)
        state.pages = state.pages.filter((item) => item.id !== input.pageId)
        state.comments = state.comments.filter(
          (item) => item.pageId !== input.pageId
        )
        await persist()
        await rm(sourceFile(input.pageId), { force: true })
        return { deleted: input.pageId }
      }),
    deleteDirectory: (input) =>
      serialize(async () => {
        const directory = state.directories.find(
          (item) => item.id === input?.directoryId
        )
        if (!directory) throw new Error("目录不存在。")
        const doomed = state.pages.filter(
          (item) => item.directoryId === directory.id
        )
        state.pages = state.pages.filter(
          (item) => item.directoryId !== directory.id
        )
        const removed = new Set(doomed.map((item) => item.id))
        state.comments = state.comments.filter(
          (item) => !removed.has(item.pageId)
        )
        state.directories = state.directories.filter(
          (item) => item.id !== directory.id
        )
        await persist()
        await Promise.all(
          [...removed].map((pageId) =>
            rm(sourceFile(pageId), { force: true }).catch(() => {})
          )
        )
        return { deleted: directory.id }
      }),
  }
  return store
}
