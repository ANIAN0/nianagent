import { useState } from "react"
import { Button } from "@/components/ui/button"
import { McpSettings } from "@/features/mcp/mcp-settings"
import { McpServerEditor } from "@/features/mcp/mcp-server-editor"
import { RpcRequestRejected } from "@/features/models/model-service"
import {
  blankMcpConfiguration,
  type McpServer,
  type McpService,
  type McpTestResult,
} from "@/features/mcp/mcp-service"
import type { WriteReceipt } from "@/features/models/model-contract.generated"
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
  let reads = 0
  let writes = 0
  const receipts = new Map<string, WriteReceipt>()
  const wait = async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const delay =
        failure === "slow-test" || failure === "slow-save" ? 1800 : 250
      const finish = () => {
        signal?.removeEventListener("abort", abort)
        resolve()
      }
      const timer = setTimeout(finish, delay)
      const abort = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        reject(new DOMException("等待已取消", "AbortError"))
      }
      signal?.addEventListener("abort", abort, { once: true })
    })
    signal?.throwIfAborted()
  }
  return {
    evidence: "demo",
    readWriteReceipt: async (operation, operationRequestId, signal) => {
      await wait(signal)
      return structuredClone(
        receipts.get(operationRequestId) ?? {
          operation,
          operationRequestId,
          targetId: "",
          state: "unknown",
        }
      )
    },
    list: async (signal) => {
      await wait(signal)
      reads += 1
      if (failure === "list-restart")
        throw new RpcRequestRejected("示例：桌面服务需更新并重启。", {
          code: "host_version",
          summary: "当前桌面服务不支持此操作，请更新并重启 Moon。",
          recovery: "restart",
          severity: "error",
        })
      if (failure === "list" || (failure === "refresh" && reads === 2))
        throw new RpcRequestRejected(
          "无法读取 MCP 配置文件，请检查文件是否可访问。"
        )
      return structuredClone(servers)
    },
    save: async (configuration, revision, signal, operationRequestId) => {
      await wait(signal)
      writes += 1
      if (failure === "save-unknown-pending")
        throw new RpcRequestRejected("原保存仍待确认。", {
          code: "result_unknown",
          summary: "原保存仍待确认，请核对原请求。",
          recovery: "check",
          severity: "warning",
        })
      const existing = servers.find(
        (item) => item.configuration.name === configuration.name
      )
      if (existing && existing.revision !== revision)
        throw new RpcRequestRejected("配置已更新。", {
          code: "revision_conflict",
          summary: "服务已被其他操作更新，请返回目录读取最新版本。",
          recovery: "reload",
          severity: "error",
        })
      if ((failure === "save" || failure === "toggle") && writes === 1)
        throw new RpcRequestRejected("MCP 配置暂时无法写入，请重试。")
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
      if (operationRequestId)
        receipts.set(operationRequestId, {
          operation: "mcpSave",
          operationRequestId,
          targetId: configuration.name,
          state: "committed",
          revision: saved.revision,
        })
      if (
        (failure === "save-unknown" && writes === 1) ||
        failure === "toggle-unknown"
      )
        throw Object.assign(new Error("未能收到提交结果"), {
          issue: {
            code: "result_unknown",
            recovery: "check",
            severity: "warning",
            summary: "未能确认保存结果，请核对原保存请求。",
          },
        })
      return saved
    },
    remove: async (name, revision, signal, operationRequestId) => {
      await wait(signal)
      if (failure === "remove")
        throw new RpcRequestRejected("MCP 配置暂时无法写入，服务记录保留。")
      const existing = servers.find((item) => item.configuration.name === name)
      if (!existing || existing.revision !== revision)
        throw new RpcRequestRejected("服务已更新，请重新读取目录。")
      servers = servers.filter((item) => item.configuration.name !== name)
      if (operationRequestId)
        receipts.set(operationRequestId, {
          operation: "mcpRemove",
          operationRequestId,
          targetId: name,
          state: "committed",
          revision,
        })
      if (failure === "remove-unknown")
        throw Object.assign(new Error("未能收到提交结果"), {
          issue: {
            code: "result_unknown",
            recovery: "check",
            severity: "warning",
            summary: "未能确认删除结果，请核对原删除请求。",
          },
        })
    },
    test: async (_, __, signal) => {
      await wait(signal)
      if (failure === "test-restart")
        throw new RpcRequestRejected("当前桌面服务需重启。", {
          code: "host_version",
          summary: "当前桌面服务不支持此操作，请更新并重启 Moon。",
          recovery: "restart",
          severity: "error",
        })
      if (failure === "test-request")
        throw new RpcRequestRejected("测试请求未能完成，请检查服务参数后重试。")
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
  const [open, setOpen] = useState(true)
  return (
    <div className="model-scroll h-dvh bg-card">
      {open ? (
        <McpServerEditor
          key={initial.revision}
          initial={initial}
          service={service}
          onSaved={(saved, keepOpen) => {
            if (!keepOpen) {
              setInitial(saved)
              setOpen(false)
            }
          }}
          onClose={() => setOpen(false)}
        />
      ) : (
        <div className="model-page">
          <Button onClick={() => setOpen(true)}>重新打开服务配置</Button>
          <p className="mt-3 text-sm text-muted-foreground">
            已返回目录。原请求未确认时，重开会保留草稿与原请求。
          </p>
        </div>
      )}
    </div>
  )
}
