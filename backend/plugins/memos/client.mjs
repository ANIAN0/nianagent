import { readFile, stat } from "node:fs/promises"
import { basename } from "node:path"
import { saveDownload } from "../../download-file.mjs"
import { redactSensitive } from "../../redact.mjs"

export function normalizeBaseUrl(raw) {
  const text = String(raw || "").trim()
  if (!text) throw new Error("尚未配置 Memos 服务地址，请先在插件页填写。")
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw new Error("Memos 服务地址格式无效，请使用完整的 http(s):// 地址。")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("Memos 服务地址仅支持 http:// 或 https:// 协议。")
  return parsed.origin + parsed.pathname.replace(/\/+$/, "")
}

export function normalizeMemoId(id) {
  const text = String(id || "").trim()
  if (!text) throw new Error("memoId 不能为空。")
  return text.startsWith("memos/") ? text : `memos/${text}`
}

export function normalizeAttachmentId(id) {
  const text = String(id || "").trim()
  if (!text) throw new Error("attachmentId 不能为空。")
  return text.startsWith("attachments/") ? text : `attachments/${text}`
}

function escapeFilterLiteral(text) {
  return String(text || "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
}

const modernPrefix = "/api"
const legacyPrefix = "/api/v1"

function instanceContract(version) {
  const match = /^v?(0|26)\.(30|31|10|11)\.(0|[1-9]\d*)(?:\+[\w.-]+)?$/.exec(
    version
  )
  if (!match) return null
  const [, major, minor, patch] = match
  if (major === "0" && (minor === "30" || minor === "31"))
    return { prefix: legacyPrefix, commentsField: "memos" }
  if (major === "26" && (minor === "10" || minor === "11"))
    return {
      prefix: modernPrefix,
      commentsField: minor === "11" && Number(patch) >= 2 ? null : "comments",
    }
  return null
}

function isJson(response) {
  return /^application\/(?:json|[^;]+\+json)(?:\s*;|$)/i.test(
    response.headers.get("content-type") || ""
  )
}

function resourcePath(name) {
  const separator = name.indexOf("/")
  const id = name.slice(separator + 1)
  if (!id || id === "." || id === ".." || /[/\\]/.test(id))
    throw new Error("Memos 资源 ID 无效。")
  return `/${name.slice(0, separator)}/${encodeURIComponent(id)}`
}

async function readJson(response, action) {
  if (!isJson(response)) {
    await response.body?.cancel()
    throw new Error(
      `Memos ${action}返回非 JSON 响应，请检查实例地址与反向代理。`
    )
  }
  return response.json().catch((cause) => {
    if (cause?.name !== "SyntaxError") throw cause
    throw new Error(`Memos ${action}返回无效 JSON。`, { cause })
  })
}

async function httpError(response, action, token) {
  const { status } = response
  let detail = ""
  if (isJson(response)) {
    const payload = await response.json().catch(() => null)
    if (typeof payload?.message === "string")
      detail = `：${redactSensitive(payload.message.replaceAll(token, "[已隐藏]")).slice(0, 300)}`
  } else {
    await response.body?.cancel()
  }
  if (status === 401 || status === 403)
    return new Error(
      `Memos ${action}身份验证或授权失败（HTTP ${status}）${detail}`
    )
  if (status === 410)
    return new Error(
      `Memos ${action}路由已停用（HTTP 410），请核对实例版本与反向代理路由${detail}`
    )
  if (status >= 300 && status < 400)
    return new Error(
      `Memos ${action}收到重定向（HTTP ${status}），请配置直接可达的实例地址。`
    )
  if (status === 404 && isJson(response))
    return new Error(`Memos ${action}未找到目标资源（HTTP 404）${detail}`)
  if (status === 404)
    return new Error(
      `Memos ${action}路由不存在（HTTP 404），请检查实例地址与反向代理。`
    )
  return new Error(`Memos ${action}失败（HTTP ${status}）${detail}`)
}

function rejectTags(tags) {
  if (tags !== undefined)
    throw new Error(
      "Memos 从 Markdown 正文提取标签，请在 content 中使用 #标签。"
    )
}

function jsonBody(method, payload) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }
}

