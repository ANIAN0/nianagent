import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { posix } from "node:path"
import { saveDownload } from "../../download-file.mjs"
import { redactSensitive } from "../../redact.mjs"

const MAX_READ_TEXT_BYTES = 256 * 1024

export function normalizeBaseUrl(raw) {
  const text = String(raw || "").trim()
  if (!text) throw new Error("尚未配置 FileBrowser 服务地址，请先在插件页填写。")
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw new Error(
      "FileBrowser 服务地址格式无效，请使用完整的 http(s):// 地址。"
    )
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("FileBrowser 服务地址仅支持 http:// 或 https:// 协议。")
  return parsed.origin + parsed.pathname.replace(/\/+$/, "")
}

export function normalizeRootPrefix(raw) {
  const text = String(raw || "/").trim().replaceAll("\\", "/")
  if (!text || text === "/") return "/"
  const normalized = posix.normalize(text.startsWith("/") ? text : `/${text}`)
  if (normalized === "/" || normalized === ".") return "/"
  return normalized.replace(/\/+$/, "")
}

export function resolveRemotePath(rawPath, rootPrefix = "/") {
  const prefix = normalizeRootPrefix(rootPrefix)
  const text = String(rawPath ?? "/").trim().replaceAll("\\", "/")
  const candidate = text ? (text.startsWith("/") ? text : `/${text}`) : "/"
  const segments = candidate.split("/")
  if (segments.includes(".."))
    throw new Error("远程路径不允许包含 .. 目录跳转。")
  const normalized = posix.normalize(candidate).replace(/\/+$/, "") || "/"
  if (prefix === "/") return normalized
  if (normalized === prefix || normalized.startsWith(`${prefix}/`))
    return normalized
  if (normalized === "/") return prefix
  throw new Error(`远程路径超出允许范围（仅允许访问 ${prefix} 及其子路径）。`)
}

function encodeRemotePath(remotePath, trailingSlash = false) {
  const clean = remotePath === "/" ? "" : remotePath.replace(/^\/+/, "")
  const encoded = clean
    ? `/${clean.split("/").map((seg) => encodeURIComponent(seg)).join("/")}`
    : "/"
  if (trailingSlash && !encoded.endsWith("/")) return `${encoded}/`
  return encoded
}

function buildResourceUrl(prefix, remotePath, query, trailingSlash = false) {
  const pathPart = encodeRemotePath(remotePath, trailingSlash)
  const search = query ? query.toString() : ""
  return `${prefix}${pathPart}${search ? `?${search}` : ""}`
}

function decodeJwtUsername(token) {
  const parts = String(token || "").split(".")
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    )
    const username = payload?.user?.username
    return typeof username === "string" && username ? username : null
  } catch {
    return null
  }
}

async function readErrorSnippet(response) {
  try {
    const raw = (await response.text()).trim()
    if (!raw) return ""
    return redactSensitive(raw).slice(0, 300)
  } catch {
    return ""
  }
}

function classifyHttpError(action, status, snippet, baseUrl) {
  const detail = snippet ? `：${snippet}` : ""
  if (status === 401 || status === 403)
    return new Error(
      `FileBrowser ${action}认证失败（HTTP ${status}），请检查插件页中的账号和密码${detail}`
    )
  if (status === 404)
    return new Error(`FileBrowser ${action}未找到目标路径（HTTP 404）${detail}`)
  if (status === 409)
    return new Error(
      `FileBrowser ${action}发生路径冲突（HTTP 409），如需覆盖请显式传 override: true${detail}`
    )
  if (status >= 500)
    return new Error(
      `FileBrowser 服务端异常（HTTP ${status}，实例 ${baseUrl}）${detail}`
    )
  return new Error(`FileBrowser ${action}失败（HTTP ${status}）${detail}`)
}

