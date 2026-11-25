import { redactSensitive } from "../../redact.mjs"
import { createKeydexClient, normalizeBaseUrl } from "./client.mjs"
import { keydexOperations } from "./contract.mjs"

const MAX_TEXT_CHARS = 128 * 1024

const object = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})

const int = (description, minimum, maximum) => ({
  type: "integer",
  description,
  minimum,
  ...(maximum !== undefined ? { maximum } : {}),
})

const bool = (description) => ({ type: "boolean", description })

export const READ_ONLY_TOOLS = new Set([
  "get_status",
  "pm_list_projects",
  "pm_query_workbench",
  "pm_get_project_metadata",
  "pm_query_issues",
  "pm_get_issue",
  "pm_query_iterations",
  "pm_query_docs",
  "pm_get_doc",
  "pm_query_affairs",
  "kb_list_spaces",
  "kb_search",
  "kb_get_tree",
  "kb_read_file",
  "collaboration_query_items",
  "notice_list",
  "api_read",
])

const DESTRUCTIVE_TOOLS = new Set(["api_write"])

function formatToolResult(payload) {
  const raw = JSON.stringify(payload, null, 2)
  const sanitized = redactSensitive(raw)
  const truncated = sanitized.length > MAX_TEXT_CHARS
  const text = truncated
    ? `${sanitized.slice(0, MAX_TEXT_CHARS)}\n\n[结果超过 128 KiB 已截断，请缩小分页或过滤条件]`
    : sanitized
  return {
    content: [{ type: "text", text }],
    ...(truncated
      ? {}
      : {
          structuredContent:
            payload && typeof payload === "object" && !Array.isArray(payload)
              ? payload
              : { value: payload },
        }),
  }
}

function formatToolError(error) {
  const message = redactSensitive(
    error instanceof Error
      ? error.message
      : String(error || "Keydex 调用失败。")
  )
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  }
}

function summarizeProjects(pmAuth) {
  const raw = Array.isArray(pmAuth?.projects) ? pmAuth.projects : []
  return raw.slice(0, 100).map((item) => ({
    key: String(item?.key || ""),
    name: String(item?.name || ""),
  }))
}