export function createMemosClient({ config, getToken }) {
  const execute = async (signal, action, run) => {
    const baseUrl = normalizeBaseUrl(config.instanceUrl)
    const token = getToken()
    if (!token)
      throw new Error("尚未配置 Memos Access Token，请先在插件页保存凭据。")

    const timeoutMs =
      Math.min(Math.max(Number(config.timeoutSeconds) || 30, 5), 120) * 1000
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const combined = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal

    const send = async (path, options = {}) => {
      combined.throwIfAborted()
      try {
        return await fetch(`${baseUrl}${path}`, {
          ...options,
          headers: { Authorization: `Bearer ${token}`, ...options.headers },
          signal: combined,
          redirect: options.redirect || "manual",
        })
      } catch (cause) {
        combined.throwIfAborted()
        throw new Error(`无法连接 Memos 服务（${baseUrl}）。`, { cause })
      }
    }

    try {
      let contract
      const outcomes = []
      // The only alternative requests are read-only instance profile lookups.
      for (const prefix of [modernPrefix, legacyPrefix]) {
        const response = await send(`${prefix}/instance/profile`)
        if (
          response.status === 404 ||
          response.status === 410 ||
          (response.ok && !isJson(response))
        ) {
          outcomes.push(
            `${prefix} HTTP ${response.status}${response.ok ? " 非 JSON" : ""}`
          )
          await response.body?.cancel()
          continue
        }
        if (!response.ok) throw await httpError(response, "读取实例版本", token)
        const profile = await readJson(response, "读取实例版本")
        contract =
          typeof profile?.version === "string" &&
          instanceContract(profile.version)
        if (!contract || contract.prefix !== prefix)
          throw new Error(
            "Memos 实例版本不受支持或与 API 路由不一致，请检查实例与反向代理。"
          )
        break
      }
      if (!contract)
        throw new Error(
          `无法识别 Memos 实例版本（${outcomes.join("、")}），请检查实例地址与反向代理。`
        )

      const request = async (path, options) => {
        const response = await send(path, options)
        if (!response.ok) throw await httpError(response, action, token)
        return response
      }
      return await run({
        contract,
        signal: combined,
        request,
        json: async (path, options) =>
          readJson(await request(contract.prefix + path, options), action),
      })
    } catch (cause) {
      signal?.throwIfAborted()
      if (timeoutSignal.aborted)
        throw new Error(`Memos ${action}超时（${timeoutMs / 1000} 秒）。`, {
          cause,
        })
      throw cause
    }
  }

  return {
    whoami(signal) {
      return execute(signal, "连接检测", async ({ json }) => {
        const { user } = await json("/auth/me")
        if (typeof user?.username !== "string" || !user.username)
          throw new Error("Memos 连接检测未返回已认证用户。")
        return user.username
      })
    },

    listMemos({ pageSize, pageToken, filter, sort } = {}, signal) {
      return execute(signal, "列出备忘录", async ({ json, contract }) => {
        const params = new URLSearchParams()
        const size = pageSize ?? config.defaultPageSize ?? 20
        if (size > 0) params.set("pageSize", String(size))
        if (pageToken) params.set("pageToken", pageToken)
        if (sort) params.set("orderBy", sort)
        if (contract.commentsField === null)
          params.set(
            "filter",
            filter ? `parent == null && (${filter})` : "parent == null"
          )
        else if (filter) params.set("filter", filter)
        const data = await json(`/memos?${params}`)
        return {
          memos: Array.isArray(data.memos) ? data.memos : [],
          ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
        }
      })
    },

    searchMemos({ query, pageSize }, signal) {
      return this.listMemos(
        {
          pageSize,
          filter: `content.contains("${escapeFilterLiteral(query)}")`,
        },
        signal
      )
    },

    getMemo(memoId, signal) {
      const path = resourcePath(normalizeMemoId(memoId))
      return execute(signal, "读取备忘录", ({ json }) => json(path))
    },

    createMemo({ content, visibility, tags }, signal) {
      if (tags?.length) rejectTags(tags)
      const payload = {
        content,
        visibility: visibility || config.defaultVisibility || "PRIVATE",
      }
      return execute(signal, "创建备忘录", ({ json }) =>
        json("/memos", jsonBody("POST", payload))
      )
    },

    updateMemo({ memoId, content, visibility, tags }, signal) {
      rejectTags(tags)
      const path = resourcePath(normalizeMemoId(memoId))
      const payload = {
        ...(content !== undefined ? { content } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
      }
      const mask = Object.keys(payload)
      if (!mask.length)
        throw new Error("更新备忘录时至少需要提供 content 或 visibility。")
      return execute(signal, "更新备忘录", ({ json }) =>
        json(`${path}?updateMask=${mask.join(",")}`, jsonBody("PATCH", payload))
      )
    },

    deleteMemo(memoId, signal) {
      const id = normalizeMemoId(memoId)
      const path = resourcePath(id)
      return execute(signal, "删除备忘录", async ({ request, contract }) => {
        const response = await request(contract.prefix + path, {
          method: "DELETE",
        })
        if (response.status !== 204) await readJson(response, "删除确认")
        return { deleted: true, memoId: id }
      })
    },

    listComments({ memoId, pageSize, pageToken }, signal) {
      const id = normalizeMemoId(memoId)
      const path = resourcePath(id)
      return execute(signal, "列出评论", async ({ json, contract }) => {
        const query = new URLSearchParams({
          pageSize: String(pageSize ?? config.defaultPageSize ?? 20),
        })
        if (pageToken) query.set("pageToken", pageToken)
        const { commentsField } = contract
        if (commentsField === null)
          query.set("filter", `parent == "${escapeFilterLiteral(id)}"`)
        const route = commentsField === null ? "/memos" : `${path}/comments`
        const data = await json(`${route}?${query}`)
        const comments = data[commentsField ?? "memos"]
        return {
          memoId: id,
          comments: Array.isArray(comments) ? comments : [],
          ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
        }
      })
    },

    createComment({ memoId, content }, signal) {
      const id = normalizeMemoId(memoId)
      const path = resourcePath(id)
      return execute(signal, "创建评论", ({ json, contract }) =>
        contract.commentsField === null
          ? json(
              "/memos",
              jsonBody("POST", { content, visibility: "PRIVATE", parent: id })
            )
          : json(
              `${path}/comments`,
              jsonBody("POST", { content, visibility: "PRIVATE" })
            )
      )
    },

    listAttachments({ pageSize, pageToken } = {}, signal) {
      const size = pageSize ?? config.defaultPageSize ?? 20
      const query = new URLSearchParams()
      if (size > 0) query.set("pageSize", String(size))
      if (pageToken) query.set("pageToken", pageToken)
      const suffix = query.size ? `?${query}` : ""
      return execute(signal, "列出附件", async ({ json }) => {
        const data = await json(`/attachments${suffix}`)
        return {
          attachments: Array.isArray(data.attachments) ? data.attachments : [],
          ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
        }
      })
    },

    uploadAttachment(localPath, signal) {
      return execute(signal, "上传附件", async ({ json, signal: active }) => {
        const info = await stat(localPath).catch(() => null)
        if (!info?.isFile())
          throw new Error(`本地文件不存在或不是常规文件：${localPath}`)
        const buffer = await readFile(localPath, { signal: active })
        return json(
          "/attachments",
          jsonBody("POST", {
            filename: basename(localPath),
            content: buffer.toString("base64"),
          })
        )
      })
    },

    downloadAttachment(attachmentId, localPath, signal) {
      const id = normalizeAttachmentId(attachmentId)
      const path = resourcePath(id)
      return execute(
        signal,
        "下载附件",
        async ({ json, request, signal: active }) => {
          const attachment = await json(path)
          const size = Number(attachment?.size)
          const filename = attachment?.filename
          if (
            attachment?.name !== id ||
            typeof filename !== "string" ||
            !filename ||
            !/^\d+$/.test(attachment.size) ||
            !Number.isSafeInteger(size)
          )
            throw new Error("Memos 下载附件返回无效的附件元数据。")
          if (attachment.externalLink)
            throw new Error("Memos 外部链接附件请从原地址下载。")
          const response = await request(
            `/file${path}/${encodeURIComponent(filename)}`,
            {
              redirect: "follow",
            }
          )
          const html = /^text\/html(?:;|$)/i.test(
            response.headers.get("content-type") || ""
          )
          if (
            response.status !== 200 ||
            !response.body ||
            (html &&
              !/^attachment(?:;|$)/i.test(
                response.headers.get("content-disposition") || ""
              ))
          ) {
            await response.body?.cancel()
            throw new Error(
              "Memos 下载附件未返回完整文件，请检查实例文件路由与反向代理。"
            )
          }
          const bytes = await saveDownload(
            response.body,
            localPath,
            active,
            size
          )
          return { attachmentId: id, savedPath: localPath, bytes }
        }
      )
    },

    deleteAttachment(attachmentId, signal) {
      const id = normalizeAttachmentId(attachmentId)
      const path = resourcePath(id)
      return execute(signal, "删除附件", async ({ request, contract }) => {
        const response = await request(contract.prefix + path, {
          method: "DELETE",
        })
        if (response.status !== 204) await readJson(response, "删除确认")
        return { deleted: true, attachmentId: id }
      })
    },
  }
}
