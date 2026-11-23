import { access, mkdir, readFile, realpath, stat } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, isAbsolute, join, parse, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import lockfile from "proper-lockfile"
import { replaceJson, withAcquiredLock } from "../../atomic-file.mjs"
import { agentsMdOperations } from "./contract.mjs"
import { createPublications } from "./publication.mjs"

const AGENTS_FILENAME = "AGENTS.md"
const MAX_LCS_LINES = 1200

const check = (condition, message) => {
  if (!condition) throw new Error(message)
}

const pathKey = (target) =>
  process.platform === "win32" ? resolve(target).toLowerCase() : resolve(target)

const normalizeEol = (text) => String(text ?? "").replace(/\r\n/g, "\n")

const countLines = (text) => {
  if (!text) return 0
  const normalized = normalizeEol(text)
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n").length
    : normalized.split("\n").length
}

export function composeAgentsContent(baseContent, snippets) {
  const parts = []
  const base = normalizeEol(baseContent).trimEnd()
  if (base.trim()) parts.push(base)
  for (const snippet of snippets || []) {
    if (!snippet?.enabled) continue
    const body = normalizeEol(snippet.content).trim()
    if (body) parts.push(body)
  }
  if (!parts.length) return ""
  return `${parts.join("\n\n")}\n`
}

