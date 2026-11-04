import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { Page } from "./web"
import type { McpServiceClient, McpServiceStatus } from "./types"
export const exampleServiceStatus = (empty = false): McpServiceStatus => ({
  running: true,
  port: 19826,
  url: "http://127.0.0.1:19826/mcp",
  revision: 0,
  selected: [],
  issue: "",
  logIssue: "",
  protocol: "隔离示例",
  tools: empty
    ? []
    : [
        {
          name: "opencli__run",
          plugin: "opencli",
          generation: 1,
          description:
            "原生 argv/session/--tab。可以点击、填写、执行脚本及关闭页面，具有写入影响。".repeat(
              4
            ),
          inputSchema: {},
          annotations: { readOnlyHint: false },
        },
      ],
})
function Example({
  empty = false,
  failure = false,
}: {
  empty?: boolean
  failure?: boolean
}) {
  const [source] = useState<McpServiceClient>(() => {
    let value = exampleServiceStatus(empty)
    return {
      read: async () => structuredClone(value),
      reveal: async () => ({
        token: "example-only-token-does-not-authenticate",
      }),
      save: async (input) => {
        if (failure) throw new Error("示例：固定端口已占用，原配置保留。")
        value = {
          ...value,
          ...input,
          url: `http://127.0.0.1:${input.port}/mcp`,
          revision: value.revision + 1,
        }
        return structuredClone(value)
      },
      reset: async () => structuredClone(value),
    }
  })
  return (
    <div className="p-6">
      <Page service={source} />
    </div>
  )
}
export default {
  id: "moon-mcp-service",
  name: "Moon MCP 服务页",
  layer: "页面",
  stage: "content",
  order: 183,
  pages: ["插件设置"],
  group: "插件",
  source: "backend/plugins/mcp-service/web.tsx",
  relatedOperations: [
    "mcp-service.status",
    "mcp-service.save",
    "mcp-service.reveal",
    "mcp-service.reset",
  ],
  modules: [
    {
      id: "plugin-settings",
      region: "服务状态、端口、独立token、共享工具与客户端配置",
    },
  ],
  description: "从插件详情打开统一 MCP 出口，选择工具并复制客户端配置。",
  boundary: "隔离内存服务不监听、不读取或写入真实token/插件配置。",
  story: {
    goal: "配置一个可供外部Agent使用的本机出口。",
    preconditions: ["已从插件详情进入。"],
    result: "保存后显示地址与共享选择；失败可恢复。",
  },
  standards: [
    {
      id: "M1",
      name: "显式共享",
      rule: "作者声明、插件启用与用户选择缺一不可。",
      reason: "避免工具自动对外开放。",
      check: "勾选后保存，重新读取保留选择；查看可写影响。",
    },
  ],
  inputs: ["McpServiceClient"],
  events: ["保存端口与工具", "显示/复制/重置token", "复制Codex/DSH配置"],
  composition: ["Field / Checkbox / Button / Input / Alert / Empty / Badge"],
  consumers: ["PluginSettings"],
  viewport: { width: 760, height: 1100 },
  states: [
    {
      id: "configure",
      name: "共享选择与长描述",
      section: "normal",
      condition: "OpenCLI已启用并声明共享。",
      expected: "可写影响、原生session说明完整可读；保存选择后重读保留。",
      steps: [
        "勾选OpenCLI，保存。",
        "复制配置，核对token使用环境变量。",
        "显示再隐藏示例token。",
      ],
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "无可共享工具",
      section: "states",
      condition: "尚未启用共享工具插件。",
      expected: "显示前往插件设置启用的说明。",
      steps: ["读取空状态。"],
      render: () => <Example empty />,
    },
    {
      id: "failure",
      name: "端口占用与恢复",
      section: "exception",
      condition: "保存遭遇端口占用。",
      expected: "原地址保留，错误可见，重新读取可恢复。",
      steps: ["修改端口并保存。", "核对错误，重新读取。"],
      render: () => <Example failure />,
    },
  ],
} satisfies CatalogEntry
