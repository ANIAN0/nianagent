// @ts-check
// UI 产物 ContentKind/Reader（T13）：自包含 HTML 包 + 显式 preview.json 路由清单。
// - 导入校验：恰一个根级 preview.json；路由必须映射到包内存在的文件；入口 "/" 必须声明
// - 派生：规范化 manifest 写入 .moon/reading.json（管线版本固定；历史阅读不重新解释）
// - 预览运行时（会话子域/桥注入/CSP）由 host 的 preview 会话模块消费本 reading
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { WorkbenchError } from "../errors.mjs"

export const UI_PIPELINE_VERSION = 1
const MAX_MANIFEST_ROUTES = 64

const safeName = (value) =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 256 &&
  !value.includes("..") &&
  !value.includes("\\") &&
  !/^[a-z]+:/i.test(value)

const hasControl = (value) =>
  [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
  )

export const validPreviewRoute = (route) => {
  if (!safeName(route) || !route.startsWith("/") || route.startsWith("//"))
    return false
  try {
    const url = new URL(route, "http://preview.localhost")
    if (
      url.origin !== "http://preview.localhost" ||
      url.pathname !== route ||
      url.search ||
      url.hash
    )
      return false
    return route.split("/").every((segment) => {
      const decoded = decodeURIComponent(segment)
      return (
        decoded !== "." &&
        decoded !== ".." &&
        !/[\\/]/.test(decoded) &&
        !hasControl(decoded)
      )
    })
  } catch {
    return false
  }
}

export const validPreviewFile = (file) =>
  safeName(file) &&
  !file.startsWith("/") &&
  !/[?#]/.test(file) &&
  !hasControl(file)

/** 校验 manifest：routes 为 端点→包内文件 映射；"/" 必须存在；文件必须真实存在。 */
export function parseManifest(raw, existingFiles) {
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (error) {
    throw new WorkbenchError(
      "unsupported_artifact",
      `preview.json 不是有效 JSON：${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new WorkbenchError("unsupported_artifact", "preview.json 结构无效。")
  const routes = manifest.routes
  if (!routes || typeof routes !== "object" || Array.isArray(routes))
    throw new WorkbenchError(
      "unsupported_artifact",
      "preview.json 缺少 routes 映射。"
    )
  const entries = Object.entries(routes)
  if (entries.length === 0)
    throw new WorkbenchError("unsupported_artifact", "routes 不能为空。")
  if (entries.length > MAX_MANIFEST_ROUTES)
    throw new WorkbenchError(
      "limit_exceeded",
      `路由数超过 ${MAX_MANIFEST_ROUTES}。`
    )
  const files = new Set(existingFiles)
  const normalized = {}
  for (const [route, file] of entries) {
    if (!validPreviewRoute(route))
      throw new WorkbenchError(
        "unsupported_artifact",
        `路由无效（需以 / 开头的站内路径）：${String(route).slice(0, 40)}`
      )
    if (!validPreviewFile(file))
      throw new WorkbenchError(
        "unsupported_artifact",
        `路由目标文件无效：${String(file).slice(0, 40)}`
      )
    if (!files.has(file))
      throw new WorkbenchError(
        "unsupported_artifact",
        `路由指向的文件不在包内：${file}`
      )
    normalized[route] = file
  }
  if (!normalized["/"])
    throw new WorkbenchError(
      "unsupported_artifact",
      'routes 必须声明入口 "/"。'
    )
  return { routes: normalized }
}

export const uiReader = {
  /** ui 包必须恰有一个根级 preview.json 路由清单；不猜测入口。 */
  validateEntries(entries) {
    const names = entries
      .filter(
        (entry) => !entry.path.includes("/") && entry.path === "preview.json"
      )
      .map((entry) => entry.path)
    if (names.length === 0)
      throw new WorkbenchError(
        "validation_failed",
        "ui 包缺少根级 preview.json 路由清单。"
      )
    if (names.length > 1)
      throw new WorkbenchError("validation_failed", "preview.json 入口不唯一。")
  },
  /** 封存前派生：解析并校验 manifest，写入 .moon/reading.json。 */
  async derive(stagingDir) {
    const manifestRaw = await readFile(join(stagingDir, "preview.json"), "utf8")
    const { readdir } = await import("node:fs/promises")
    const walk = async (prefix, dir) => {
      const found = []
      for (const name of await readdir(dir, { withFileTypes: true })) {
        if (name.isDirectory())
          found.push(
            ...(await walk(`${prefix}${name.name}/`, join(dir, name.name)))
          )
        else found.push(`${prefix}${name.name}`)
      }
      return found
    }
    const files = await walk("", stagingDir)
    const manifest = parseManifest(manifestRaw, files)
    await mkdir(join(stagingDir, ".moon"), { recursive: true })
    const reading = {
      pipeline: UI_PIPELINE_VERSION,
      kind: "ui",
      entry: "preview.json",
      manifest,
    }
    await writeFile(
      join(stagingDir, ".moon", "reading.json"),
      JSON.stringify(reading)
    )
    return { entry: ".moon/reading.json", reading }
  },
}
