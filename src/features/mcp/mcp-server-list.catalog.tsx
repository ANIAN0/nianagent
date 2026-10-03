import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { mcpFixtures } from "../../../ui-catalog/fixtures/mcp"
import { McpServerList } from "./mcp-server-list"
function Example({ loading = false }: { loading?: boolean }) {
  const [query, onQuery] = useState("")
  const [servers, setServers] = useState(mcpFixtures)
  return (
    <div className="h-dvh overflow-auto bg-card">
      <McpServerList
        servers={servers}
        loading={loading}
        error=""
        query={query}
        onQuery={onQuery}
        onAdd={() => {}}
        onEdit={() => {}}
        onRetry={() => {}}
        onRemove={(item) =>
          setServers(servers.filter((server) => server !== item))
        }
        onToggle={(item, enabled) =>
          setServers(
            servers.map((server) =>
              server === item
                ? {
                    ...server,
                    configuration: { ...server.configuration, enabled },
                  }
                : server
            )
          )
        }
      />
    </div>
  )
}
export default {
  id: "mcp-server-list",
  name: "MCP 服务目录",
  layer: "复合组件",
  group: "MCP 服务",
  source: "src/features/mcp/mcp-server-list.tsx",
  description: "比较服务用途、真实连接与验证时点，支持筛选和对象就近操作。",
  boundary: "受控数据与动作，持有无业务写入。",
  inputs: ["servers、query、loading、busy、error"],
  events: ["onEdit/onRemove/onToggle/onRetry/onAdd/onQuery"],
  composition: ["Table", "Switch", "InputGroup", "Empty", "Skeleton", "Button"],
  consumers: ["McpSettings"],
  viewport: { width: 1050, height: 600 },
  states: [
    {
      id: "default",
      name: "状态目录",
      condition: "有已连接、需授权、停用服务",
      expected: "文字解释状态，筛选、启停和对象操作可达",
      render: () => <Example />,
    },
    {
      id: "loading",
      name: "读取中",
      condition: "正在等待真实列表",
      expected: "状态骨架与读取提示，不展示伪造服务",
      render: () => <Example loading />,
    },
  ],
} satisfies CatalogEntry