function parseSseResults(text) {
  const results = []
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) continue
    const payload = trimmed.slice(5).trim()
    if (!payload) continue
    try {
      const parsed = JSON.parse(payload)
      if (parsed && typeof parsed.path === "string") {
        results.push({
          path: parsed.path,
          dir: Boolean(parsed.dir),
        })
      }
    } catch {
      /* ignore non-JSON SSE heartbeat/data frames */
    }
  }
  return results
}

export function createFileBrowserClient({ getConfig, getCredentials }) {
  let token = ""
  let loginPending = null

  const clearToken = () => {
    token = ""
  }

  const doFetch = async (action, path, options = {}) => {
    const config = getConfig()
    const baseUrl = normalizeBaseUrl(config.instanceUrl)
    const timeoutMs =
      Math.min(Math.max(Number(config.timeoutSeconds) || 60, 5), 300) * 1000
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal

    try {
      return await fetch(`${baseUrl}${path}`, {
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body,
        duplex: options.duplex,
        signal,
        redirect: "follow",
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (timeoutSignal.aborted || error?.name === "TimeoutError")
        throw new Error(
          `FileBrowser ${action}超时（${timeoutMs / 1000} 秒）：${baseUrl}`,
          { cause: error }
        )
      throw new Error(
        `无法连接 FileBrowser 服务（${baseUrl}）：${redactSensitive(error?.message || "网络错误")}`,
        { cause: error }
      )
    }
  }

  const login = async (signal) => {
    if (loginPending) return loginPending
    const creds = getCredentials()
    if (!creds?.username || !creds?.password) {
      throw new Error(
        "尚未配置 FileBrowser 登录凭据，请先在插件页保存用户名和密码。"
      )
    }
    const baseUrl = normalizeBaseUrl(getConfig().instanceUrl)
    loginPending = (async () => {
      const response = await doFetch("登录", "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: creds.username,
          password: creds.password,
        }),
        signal,
      })
      if (!response.ok) {
        const snippet = await readErrorSnippet(response)
        throw classifyHttpError("登录", response.status, snippet, baseUrl)
      }
      const nextToken = (await response.text()).trim()
      if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(nextToken))
        throw new Error("FileBrowser 登录未返回预期的 JWT。请检查实例地址和登录方式。")
      token = nextToken
      return nextToken
    })().finally(() => {
      loginPending = null
    })
    return loginPending
  }

  const authedRequest = async (action, path, options = {}) => {
    const config = getConfig()
    const baseUrl = normalizeBaseUrl(config.instanceUrl)
    if (!token) await login(options.signal)

    const runOnce = async () =>
      doFetch(action, path, {
        ...options,
        body:
          typeof options.bodyFactory === "function"
            ? options.bodyFactory()
            : options.body,
        headers: {
          "X-Auth": token,
          ...(options.headers || {}),
        },
      })

    let response = await runOnce()
    if (response.status === 401 && options.retryAuth !== false) {
      token = ""
      await login(options.signal)
      response = await runOnce()
    }

    const expected = options.expectedStatuses || [200]
    if (!expected.includes(response.status)) {
      const snippet = await readErrorSnippet(response)
      throw classifyHttpError(action, response.status, snippet, baseUrl)
    }
    return response
  }

  const authedJson = async (action, path, options = {}) => {
    const response = await authedRequest(action, path, options)
    const text = await response.text()
    if (!text.trim()) return {}
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`FileBrowser ${action}返回了非 JSON 响应。`)
    }
  }

  const remote = (rawPath) =>
    resolveRemotePath(rawPath, getConfig().rootPrefix || "/")

  return {
    clearToken,

    async testLogin(signal) {
      token = ""
      const jwt = await login(signal)
      const creds = getCredentials()
      return decodeJwtUsername(jwt) || creds?.username || "已认证"
    },

    async listDir(rawPath = "/", signal) {
      const target = remote(rawPath)
      const data = await authedJson(
        "列出目录",
        buildResourceUrl("/api/resources", target),
        { signal }
      )
      return {
        path: data.path || target,
        isDir: Boolean(data.isDir),
        numDirs: Number(data.numDirs) || 0,
        numFiles: Number(data.numFiles) || 0,
        items: Array.isArray(data.items)
          ? data.items.map((item) => ({
              name: item.name,
              path: item.path,
              isDir: Boolean(item.isDir),
              size: Number(item.size) || 0,
              modified: item.modified || "",
              type: item.type || "",
              extension: item.extension || "",
            }))
          : [],
      }
    },

    async getInfo(rawPath, signal) {
      const target = remote(rawPath)
      const q = new URLSearchParams({ checksum: "sha256" })
      return authedJson(
        "读取路径详情",
        buildResourceUrl("/api/resources", target, q),
        { signal }
      )
    },

    async tree({ path = "/", maxDepth = 3, maxEntries = 200 } = {}, signal) {
      const rootPath = remote(path)
      const depthLimit = Math.min(Math.max(Number(maxDepth) || 3, 1), 6)
      const entryLimit = Math.min(Math.max(Number(maxEntries) || 200, 1), 1000)
      let count = 0
      let truncated = false

      const walk = async (currentPath, depth) => {
        const listing = await this.listDir(currentPath, signal)
        const children = []
        for (const item of listing.items) {
          if (count >= entryLimit) {
            truncated = true
            break
          }
          count++
          const node = {
            name: item.name,
            path: item.path,
            isDir: item.isDir,
            size: item.size,
          }
          if (item.isDir && depth < depthLimit) {
            node.children = await walk(item.path, depth + 1)
          }
          children.push(node)
        }
        return children
      }

      const nodes = await walk(rootPath, 1)
      return {
        path: rootPath,
        maxDepth: depthLimit,
        totalEntries: count,
        truncated,
        items: nodes,
      }
    },

    async readTextFile(rawPath, signal) {
      const target = remote(rawPath)
      const info = await this.getInfo(target, signal)
      if (info.isDir)
        throw new Error(`目标路径是目录，无法按文本文件读取：${target}`)
      if (typeof info.size === "number" && info.size > MAX_READ_TEXT_BYTES) {
        throw new Error(
          `文件体积 ${info.size} 字节超过只读文本上限（256 KiB），请改用 download_file 下载后读取。`
        )
      }
      const response = await authedRequest(
        "读取文本文件",
        buildResourceUrl("/api/raw", target),
        { signal }
      )
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > MAX_READ_TEXT_BYTES) {
        throw new Error(
          `文件体积 ${buffer.byteLength} 字节超过只读文本上限（256 KiB），请改用 download_file 下载后读取。`
        )
      }
      if (buffer.includes(0)) {
        throw new Error(
          `目标文件包含二进制字节，不适合作为文本返回：${target}，请改用 download_file。`
        )
      }
      return {
        path: target,
        bytes: buffer.byteLength,
        content: buffer.toString("utf8"),
      }
    },

    async searchFiles({ query, path = "/", limit = 50 }, signal) {
      const target = remote(path)
      const maxItems = Math.min(Math.max(Number(limit) || 50, 1), 200)
      const q = new URLSearchParams({ query: String(query || "") })
      const response = await authedRequest(
        "搜索文件",
        buildResourceUrl("/api/search", target, q),
        { signal }
      )
      const raw = await response.text()
      const parsed = parseSseResults(raw)
      return {
        path: target,
        query,
        total: parsed.length,
        truncated: parsed.length > maxItems,
        results: parsed.slice(0, maxItems),
      }
    },

    async mkdir(rawPath, signal) {
      const target = remote(rawPath)
      await authedRequest(
        "创建目录",
        buildResourceUrl("/api/resources", target, null, true),
        {
          method: "POST",
          expectedStatuses: [200, 201],
          signal,
        }
      )
      return { created: true, path: target }
    },

    async uploadFile({ localPath, remotePath, override = false }, signal) {
      const target = remote(remotePath)
      const info = await stat(localPath).catch(() => null)
      if (!info || !info.isFile())
        throw new Error(`本地文件不存在或不是常规文件：${localPath}`)
      const q = new URLSearchParams({ override: override ? "true" : "false" })
      await authedRequest(
        "上传文件",
        buildResourceUrl("/api/resources", target, q),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(info.size),
          },
          bodyFactory: () => createReadStream(localPath),
          duplex: "half",
          expectedStatuses: [200, 201],
          signal,
        }
      )
      return { uploaded: true, remotePath: target, bytes: info.size }
    },

    async downloadFile({ remotePath, localPath }, signal) {
      const target = remote(remotePath)
      const response = await authedRequest(
        "下载文件",
        buildResourceUrl("/api/raw", target),
        { signal }
      )
      if (!response.body) throw new Error("FileBrowser 下载响应缺少文件流。")
      const bytes = await saveDownload(response.body, localPath, signal)
      return { remotePath: target, savedPath: localPath, bytes }
    },

    async movePath({ src, dst }, signal) {
      const from = remote(src)
      const to = remote(dst)
      const q = new URLSearchParams({ action: "rename", destination: to })
      await authedRequest(
        "移动/重命名路径",
        buildResourceUrl("/api/resources", from, q),
        {
          method: "PATCH",
          expectedStatuses: [200, 204],
          signal,
        }
      )
      return { moved: true, src: from, dst: to }
    },

    async copyPath({ src, dst }, signal) {
      const from = remote(src)
      const to = remote(dst)
      const q = new URLSearchParams({ action: "copy", destination: to })
      await authedRequest(
        "复制路径",
        buildResourceUrl("/api/resources", from, q),
        {
          method: "PATCH",
          expectedStatuses: [200, 204],
          signal,
        }
      )
      return { copied: true, src: from, dst: to }
    },

    async deletePath(rawPath, signal) {
      const target = remote(rawPath)
      const prefix = normalizeRootPrefix(getConfig().rootPrefix || "/")
      if (target === "/" || target === prefix) {
        throw new Error(`禁止删除受保护的根目录：${target}`)
      }
      await authedRequest(
        "删除路径",
        buildResourceUrl("/api/resources", target),
        {
          method: "DELETE",
          expectedStatuses: [200, 204],
          signal,
        }
      )
      return { deleted: true, path: target }
    },

    async listShares(rawPath, signal) {
      if (rawPath) {
        const target = remote(rawPath)
        const data = await authedJson(
          "读取路径分享",
          buildResourceUrl("/api/share", target),
          { signal }
        )
        return { path: target, shares: Array.isArray(data) ? data : [] }
      }
      const data = await authedJson("列出全部分享", "/api/shares", { signal })
      return { shares: Array.isArray(data) ? data : [] }
    },

    async createShare({ path, expires, unit, password }, signal) {
      const config = getConfig()
      const target = remote(path)
      const baseUrl = normalizeBaseUrl(config.instanceUrl)
      const body = {
        expires: String(expires ?? config.defaultShareExpires ?? 24),
        unit: unit || config.defaultShareUnit || "hours",
        ...(password ? { password } : {}),
      }
      const share = await authedJson(
        "创建分享链接",
        buildResourceUrl("/api/share", target),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        }
      )
      return {
        share,
        url: share?.hash ? `${baseUrl}/share/${share.hash}` : "",
      }
    },

    async deleteShare(hash, signal) {
      const clean = String(hash || "").trim()
      if (!clean) throw new Error("分享 hash 不能为空。")
      await authedRequest(
        "删除分享链接",
        `/api/share/${encodeURIComponent(clean)}`,
        {
          method: "DELETE",
          expectedStatuses: [200, 204],
          signal,
        }
      )
      return { deleted: true, hash: clean }
    },
  }
}
