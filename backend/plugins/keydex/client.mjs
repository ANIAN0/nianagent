import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { redactSensitive } from "../../redact.mjs"

const execFileAsync = promisify(execFile)

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

const READ_ONLY_POST_SUFFIXES = [
  "/query",
  "/list",
  "/search",
  "/options",
  "/detail",
  "/tree",
  "/read",
  "/overview",
  "/context",
  "/summary",
  "/status",
  "/filter-options",
  "/link-candidates",
  "/link-projects",
  "/mention-candidates",
  "/node-candidates",
  "/runtime-schema",
  "/resolve",
  "/resolve-url",
  "/check",
  "/mine",
  "/changes",
  "/version-diff",
  "/child-progress",
  "/result-issues",
  "/form-changes",
  "/scan-issues",
  "/member-detail",
  "/children",
  "/cover",
]

export function normalizeBaseUrl(raw) {
  const trimmed = String(raw || "").trim()
  if (!trimmed) return ""
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`Keydex 服务地址无效：${trimmed}`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Keydex 服务地址必须使用 http:// 或 https:// 协议。")
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `出于安全限制，Keydex 插件仅允许连接本机回环地址（127.0.0.1 / localhost），当前为 ${parsed.hostname}。`
    )
  }
  return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "")
}

export function normalizeApiPath(rawPath) {
  const trimmed = String(rawPath || "").trim()
  if (!trimmed) throw new Error("path 不能为空。")
  if (/[\\#]/.test(trimmed) || /%2e/i.test(trimmed) || trimmed.includes("..")) {
    throw new Error("接口路径包含不允许的字符或路径遍历片段。")
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  let parsed
  try {
    parsed = new URL(withLeadingSlash, "http://127.0.0.1")
  } catch {
    throw new Error(`接口路径无效：${trimmed}`)
  }
  if (
    parsed.origin !== "http://127.0.0.1" ||
    !parsed.pathname.startsWith("/api/")
  ) {
    throw new Error("仅允许访问 /api/ 开头的 Keydex 本地接口路径。")
  }
  return `${parsed.pathname}${parsed.search}`
}

export function isReadOnlyApiPath(method, path) {
  const upper = String(method || "GET").toUpperCase()
  if (upper === "GET" || upper === "HEAD") return true
  if (upper !== "POST") return false
  const cleanPath = path.split("?")[0].replace(/\/+$/, "")
  return READ_ONLY_POST_SUFFIXES.some((suffix) => cleanPath.endsWith(suffix))
}

function normalizeWinPath(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase()
}

function parsePortFromCommandLine(commandLine) {
  const text = String(commandLine || "")
  const match = text.match(/--port(?:=|\s+)(\d{2,5})\b/i)
  if (!match) return null
  const port = Number(match[1])
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

function parseDataDirFromCommandLine(commandLine) {
  const text = String(commandLine || "")
  const match = text.match(/--data-dir(?:=|\s+)(?:"([^"]+)"|(\S+))/i)
  return match ? (match[1] || match[2] || "").trim() : ""
}

export async function discoverKeydexServer(installDir, signal) {
  if (process.platform !== "win32") {
    throw new Error(
      "自动发现 Keydex 进程仅支持 Windows；请手动填写 Keydex 固定服务地址。"
    )
  }

  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='agent-server.exe'\" | Select-Object ProcessId, ExecutablePath, CommandLine | ConvertTo-Json -Compress"
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      signal,
    }
  )

  const trimmed = String(stdout || "").trim()
  if (!trimmed) {
    throw new Error(
      "未发现正在运行的 Keydex agent-server.exe 进程，请先启动 Keydex 客户端，或在插件配置中手动填写服务地址。"
    )
  }

  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error("解析 Keydex 进程信息失败。")
  }

  const list = Array.isArray(parsed) ? parsed : [parsed]
  const candidates = list
    .map((item) => {
      const port = parsePortFromCommandLine(item?.CommandLine)
      if (!port) return null
      return {
        pid: Number(item?.ProcessId) || null,
        executablePath: String(item?.ExecutablePath || ""),
        commandLine: String(item?.CommandLine || ""),
        dataDir: parseDataDirFromCommandLine(item?.CommandLine),
        port,
        baseUrl: `http://127.0.0.1:${port}`,
      }
    })
    .filter(Boolean)

  if (!candidates.length) {
    throw new Error(
      "发现 agent-server.exe 进程但未能识别 --port 监听端口，请在插件配置中手动填写服务地址。"
    )
  }

  const normalizedInstallDir = normalizeWinPath(installDir)
  if (normalizedInstallDir) {
    const matched = candidates.find((item) => {
      const exe = normalizeWinPath(item.executablePath)
      const cmd = normalizeWinPath(item.commandLine)
      return (
        exe.startsWith(normalizedInstallDir) ||
        cmd.includes(normalizedInstallDir)
      )
    })
    if (matched) return matched
  }

  return candidates[0]
}