function buildLineDiff(currentText, targetText) {
  const a = normalizeEol(currentText)
  const b = normalizeEol(targetText)
  if (a === b) return ""
  const oldLines = a ? a.replace(/\n$/, "").split("\n") : []
  const newLines = b ? b.replace(/\n$/, "").split("\n") : []
  if (oldLines.length * newLines.length > MAX_LCS_LINES * MAX_LCS_LINES) {
    return [
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`),
    ].join("\n")
  }
  const m = oldLines.length
  const n = newLines.length
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      out.push(` ${oldLines[i]}`)
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`-${oldLines[i]}`)
      i++
    } else {
      out.push(`+${newLines[j]}`)
      j++
    }
  }
  while (i < m) out.push(`-${oldLines[i++]}`)
  while (j < n) out.push(`+${newLines[j++]}`)
  return out.join("\n")
}

function defaultState() {
  return {
    version: 1,
    revision: 0,
    baseContent: "",
    updatedAt: "",
    snippets: [],
    customProjects: [],
  }
}

function validateState(doc) {
  check(
    doc &&
      typeof doc === "object" &&
      doc.version === 1 &&
      Number.isInteger(doc.revision) &&
      doc.revision >= 0 &&
      typeof doc.baseContent === "string" &&
      typeof doc.updatedAt === "string" &&
      Array.isArray(doc.snippets) &&
      Array.isArray(doc.customProjects),
    "AGENTS.md 管理插件数据文件损坏；原文件未覆盖。"
  )
  return doc
}

function sanitizeSnippets(snippets) {
  check(Array.isArray(snippets), "附加说明必须是列表。")
  check(snippets.length <= 64, "附加说明数量不能超过 64 条。")
  const seen = new Set()
  return snippets.map((item) => {
    check(item && typeof item === "object", "附加说明条目无效。")
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : randomUUID()
    check(id.length <= 128 && !seen.has(id), "附加说明标识重复或无效。")
    seen.add(id)
    const name = typeof item.name === "string" ? item.name.trim() : ""
    check(name.length >= 1 && name.length <= 120, "附加说明名称须为 1–120 字。")
    check(typeof item.content === "string", "附加说明内容必须是文本。")
    check(item.content.length <= 200_000, "单条附加说明内容过长。")
    const source = item.source === "plugin" ? "plugin" : "manual"
    return {
      id,
      name,
      content: normalizeEol(item.content),
      enabled: Boolean(item.enabled),
      source,
    }
  })
}

async function resolveDirectory(inputPath, signal) {
  signal?.throwIfAborted()
  check(
    typeof inputPath === "string" &&
      inputPath.trim().length > 0 &&
      inputPath.length <= 4096 &&
      isAbsolute(inputPath.trim()),
    "请输入有效的绝对目录路径。"
  )
  try {
    const canonical = await realpath(inputPath.trim())
    const info = await stat(canonical)
    check(info.isDirectory(), "所选路径不是目录。")
    await access(canonical, constants.R_OK)
    signal?.throwIfAborted()
    return canonical
  } catch (error) {
    if (error?.message === "所选路径不是目录。") throw error
    throw new Error("目标目录不存在或不可访问，请重新选择。", { cause: error })
  }
}

export async function activate(host) {
  const stateFile = join(host.directory, "state.json")
  let closed = false

  const ensureOpen = (signal) => {
    signal?.throwIfAborted()
    check(!closed, "AGENTS.md 管理插件已停止。")
  }

  async function readState() {
    try {
      return validateState(JSON.parse(await readFile(stateFile, "utf8")))
    } catch (error) {
      if (error.code === "ENOENT") return defaultState()
      throw error
    }
  }

  async function withStateLock(action, signal) {
    ensureOpen(signal)
    await mkdir(host.directory, { recursive: true })
    const release = await lockfile
      .lock(stateFile, {
        realpath: false,
        lockfilePath: `${stateFile}.lock`,
        retries: { retries: 40, minTimeout: 20, maxTimeout: 100 },
      })
      .catch((error) => {
        throw new Error("AGENTS.md 配置正在保存，请稍后重试。", {
          cause: error,
        })
      })
    return withAcquiredLock(release, (committed) => {
      ensureOpen(signal)
      return action(committed)
    })
  }

  async function mutateState(mutator, signal) {
    return withStateLock(async (committed) => {
      const current = await readState()
      const { next, changed, result } = await mutator(current)
      if (changed) {
        ensureOpen(signal)
        await replaceJson(stateFile, next, { signal, pretty: true })
        committed()
      }
      return { state: changed ? next : current, result }
    }, signal)
  }

  async function collectRegisteredProjects(state, signal) {
    const entries = []
    const seen = new Set()

    if (host.workspaces?.list) {
      try {
        const listed = await host.workspaces.list(signal)
        for (const item of listed?.items || []) {
          const key = pathKey(item.path)
          if (seen.has(key)) continue
          seen.add(key)
          entries.push({
            id: item.id,
            name: item.name || basename(item.path) || parse(item.path).root,
            path: item.path,
            source: "workspace",
            knownUnavailable: item.available === false,
            unavailableReason: item.unavailableReason || "",
          })
        }
      } catch {
        // 工作区列表读取失败时不阻断手动登记目录展示
      }
    }

    for (const item of state.customProjects || []) {
      const key = pathKey(item.path)
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        id: item.id,
        name: item.name || basename(item.path) || parse(item.path).root,
        path: item.path,
        source: "custom",
        knownUnavailable: false,
        unavailableReason: "",
      })
    }

    return entries
  }

  async function inspectProject(entry, composedContent, signal) {
    signal?.throwIfAborted()
    const filePath = join(entry.path, AGENTS_FILENAME)
    if (entry.knownUnavailable) {
      return {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        source: entry.source,
        status: "unavailable",
        filePath,
        updatedAt: "",
        lineCount: 0,
        unavailableReason: entry.unavailableReason || "目录不可访问。",
      }
    }
    try {
      const dirInfo = await stat(entry.path)
      check(dirInfo.isDirectory(), "路径不是目录。")
      await access(entry.path, constants.R_OK)
    } catch {
      return {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        source: entry.source,
        status: "unavailable",
        filePath,
        updatedAt: "",
        lineCount: 0,
        unavailableReason: "目录不存在或无读取权限。",
      }
    }

    try {
      const fileInfo = await stat(filePath)
      if (!fileInfo.isFile()) {
        return {
          id: entry.id,
          name: entry.name,
          path: entry.path,
          source: entry.source,
          status: "unavailable",
          filePath,
          updatedAt: "",
          lineCount: 0,
          unavailableReason: "目标路径存在同名非文件条目。",
        }
      }
      const raw = await readFile(filePath, "utf8")
      const normalizedFile = normalizeEol(raw)
      const normalizedTarget = normalizeEol(composedContent)
      const synced =
        normalizedTarget.length > 0 && normalizedFile === normalizedTarget
      return {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        source: entry.source,
        status: synced ? "synced" : "different",
        filePath,
        updatedAt: fileInfo.mtime.toISOString(),
        lineCount: countLines(normalizedFile),
        unavailableReason: "",
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          id: entry.id,
          name: entry.name,
          path: entry.path,
          source: entry.source,
          status: "missing",
          filePath,
          updatedAt: "",
          lineCount: 0,
          unavailableReason: "",
        }
      }
      return {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        source: entry.source,
        status: "unavailable",
        filePath,
        updatedAt: "",
        lineCount: 0,
        unavailableReason: "AGENTS.md 无法读取，请检查文件权限。",
      }
    }
  }

  async function buildStatus(state, signal) {
    const composedContent = composeAgentsContent(
      state.baseContent,
      state.snippets
    )
    const registered = await collectRegisteredProjects(state, signal)
    const projects = await Promise.all(
      registered.map((entry) => inspectProject(entry, composedContent, signal))
    )
    return {
      revision: state.revision,
      baseContent: state.baseContent,
      composedContent,
      updatedAt: state.updatedAt,
      snippets: state.snippets,
      projects,
    }
  }

  async function addDirectoryPath(inputPath, signal) {
    const canonical = await resolveDirectory(inputPath, signal)
    const { state } = await mutateState(async (current) => {
      const registered = await collectRegisteredProjects(current, signal)
      const key = pathKey(canonical)
      if (registered.some((item) => pathKey(item.path) === key)) {
        return { next: current, changed: false }
      }
      const next = {
        ...current,
        revision: current.revision + 1,
        customProjects: [
          ...current.customProjects,
          {
            id: randomUUID(),
            name: basename(canonical) || parse(canonical).root,
            path: canonical,
          },
        ],
      }
      return { next, changed: true }
    }, signal)
    return { canonical, status: await buildStatus(state, signal) }
  }

  const operation = (name, execute) => ({
    ...agentsMdOperations[name],
    execute: async (input, _context, signal) => ({
      value: await execute(input || {}, signal),
    }),
  })

  const publications = createPublications({
    directory: host.directory,
    withStateLock,
    readState,
    collectRegisteredProjects,
    composeAgentsContent,
    pathKey,
    ensureOpen,
  })

  return {
    operations: {
      status: operation("status", async (_input, signal) => {
        ensureOpen(signal)
        const state = await readState()
        return buildStatus(state, signal)
      }),
      saveBase: operation("saveBase", async (input, signal) => {
        ensureOpen(signal)
        check(
          typeof input.baseContent === "string" &&
            input.baseContent.length <= 500_000,
          "基础正文内容无效或超过长度限制。"
        )
        const { state } = await mutateState((current) => {
          check(
            input.revision === current.revision,
            "配置已被其他操作更新，请刷新后重试。"
          )
          const next = {
            ...current,
            revision: current.revision + 1,
            baseContent: normalizeEol(input.baseContent),
            updatedAt: new Date().toISOString(),
          }
          return { next, changed: true }
        }, signal)
        return buildStatus(state, signal)
      }),
      saveSnippets: operation("saveSnippets", async (input, signal) => {
        ensureOpen(signal)
        const sanitized = sanitizeSnippets(input.snippets)
        const { state } = await mutateState((current) => {
          check(
            input.revision === current.revision,
            "配置已被其他操作更新，请刷新后重试。"
          )
          const next = {
            ...current,
            revision: current.revision + 1,
            snippets: sanitized,
            updatedAt: new Date().toISOString(),
          }
          return { next, changed: true }
        }, signal)
        return buildStatus(state, signal)
      }),
      chooseDirectory: operation("chooseDirectory", async (_input, signal) => {
        ensureOpen(signal)
        check(
          typeof host.workspaces?.pickDirectory === "function",
          "系统目录选择器当前不可用。"
        )
        const picked = await host.workspaces.pickDirectory(signal)
        if (!picked) {
          const state = await readState()
          return {
            cancelled: true,
            addedPath: "",
            status: await buildStatus(state, signal),
          }
        }
        const { canonical, status } = await addDirectoryPath(picked, signal)
        return {
          cancelled: false,
          addedPath: canonical,
          status,
        }
      }),
      addDirectory: operation("addDirectory", async (input, signal) => {
        ensureOpen(signal)
        const { status } = await addDirectoryPath(input.path, signal)
        return status
      }),
      removeDirectory: operation("removeDirectory", async (input, signal) => {
        ensureOpen(signal)
        check(typeof input.id === "string" && input.id.trim(), "目录标识无效。")
        const { state } = await mutateState((current) => {
          check(
            input.revision === current.revision,
            "配置已被其他操作更新，请刷新后重试。"
          )
          const remaining = current.customProjects.filter(
            (item) => item.id !== input.id
          )
          check(
            remaining.length !== current.customProjects.length,
            "只能移除手动登记的目录。"
          )
          const next = {
            ...current,
            revision: current.revision + 1,
            customProjects: remaining,
          }
          return { next, changed: true }
        }, signal)
        return buildStatus(state, signal)
      }),
      readProject: operation("readProject", async (input, signal) => {
        ensureOpen(signal)
        check(
          typeof input.path === "string" && input.path.trim(),
          "项目路径无效。"
        )
        const state = await readState()
        const composedContent = composeAgentsContent(
          state.baseContent,
          state.snippets
        )
        const registered = await collectRegisteredProjects(state, signal)
        const key = pathKey(input.path)
        const entry = registered.find((item) => pathKey(item.path) === key)
        check(entry, "该项目未登记，无法读取。")
        const summary = await inspectProject(entry, composedContent, signal)
        if (summary.status === "unavailable") {
          throw new Error(summary.unavailableReason || "目标目录不可访问。")
        }
        if (summary.status === "missing") {
          return {
            id: summary.id,
            name: summary.name,
            path: summary.path,
            filePath: summary.filePath,
            status: "missing",
            exists: false,
            content: "",
            updatedAt: "",
            lineCount: 0,
            diff: buildLineDiff("", composedContent),
          }
        }
        const raw = await readFile(summary.filePath, "utf8")
        const normalized = normalizeEol(raw)
        return {
          id: summary.id,
          name: summary.name,
          path: summary.path,
          filePath: summary.filePath,
          status: summary.status,
          exists: true,
          content: normalized,
          updatedAt: summary.updatedAt,
          lineCount: countLines(normalized),
          diff: buildLineDiff(normalized, composedContent),
        }
      }),
      previewReplace: operation("previewReplace", publications.preview),
      replaceProjects: operation("replaceProjects", publications.publish),
      replaceResult: operation("replaceResult", publications.result),
    },
    status: () => "可用",
    close() {
      closed = true
    },
  }
}