export async function activate(host) {
  const config = {
    installDir: String(
      host.configuration?.installDir || "D:\\tool\\Keydex"
    ).trim(),
    baseUrl: String(host.configuration?.baseUrl || "").trim(),
    timeoutSeconds: Number(host.configuration?.timeoutSeconds) || 30,
    readOnly: Boolean(host.configuration?.readOnly),
  }

  let closed = false
  let frozen = false
  const lifecycle = new AbortController()

  let connection = {
    state: "unknown",
    baseUrl: config.baseUrl,
    source: config.baseUrl ? "configured" : "none",
    pid: null,
    identityUser: null,
    pmState: "UNKNOWN",
    pmUser: null,
    projectCount: 0,
    projects: [],
    checkedAt: null,
    error: "",
  }

  const client = createKeydexClient({ config })

  const ensureAvailable = () => {
    if (closed) throw new Error("Keydex 插件已停用。")
    if (frozen) throw new Error("Moon 正在维护，Keydex 插件暂不接受新请求。")
  }

  const toolSpecs = [
    {
      name: "get_status",
      description:
        "检查本机 Keydex 服务连通性、当前登录身份、PM 平台登录状态及已加入的项目列表。",
      inputSchema: object(),
      run: async (_input, _ctx, signal) => {
        const res = await client.getStatus(signal)
        return {
          baseUrl: res.endpoint.baseUrl,
          source: res.endpoint.source,
          pid: res.endpoint.pid,
          identity: res.identity,
          pmState: res.pmAuth?.state || "UNKNOWN",
          pmUser: res.pmAuth?.user || null,
          activeProject: res.pmAuth?.activeProject?.project || null,
          projects: summarizeProjects(res.pmAuth),
        }
      },
    },
    {
      name: "pm_list_projects",
      description:
        "列出当前用户在 Keydex PM 平台已加入的所有项目（含 projectKey 与名称）。",
      inputSchema: object(),
      run: (_input, _ctx, signal) => client.pmListProjects(signal),
    },
    {
      name: "pm_query_workbench",
      description:
        "跨项目查询个人工作台中的事项、待办或风险（按 start/doing/done 状态分组）。",
      inputSchema: object({
        stateCategory: str(
          "状态大类：start（待开始）、doing（进行中）、done（已完成）",
          {
            enum: ["start", "doing", "done"],
          }
        ),
        keyword: str("关键词模糊搜索", { maxLength: 128 }),
        projectKeys: {
          type: "array",
          description: "按项目 key 过滤",
          items: str("项目 key"),
          maxItems: 50,
        },
        itemTypes: {
          type: "array",
          description: "按对象类型过滤：issue / todo / risk",
          items: str("对象类型", { enum: ["issue", "todo", "risk"] }),
          maxItems: 3,
        },
        issueTypes: {
          type: "array",
          description: "按事项类型过滤：requirement / task / bug",
          items: str("事项类型", { enum: ["requirement", "task", "bug"] }),
          maxItems: 3,
        },
        priorities: {
          type: "array",
          description: "按优先级过滤：urgent / high / medium / low",
          items: str("优先级", { enum: ["urgent", "high", "medium", "low"] }),
          maxItems: 4,
        },
        dueDateFrom: str("截止日期下界，格式 YYYY-MM-DD"),
        dueDateTo: str("截止日期上界，格式 YYYY-MM-DD"),
        page: int("页码（从 1 开始）", 1, 1000),
      }),
      run: (input, _ctx, signal) => client.pmQueryWorkbench(input, signal),
    },
    {
      name: "pm_get_project_metadata",
      description:
        "获取指定 PM 项目的状态字典、标签、迭代候选、项目成员与可选字段元数据，用于准确构造筛选或写入参数。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key，例如 yongcepro", { minLength: 1 }),
          includeMembers: bool("是否同时获取项目成员列表（默认 true）"),
          includeFieldMetadata: bool(
            "是否同时获取事项字段元数据（默认 false）"
          ),
        },
        ["projectKey"]
      ),
      run: (input, _ctx, signal) => client.pmGetProjectMetadata(input, signal),
    },
    {
      name: "pm_query_issues",
      description:
        "查询指定 PM 项目下的需求、任务、缺陷列表，支持关键词、筛选条件、排序与分页。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key，例如 yongcepro", { minLength: 1 }),
          keyword: str("按标题或正文模糊搜索"),
          filters: {
            type: "array",
            description:
              "筛选条件数组，每项为 { field, operator, value, valueEnd? }，如 field=issue_type/state_id/assignee_user_id/iteration_id/priority/labels，operator=eq/ne/in/contains/between/gte/lte。",
            items: { type: "object" },
            maxItems: 20,
          },
          sorts: {
            type: "array",
            description:
              "排序规则数组，每项为 { field, direction: 'asc'|'desc' }",
            items: { type: "object" },
            maxItems: 6,
          },
          page: int("页码（从 1 开始）", 1, 1000),
          pageSize: int("每页条数（1-200，默认 20）", 1, 200),
        },
        ["projectKey"]
      ),
      run: (input, _ctx, signal) => client.pmQueryIssues(input, signal),
    },
    {
      name: "pm_get_issue",
      description: "读取指定 PM 事项的完整详情，可选附带评论与活动记录。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key", { minLength: 1 }),
          issueId: int("事项数字 ID", 1),
          includeComments: bool("是否附带评论列表"),
          includeActivity: bool("是否附带活动日志"),
        },
        ["projectKey", "issueId"]
      ),
      run: (input, _ctx, signal) => client.pmGetIssue(input, signal),
    },
    {
      name: "pm_query_iterations",
      description: "查询指定 PM 项目的迭代列表与进度。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key", { minLength: 1 }),
          keyword: str("按迭代名称搜索"),
          includeArchived: bool("是否包含已归档迭代（默认 false）"),
          page: int("页码（从 1 开始）", 1, 1000),
          pageSize: int("每页条数（1-200，默认 20）", 1, 200),
        },
        ["projectKey"]
      ),
      run: (input, _ctx, signal) => client.pmQueryIterations(input, signal),
    },
    {
      name: "pm_query_docs",
      description: "查询指定 PM 项目的项目文档列表。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key", { minLength: 1 }),
          keyword: str("按文档关键词搜索"),
          folderId: int("目录 ID", 1),
          tagId: int("标签 ID", 1),
          iterationId: int("关联迭代 ID", 1),
          page: int("页码（从 1 开始）", 1, 1000),
          pageSize: int("每页条数（1-200，默认 20）", 1, 200),
        },
        ["projectKey"]
      ),
      run: (input, _ctx, signal) => client.pmQueryDocs(input, signal),
    },
    {
      name: "pm_get_doc",
      description: "读取指定 PM 项目文档的详细内容。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key", { minLength: 1 }),
          docId: int("文档数字 ID", 1),
        },
        ["projectKey", "docId"]
      ),
      run: (input, _ctx, signal) => client.pmGetDoc(input, signal),
    },
    {
      name: "pm_query_affairs",
      description:
        "查询指定 PM 项目的待办（todos）、风险（risks）、会议（meetings）或发布单（releases）。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key", { minLength: 1 }),
          kind: str("查询对象类型", {
            enum: ["todos", "risks", "meetings", "releases"],
          }),
          keyword: str("关键词搜索"),
          iterationId: int("按迭代 ID 过滤", 1),
          statuses: {
            type: "array",
            description: "状态数组过滤",
            items: str("状态值"),
            maxItems: 10,
          },
          status: str("单个状态值过滤"),
          priority: str("待办优先级：urgent/high/medium/low", {
            enum: ["urgent", "high", "medium", "low"],
          }),
          level: str("风险等级：high/medium/low", {
            enum: ["high", "medium", "low"],
          }),
          assigneeUserId: int("负责人用户 ID", 1),
          meetingType: str("会议类型：晨会/评审/复盘", {
            enum: ["晨会", "评审", "复盘"],
          }),
          versionNo: str("发布单版本号"),
          issueId: int("按关联事项反查发布单", 1),
          page: int("页码（从 1 开始）", 1, 1000),
          pageSize: int("每页条数（1-200，默认 30）", 1, 200),
        },
        ["projectKey", "kind"]
      ),
      run: (input, _ctx, signal) => client.pmQueryAffairs(input, signal),
    },
    {
      name: "pm_create_issue",
      description:
        "在指定 PM 项目中创建新事项（需求、任务或缺陷），属于写入操作。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key", { minLength: 1 }),
          issueType: str("事项类型", { enum: ["requirement", "task", "bug"] }),
          title: str("事项标题（2-100 字符）", {
            minLength: 2,
            maxLength: 100,
          }),
          iterationId: int("迭代 ID", 1),
          priority: str("优先级", {
            enum: ["urgent", "high", "medium", "low"],
          }),
          parentId: int("父事项 ID", 1),
          assigneeUserId: int("负责人用户 ID", 1),
          contentText: str("事项正文内容", { maxLength: 20000 }),
          endDate: str("截止日期 YYYY-MM-DD"),
          stateId: int("初始状态 ID", 1),
          customFields: {
            type: "object",
            description: "可选自定义字段键值对象",
          },
        },
        ["projectKey", "issueType", "title"]
      ),
      run: (input, _ctx, signal) => client.pmCreateIssue(input, signal),
    },
    {
      name: "pm_update_issue",
      description:
        "更新指定 PM 事项的标题、优先级、负责人、日期或工时等字段，属于写入操作。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key", { minLength: 1 }),
          issueId: int("事项数字 ID", 1),
          title: str("新标题（2-100 字符）", { minLength: 2, maxLength: 100 }),
          priority: str("优先级", {
            enum: ["urgent", "high", "medium", "low"],
          }),
          assigneeUserId: { anyOf: [int("负责人 ID", 1), { type: "null" }] },
          fixerUserId: {
            anyOf: [int("修复人 ID（仅 bug）", 1), { type: "null" }],
          },
          verifierUserId: {
            anyOf: [int("验证人 ID（仅 bug）", 1), { type: "null" }],
          },
          startDate: { anyOf: [str("开始日期 YYYY-MM-DD"), { type: "null" }] },
          endDate: { anyOf: [str("截止日期 YYYY-MM-DD"), { type: "null" }] },
          estimateHours: {
            anyOf: [{ type: "number", minimum: 0 }, { type: "null" }],
          },
          actualHours: {
            anyOf: [{ type: "number", minimum: 0 }, { type: "null" }],
          },
          customFields: {
            type: "object",
            description: "可选自定义字段键值对象",
          },
        },
        ["projectKey", "issueId"]
      ),
      run: (input, _ctx, signal) => client.pmUpdateIssue(input, signal),
    },
    {
      name: "pm_transition_issue",
      description: "流转指定 PM 事项的状态，属于写入操作。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key", { minLength: 1 }),
          issueId: int("事项数字 ID", 1),
          toStateId: int(
            "目标状态数字 ID（可先通过 pm_get_project_metadata 查询）",
            1
          ),
        },
        ["projectKey", "issueId", "toStateId"]
      ),
      run: (input, _ctx, signal) => client.pmTransitionIssue(input, signal),
    },
    {
      name: "pm_add_issue_comment",
      description: "在指定 PM 事项下发表评论，属于写入操作。",
      inputSchema: object(
        {
          projectKey: str("项目标识 key", { minLength: 1 }),
          issueId: int("事项数字 ID", 1),
          contentText: str("评论正文", { minLength: 1, maxLength: 10000 }),
          parentId: int("回复的父评论 ID", 1),
          mentionUserIds: {
            type: "array",
            description: "@ 提及的用户 ID 列表",
            items: int("用户 ID", 1),
            maxItems: 50,
          },
        },
        ["projectKey", "issueId", "contentText"]
      ),
      run: (input, _ctx, signal) => client.pmAddIssueComment(input, signal),
    },
    {
      name: "kb_list_spaces",
      description: "列出当前用户在 Keydex 知识库/资料库中可见的所有空间。",
      inputSchema: object(),
      run: (_input, _ctx, signal) => client.kbListSpaces(signal),
    },
    {
      name: "kb_search",
      description: "按关键词搜索 Keydex 知识库/资料库中的文档与文件。",
      inputSchema: object(
        {
          query: str("搜索关键词", { minLength: 1, maxLength: 500 }),
          spaceId: str("可选限定空间 ID"),
        },
        ["query"]
      ),
      run: (input, _ctx, signal) => client.kbSearch(input, signal),
    },
    {
      name: "kb_get_tree",
      description: "获取指定 Keydex 知识库空间的目录与文件树结构。",
      inputSchema: object(
        {
          spaceId: str("知识库空间 ID", { minLength: 1 }),
        },
        ["spaceId"]
      ),
      run: (input, _ctx, signal) => client.kbGetTree(input, signal),
    },
    {
      name: "kb_read_file",
      description: "分页读取 Keydex 知识库中指定文档节点的文本内容。",
      inputSchema: object(
        {
          nodeId: str("知识库文件节点 ID", { minLength: 1 }),
          offset: int("起始行偏移（默认 0）", 0),
          limit: int("最多读取行数（1-500，默认 200）", 1, 500),
        },
        ["nodeId"]
      ),
      run: (input, _ctx, signal) => client.kbReadFile(input, signal),
    },
    {
      name: "collaboration_query_items",
      description: "查询 Keydex 协作空间中的协作事项列表。",
      inputSchema: object({
        keyword: str("关键词搜索"),
        spaceKey: str("协作空间标识，如 company"),
        status: str("状态过滤"),
        page: int("页码", 1, 1000),
        pageSize: int("每页条数（1-100）", 1, 100),
      }),
      run: (input, _ctx, signal) =>
        client.collaborationQueryItems(input, signal),
    },
    {
      name: "notice_list",
      description: "读取 Keydex 站内消息通知列表与未读计数。",
      inputSchema: object({
        cursor: int("分页游标（默认 0）", 0),
        limit: int("返回条数（1-100，默认 20）", 1, 100),
        unreadOnly: bool("是否仅返回未读消息（默认 false）"),
      }),
      run: (input, _ctx, signal) => client.noticeList(input, signal),
    },
    {
      name: "api_read",
      description:
        "调用 Keydex 本地只读 HTTP 接口（用于专用工具未覆盖的只读查询，仅允许 /api/... 的 GET 或查询型 POST）。",
      inputSchema: object(
        {
          method: str("HTTP 方法，默认 GET", { enum: ["GET", "POST"] }),
          path: str(
            "以 /api/ 开头的接口路径，例如 /api/modules/project/projects/yongcepro/roles",
            {
              minLength: 5,
            }
          ),
          query: {
            type: "object",
            description: "可选 URL 查询参数键值对象",
          },
          body: {
            type: "object",
            description: "POST 查询请求体 JSON 对象",
          },
        },
        ["path"]
      ),
      run: (input, _ctx, signal) => client.apiRead(input, signal),
    },
    {
      name: "api_write",
      description:
        "调用 Keydex 本地写入 HTTP 接口（用于专用工具未覆盖的写入/变更操作，允许 /api/... 的 POST/PUT/PATCH/DELETE，受只读模式限制）。",
      inputSchema: object(
        {
          method: str("HTTP 方法", {
            enum: ["POST", "PUT", "PATCH", "DELETE"],
          }),
          path: str("以 /api/ 开头的接口路径", { minLength: 5 }),
          query: {
            type: "object",
            description: "可选 URL 查询参数键值对象",
          },
          body: {
            type: "object",
            description: "请求体 JSON 对象",
          },
        },
        ["method", "path"]
      ),
      run: (input, _ctx, signal) => client.apiWrite(input, signal),
    },
  ]

  const sharedTools = toolSpecs.map((spec) => {
    const readOnly = READ_ONLY_TOOLS.has(spec.name)
    const destructive = DESTRUCTIVE_TOOLS.has(spec.name)
    return {
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      shareable: true,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: destructive,
        idempotentHint: readOnly,
        openWorldHint: true,
      },
      async execute(input, context, signal) {
        try {
          ensureAvailable()
          if (!readOnly && config.readOnly) {
            return formatToolError(
              new Error("Keydex 插件当前处于只读模式，已拒绝写入操作。")
            )
          }
          const combined = signal
            ? AbortSignal.any([lifecycle.signal, signal])
            : lifecycle.signal
          const data = await spec.run(input || {}, context || {}, combined)
          return formatToolResult(data)
        } catch (error) {
          return formatToolError(error)
        }
      },
    }
  })

  const buildStatus = () => ({
    installDir: config.installDir,
    baseUrl: config.baseUrl,
    timeoutSeconds: config.timeoutSeconds,
    readOnly: config.readOnly,
    connection: {
      ...connection,
      projects: [...connection.projects],
    },
    tools: toolSpecs.map((spec) => {
      const readOnly = READ_ONLY_TOOLS.has(spec.name)
      return {
        name: spec.name,
        description: spec.description,
        effect: readOnly ? "read" : "write",
        destructive: DESTRUCTIVE_TOOLS.has(spec.name),
        enabled: readOnly || !config.readOnly,
      }
    }),
  })

  const businessState = () => {
    const suffix = config.readOnly ? "（只读）" : ""
    if (connection.state === "connected") {
      const user = connection.pmUser || connection.identityUser
      return `已连接 ${connection.baseUrl}${user ? ` · ${user}` : ""}${suffix}`
    }
    if (connection.state === "error") {
      return `连接异常：${connection.error.slice(0, 60)}`
    }
    if (config.baseUrl) {
      return `已配置 ${config.baseUrl}${suffix}`
    }
    return `自动发现本机 Keydex${suffix}`
  }

  const operation = (name, action) => ({
    ...keydexOperations[name],
    execute: async (input, _context, signal) => {
      ensureAvailable()
      const combined = signal
        ? AbortSignal.any([lifecycle.signal, signal])
        : lifecycle.signal
      return { value: await action(input || {}, combined) }
    },
  })

  return {
    sharedTools,
    operations: {
      status: operation("status", () => buildStatus()),
      testConnection: operation("testConnection", async (_input, signal) => {
        const started = Date.now()
        try {
          if (config.baseUrl) normalizeBaseUrl(config.baseUrl)
          const res = await client.getStatus(signal, true)
          signal.throwIfAborted()
          const latencyMs = Math.max(0, Date.now() - started)
          const identityUser = res.identity?.user?.display_name || null
          const pmState = String(res.pmAuth?.state || "UNKNOWN")
          const pmUser = res.pmAuth?.user?.username || null
          const projects = summarizeProjects(res.pmAuth)
          connection = {
            state: "connected",
            baseUrl: res.endpoint.baseUrl,
            source: res.endpoint.source,
            pid: res.endpoint.pid,
            identityUser,
            pmState,
            pmUser,
            projectCount: projects.length,
            projects,
            checkedAt: new Date().toISOString(),
            error: "",
          }
          host.emit?.("status-changed", { reason: "connection-tested" })
          return {
            ok: true,
            baseUrl: res.endpoint.baseUrl,
            identityUser,
            pmState,
            pmUser,
            projectCount: projects.length,
            latencyMs,
            error: "",
          }
        } catch (error) {
          signal.throwIfAborted()
          const message = redactSensitive(
            error instanceof Error ? error.message : String(error)
          )
          const latencyMs = Math.max(0, Date.now() - started)
          connection = {
            state: "error",
            baseUrl: config.baseUrl,
            source: config.baseUrl ? "configured" : "none",
            pid: null,
            identityUser: null,
            pmState: "ERROR",
            pmUser: null,
            projectCount: 0,
            projects: [],
            checkedAt: new Date().toISOString(),
            error: message,
          }
          host.emit?.("status-changed", { reason: "connection-tested" })
          return {
            ok: false,
            baseUrl: config.baseUrl,
            identityUser: null,
            pmState: "ERROR",
            pmUser: null,
            projectCount: 0,
            latencyMs,
            error: message,
          }
        }
      }),
    },
    status: businessState,
    quiesce() {
      frozen = true
    },
    resume() {
      frozen = false
    },
    close() {
      closed = true
      frozen = true
      client.invalidateCache()
      lifecycle.abort()
    },
  }
}
