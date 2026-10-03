import { useState } from "react"
import { McpSettings } from "@/features/mcp/mcp-settings"
import { McpServerEditor } from "@/features/mcp/mcp-server-editor"
import {
  blankMcpConfiguration,
  type McpServer,
  type McpService,
  type McpTestResult,
} from "@/features/mcp/mcp-service"
const testedAt = "2026-10-03T08:00:00.000Z"
export const mcpTestFixture: McpTestResult = {
  state: "connected",
  error: "",
  testedAt,
  tools: [
    {
      name: "read_note",
      id: "mcp__notes__read_note",
      description: "读取指定项目笔记，返回原始正文与更新时间。",
      inputSchema: JSON.stringify({
        type: "object",
        properties: { path: { type: "string", description: "笔记相对路径" } },
        required: ["path"],
      }),
    },
    {
      name: "search_notes",
      id: "mcp__notes__search_notes",
      description: "在工作区笔记中搜索关键词。",
      inputSchema: JSON.stringify({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      }),
    },
  ],
}
export const mcpFixtures: McpServer[] = [
  {
    configuration: {
      ...blankMcpConfiguration(),
      name: "notes",
      command: "node",
      args: ["H:/tools/notes-server.mjs"],
      description: "读取工作区资料和搜索项目笔记",
    },
    revision: 1,
    source: "H:/Moon/agent/mcp.json",
    test: mcpTestFixture,
    runtime: { state: "connected", connections: 1, error: "" },
  },
  {
    configuration: {
      ...blankMcpConfiguration(),
      name: "team_docs",
      transport: "http",
      url: "https://docs.example.test/mcp",
      description: "查询团队文档",
      headers: [{ name: "Authorization", value: "Bearer ${DOCS_TOKEN}" }],
    },
    revision: 2,
    source: "H:/Moon/agent/mcp.json",
    test: {
      state: "needs-auth",
      testedAt,
      error: "服务需要授权，请配置有效凭据后重新测试。",
      tools: [],
    },
  },
  {
    configuration: {
      ...blankMcpConfiguration(),
      name: "archived",
      command: "node",
      args: ["H:/tools/archived.mjs"],
      enabled: false,
    },
    revision: 1,
    source: "H:/Moon/agent/mcp.json",
  },
]
export function createMcpFixtureService(
  initial: McpServer[] = mcpFixtures,
  failure = ""
): McpService {
  let servers = structuredClone(initial)
  const wait = async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    await new Promise((resolve) => setTimeout(resolve, 250))
    signal?.throwIfAborted()
  }
  return {
    list: async (signal) => {
      await wait(signal)
      if (failure === "list") throw new Error("演示：无法读取 MCP 配置文件。")
      return structuredClone(servers)
    },
    save: async (configuration, revision, signal) => {
      await wait(signal)
      if (failure === "save") throw new Error("演示：保存失败，草稿保留。")
      const saved: McpServer = {
        configuration: structuredClone(configuration),
        revision: (revision || 0) + 1,
        source: "演示服务替身，不写真实文件",
        test: mcpTestFixture,
      }
      servers = [
        ...servers.filter(
          (item) => item.configuration.name !== configuration.name
        ),
        saved,
      ]
      return saved
    },
    remove: async (name, _, signal) => {
      await wait(signal)
      if (failure === "remove") throw new Error("演示：删除失败，记录保留。")
      servers = servers.filter((item) => item.configuration.name !== name)
    },
    test: async (_, __, signal) => {
      await wait(signal)
      return failure === "test"
        ? {
            state: "failed",
            error: "演示：服务启动失败，请检查参数。",
            testedAt,
            tools: [],
          }
        : structuredClone(mcpTestFixture)
    },
  }
}
export function McpSettingsExample({
  empty = false,
  failure = "",
}: {
  empty?: boolean
  failure?: string
}) {
  const [service] = useState(() =>
    createMcpFixtureService(empty ? [] : mcpFixtures, failure)
  )
  return (
    <div className="model-settings-content h-dvh bg-card">
      <McpSettings service={service} />
    </div>
  )
}
export function McpEditorExample({
  transport = "stdio",
  failure = "",
}: {
  transport?: "stdio" | "http"
  failure?: string
}) {
  const [service] = useState(() =>
    createMcpFixtureService(mcpFixtures, failure)
  )
  const [initial, setInitial] = useState(
    mcpFixtures[transport === "http" ? 1 : 0]
  )
  return (
    <div className="model-scroll h-dvh bg-card">
      <McpServerEditor
        key={initial.revision}
        initial={initial}
        service={service}
        onSaved={setInitial}
        onClose={() => {}}
      />
    </div>
  )
}
