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
const pageStatuses = new Set(["draft", "confirmed"])
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
    return value
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
  const pageMeta = (page) => ({ ...page, commentCount: commentCount(page.id) })
  const findPage = (pageId) => {
    const page = state.pages.find((item) => item.id === pageId)
    if (!page) throw new Error("页面不存在。")
    return page
  }

  const store = {
    snapshot: () => ({
      directories: state.directories.map((item) => ({ ...item })),
      pages: state.pages.map(pageMeta),
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
        page: { ...pageMeta(page), source },
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
        await replaceJson(storeFile, state)
        return { directory: { ...directory } }
      }),
    createPage: (input) =>
      serialize(async () => {
        assertName(input?.name, "页面名")
        assertText(input?.title ?? "", "页面标题", 120)
        assertCode(input?.code)
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
        }
        await writeSource(sourceFile(page.id), input.code)
        state.pages.push(page)
        try {
          await replaceJson(storeFile, state)
        } catch (error) {
          state.pages.pop()
          await rm(sourceFile(page.id), { force: true }).catch(() => {})
          throw error
        }
        return { page: pageMeta(page) }
      }),
    writePage: (input) =>
      serialize(async () => {
        if (typeof input?.pageId !== "string" || !input.pageId)
          throw new Error("页面标识无效。")
        assertCode(input.code)
        findPage(input.pageId)
        await writeSource(sourceFile(input.pageId), input.code)
        state.pages = state.pages.map((item) =>
          item.id === input.pageId ? { ...item, updatedAt: now() } : item
        )
        await replaceJson(storeFile, state)
        return { page: pageMeta(findPage(input.pageId)) }
      }),
    setPageStatus: (input) =>
      serialize(async () => {
        findPage(input?.pageId)
        if (!pageStatuses.has(input.status))
          throw new Error("页面状态仅支持 draft 或 confirmed。")
        state.pages = state.pages.map((item) =>
          item.id === input.pageId ? { ...item, status: input.status } : item
        )
        await replaceJson(storeFile, state)
        return { page: pageMeta(findPage(input.pageId)) }
      }),
    addComment: (input) =>
      serialize(async () => {
        findPage(input?.pageId)
        if (typeof input.target !== "string" || input.target.length > 2000)
          throw new Error("评论目标需为不超过 2000 字符的选择器或空字符串。")
        assertText(input.text, "评论内容", 4000)
        const comment = {
          id: randomUUID(),
          pageId: input.pageId,
          target: input.target,
          text: input.text,
          author: input.author === "agent" ? "agent" : "user",
          createdAt: now(),
        }
        state.comments.push(comment)
        await replaceJson(storeFile, state)
        return { comment: { ...comment } }
      }),
    deletePage: (input) =>
      serialize(async () => {
        findPage(input?.pageId)
        state.pages = state.pages.filter((item) => item.id !== input.pageId)
        state.comments = state.comments.filter(
          (item) => item.pageId !== input.pageId
        )
        await replaceJson(storeFile, state)
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
        await replaceJson(storeFile, state)
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