function extractErrorMessage(status, payload, rawText) {
  if (payload && typeof payload === "object") {
    const detail = payload.detail
    if (typeof detail === "string" && detail.trim()) {
      return `Keydex HTTP ${status}：${detail.trim()}`
    }
    if (detail && typeof detail === "object") {
      const code = detail.code ? `[${detail.code}] ` : ""
      const message = detail.message || detail.error || ""
      const errors = detail.details?.errors
      const extra =
        Array.isArray(errors) && errors.length
          ? ` (${errors
              .slice(0, 3)
              .map((item) => {
                const loc = Array.isArray(item?.loc) ? item.loc.join(".") : ""
                return loc ? `${loc}: ${item?.msg || ""}` : item?.msg || ""
              })
              .filter(Boolean)
              .join("; ")})`
          : ""
      if (message || code) {
        return `Keydex HTTP ${status}：${code}${message}${extra}`.trim()
      }
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return `Keydex HTTP ${status}：${payload.message.trim()}`
    }
  }
  const snippet = String(rawText || "")
    .trim()
    .slice(0, 300)
  return snippet
    ? `Keydex HTTP ${status}：${snippet}`
    : `Keydex 请求失败（HTTP ${status}）。`
}

function isNetworkFailure(error) {
  if (!error) return false
  if (error.name === "AbortError" || error.name === "TimeoutError") return false
  const msg = String(error.message || "")
  return (
    error instanceof TypeError ||
    /ECONNREFUSED|fetch failed|socket|network|ECONNRESET/i.test(msg)
  )
}

function cleanObject(input) {
  const out = {}
  for (const [key, value] of Object.entries(input || {})) {
    if (value !== undefined) out[key] = value
  }
  return out
}

function buildQueryString(params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          search.append(key, String(item))
        }
      }
    } else {
      search.set(key, String(value))
    }
  }
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ""
}

export function createKeydexClient({ config }) {
  let cachedEndpoint = null

  const resolveEndpoint = async (signal, forceRefresh = false) => {
    const manual = normalizeBaseUrl(config.baseUrl)
    if (manual) {
      return {
        baseUrl: manual,
        source: "configured",
        pid: null,
      }
    }
    if (!forceRefresh && cachedEndpoint) return cachedEndpoint
    const discovered = await discoverKeydexServer(config.installDir, signal)
    cachedEndpoint = {
      baseUrl: discovered.baseUrl,
      source: "discovered",
      pid: discovered.pid,
    }
    return cachedEndpoint
  }

  const request = async (
    method,
    rawPath,
    { query, body, signal, forceRefresh = false } = {}
  ) => {
    const path = normalizeApiPath(rawPath)
    const upperMethod = String(method || "GET").toUpperCase()
    const timeoutMs = Math.max(
      5000,
      (Number(config.timeoutSeconds) || 30) * 1000
    )

    const buildRequestUrl = (baseUrl) => {
      const target = new URL(path, baseUrl)
      if (query) {
        const extra = new URLSearchParams(buildQueryString(query).slice(1))
        for (const [key, value] of extra.entries()) {
          target.searchParams.append(key, value)
        }
      }
      return target.toString()
    }

    const executeOnce = async (endpoint) => {
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal

      const headers = { Accept: "application/json" }
      let payloadBody
      if (
        body !== undefined &&
        upperMethod !== "GET" &&
        upperMethod !== "HEAD"
      ) {
        headers["Content-Type"] = "application/json"
        payloadBody = JSON.stringify(body)
      }

      const response = await fetch(buildRequestUrl(endpoint.baseUrl), {
        method: upperMethod,
        headers,
        body: payloadBody,
        signal: combinedSignal,
      })

      if (response.status === 204) return { ok: true, status: 204 }

      const contentType = response.headers.get("content-type") || ""
      const text = await response.text()
      let data = null
      if (text && contentType.includes("application/json")) {
        try {
          data = JSON.parse(text)
        } catch {
          data = null
        }
      } else if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
      }

      if (!response.ok) {
        const message = extractErrorMessage(response.status, data, text)
        const error = new Error(redactSensitive(message))
        error.status = response.status
        throw error
      }
      return data
    }

    let endpoint = await resolveEndpoint(signal, forceRefresh)
    try {
      return await executeOnce(endpoint)
    } catch (error) {
      if (
        endpoint.source === "discovered" &&
        !forceRefresh &&
        isNetworkFailure(error) &&
        !signal?.aborted
      ) {
        cachedEndpoint = null
        endpoint = await resolveEndpoint(signal, true)
        return await executeOnce(endpoint)
      }
      throw error
    }
  }

  return {
    resolveEndpoint,
    invalidateCache() {
      cachedEndpoint = null
    },
    request,

    async getStatus(signal, forceRefresh = false) {
      const endpoint = await resolveEndpoint(signal, forceRefresh)
      const [identity, pmAuth] = await Promise.allSettled([
        request("GET", "/api/modules/identity/status", { signal }),
        request("GET", "/api/modules/project/auth/status", { signal }),
      ])
      signal?.throwIfAborted()
      if (identity.status === "rejected" && pmAuth.status === "rejected")
        throw identity.reason
      return {
        endpoint,
        identity:
          identity.status === "fulfilled"
            ? identity.value
            : { state: "error", error: identity.reason.message },
        pmAuth:
          pmAuth.status === "fulfilled"
            ? pmAuth.value
            : { state: "ERROR", error: pmAuth.reason.message },
      }
    },

    pmListProjects(signal) {
      return request("GET", "/api/modules/project/projects/options", { signal })
    },

    pmQueryWorkbench(input, signal) {
      const body = cleanObject({
        stateCategory: input.stateCategory || "doing",
        keyword: input.keyword,
        projectKeys: input.projectKeys,
        itemTypes: input.itemTypes,
        issueTypes: input.issueTypes,
        priorities: input.priorities,
        dueDateFrom: input.dueDateFrom,
        dueDateTo: input.dueDateTo,
        page: input.page ?? 1,
        // Keydex personal workbench API strictly requires pageSize === 50.
        pageSize: 50,
      })
      return request(
        "POST",
        "/api/modules/project/personal-workbench/items/query",
        { body, signal }
      )
    },

    async pmGetProjectMetadata(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const includeMembers = input.includeMembers !== false
      const includeFieldMetadata = Boolean(input.includeFieldMetadata)
      const [lookups, members, fieldMetadata] = await Promise.all([
        request(
          "GET",
          `/api/modules/project/projects/${projectKey}/issue-lookups`,
          { signal }
        ),
        includeMembers
          ? request(
              "GET",
              `/api/modules/project/projects/${projectKey}/members`,
              { signal }
            )
          : Promise.resolve(undefined),
        includeFieldMetadata
          ? request(
              "GET",
              `/api/modules/project/projects/${projectKey}/issues/field-metadata`,
              { signal }
            )
          : Promise.resolve(undefined),
      ])
      return cleanObject({
        projectKey: input.projectKey,
        lookups,
        members,
        fieldMetadata,
      })
    },

    pmQueryIssues(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const body = cleanObject({
        keyword: input.keyword,
        filters: input.filters,
        sorts: input.sorts,
        stateSelection: input.stateSelection,
        page: input.page ?? 1,
        pageSize: input.pageSize ?? 20,
      })
      return request(
        "POST",
        `/api/modules/project/projects/${projectKey}/issues/query`,
        { body, signal }
      )
    },

    async pmGetIssue(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const issueId = encodeURIComponent(String(input.issueId).trim())
      const [issue, comments, activity] = await Promise.all([
        request(
          "GET",
          `/api/modules/project/projects/${projectKey}/issues/${issueId}`,
          { signal }
        ),
        input.includeComments
          ? request(
              "GET",
              `/api/modules/project/projects/${projectKey}/issues/${issueId}/comments`,
              { signal }
            )
          : Promise.resolve(undefined),
        input.includeActivity
          ? request(
              "GET",
              `/api/modules/project/projects/${projectKey}/issues/${issueId}/activity`,
              { signal }
            )
          : Promise.resolve(undefined),
      ])
      return cleanObject({ issue, comments, activity })
    },

    pmQueryIterations(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const body = cleanObject({
        keyword: input.keyword,
        includeArchived: input.includeArchived ?? false,
        page: input.page ?? 1,
        pageSize: input.pageSize ?? 20,
      })
      return request(
        "POST",
        `/api/modules/project/projects/${projectKey}/iterations/query`,
        { body, signal }
      )
    },

    pmQueryDocs(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const body = cleanObject({
        keyword: input.keyword,
        folderId: input.folderId,
        tagId: input.tagId,
        iterationId: input.iterationId,
        page: input.page ?? 1,
        pageSize: input.pageSize ?? 20,
      })
      return request(
        "POST",
        `/api/modules/project/projects/${projectKey}/docs/query`,
        { body, signal }
      )
    },

    pmGetDoc(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const docId = encodeURIComponent(String(input.docId).trim())
      return request(
        "GET",
        `/api/modules/project/projects/${projectKey}/docs/${docId}`,
        { signal }
      )
    },

    pmQueryAffairs(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const kind = String(input.kind)
      const body = cleanObject({
        keyword: input.keyword,
        iterationId: input.iterationId,
        statuses: input.statuses,
        status: input.status,
        priority: input.priority,
        level: input.level,
        assigneeUserId: input.assigneeUserId,
        meetingType: input.meetingType,
        versionNo: input.versionNo,
        issueId: input.issueId,
        page: input.page ?? 1,
        pageSize: input.pageSize ?? 30,
      })
      return request(
        "POST",
        `/api/modules/project/projects/${projectKey}/${kind}/query`,
        { body, signal }
      )
    },

    pmCreateIssue(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const body = cleanObject({
        issueType: input.issueType,
        title: input.title,
        iterationId: input.iterationId,
        priority: input.priority,
        parentId: input.parentId,
        assigneeUserId: input.assigneeUserId,
        contentText: input.contentText,
        endDate: input.endDate,
        stateId: input.stateId,
        customFields: input.customFields,
      })
      return request(
        "POST",
        `/api/modules/project/projects/${projectKey}/issues`,
        { body, signal }
      )
    },

    pmUpdateIssue(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const issueId = encodeURIComponent(String(input.issueId).trim())
      const body = cleanObject({
        title: input.title,
        priority: input.priority,
        assigneeUserId: input.assigneeUserId,
        fixerUserId: input.fixerUserId,
        verifierUserId: input.verifierUserId,
        startDate: input.startDate,
        endDate: input.endDate,
        estimateHours: input.estimateHours,
        actualHours: input.actualHours,
        customFields: input.customFields,
      })
      return request(
        "PATCH",
        `/api/modules/project/projects/${projectKey}/issues/${issueId}`,
        { body, signal }
      )
    },

    pmTransitionIssue(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const issueId = encodeURIComponent(String(input.issueId).trim())
      return request(
        "POST",
        `/api/modules/project/projects/${projectKey}/issues/${issueId}/transition`,
        { body: { toStateId: input.toStateId }, signal }
      )
    },

    pmAddIssueComment(input, signal) {
      const projectKey = encodeURIComponent(String(input.projectKey).trim())
      const issueId = encodeURIComponent(String(input.issueId).trim())
      const body = cleanObject({
        contentText: input.contentText,
        parentId: input.parentId,
        mentionUserIds: input.mentionUserIds,
      })
      return request(
        "POST",
        `/api/modules/project/projects/${projectKey}/issues/${issueId}/comments`,
        { body, signal }
      )
    },

    kbListSpaces(signal) {
      return request("GET", "/api/modules/kb/spaces", { signal })
    },

    kbSearch(input, signal) {
      const body = cleanObject({
        query: input.query,
        space_id: input.spaceId,
      })
      return request("POST", "/api/modules/kb/search", { body, signal })
    },

    kbGetTree(input, signal) {
      const spaceId = encodeURIComponent(String(input.spaceId).trim())
      return request("POST", `/api/modules/kb/spaces/${spaceId}/tree`, {
        body: {},
        signal,
      })
    },

    kbReadFile(input, signal) {
      const nodeId = encodeURIComponent(String(input.nodeId).trim())
      const body = cleanObject({
        offset: input.offset ?? 0,
        limit: input.limit ?? 200,
      })
      return request("POST", `/api/modules/kb/files/${nodeId}/read`, {
        body,
        signal,
      })
    },

    collaborationQueryItems(input, signal) {
      const body = cleanObject({
        keyword: input.keyword,
        space_key: input.spaceKey,
        status: input.status,
        page: input.page,
        page_size: input.pageSize,
      })
      return request("POST", "/api/modules/collaboration/items/query", {
        body,
        signal,
      })
    },

    noticeList(input, signal) {
      return request("GET", "/api/modules/notice/notices", {
        query: {
          cursor: input.cursor ?? 0,
          limit: input.limit ?? 20,
          unread_only: input.unreadOnly ?? false,
        },
        signal,
      })
    },

    apiRead(input, signal) {
      const method = String(input.method || "GET").toUpperCase()
      const path = normalizeApiPath(input.path)
      if (!isReadOnlyApiPath(method, path)) {
        throw new Error(
          `api_read 仅允许 GET 或只读查询型 POST（如 /query、/search、/list、/detail、/tree、/read），当前请求 ${method} ${path} 请使用 api_write。`
        )
      }
      return request(method, path, {
        query: input.query,
        body: input.body,
        signal,
      })
    },

    apiWrite(input, signal) {
      const method = String(input.method || "POST").toUpperCase()
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw new Error(`api_write 不支持方法 ${method}。`)
      }
      const path = normalizeApiPath(input.path)
      return request(method, path, {
        query: input.query,
        body: input.body,
        signal,
      })
    },
  }
}
