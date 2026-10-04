import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { mcpFixtures } from "../../../ui-catalog/fixtures/mcp"
import { McpServerList } from "./mcp-server-list"
function Example({
  loading = false,
  refreshError = false,
  rowError = false,
}: {
  loading?: boolean
  refreshError?: boolean
  rowError?: boolean
}) {
  const [notice, setNotice] = useState("")
  const [query, onQuery] = useState("")
  const [servers, setServers] = useState(mcpFixtures)
  const [readFailed, setReadFailed] = useState(refreshError)
  const [toggleFailed, setToggleFailed] = useState(rowError)
  return (
    <div className="h-dvh overflow-auto bg-card">
      <McpServerList
        servers={servers}
        loading={loading}
        error={readFailed ? "暂时无法读取服务状态，请稍后重试。" : ""}
        hasLoaded={!loading}
        rowFailures={
          toggleFailed
            ? {
                notes: {
                  message: "服务配置暂时无法写入，已保留原启用状态。",
                  code: "configuration_write_failed",
                  enabled: false,
                },
              }
            : undefined
        }
        query={query}
        onQuery={onQuery}
        onAdd={() =>
          setNotice("添加服务事件已触发；正式宿主会打开服务编辑器。")
        }
        onEdit={(server) =>
          setNotice(
            `编辑 ${server.configuration.name} 事件已触发；正式宿主会打开服务编辑器。`
          )
        }
        onRetry={() => setReadFailed(false)}
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
        onRetryToggle={(item, enabled) => {
          setToggleFailed(false)
          setServers((old) =>
            old.map((server) =>
              server === item
                ? {
                    ...server,
                    configuration: { ...server.configuration, enabled },
                  }
                : server
            )
          )
        }}
      />
      {notice && (
        <p
          role="status"
          className="model-page pt-0 text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}
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
  inputs: [
    "servers、query、loading、hasLoaded、busyNames、error/errorDetails、rowFailures、failure、unresolvedNames",
  ],
  events: [
    "onEdit/onRemove/onToggle/onRetryToggle/onCheckToggle/onRetry/onAdd/onQuery",
  ],
  composition: [
    "Table",
    "Switch",
    "InputGroup",
    "Empty",
    "Skeleton",
    "Button",
    "OperationFeedback",
    "RecoveryAction",
  ],
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
      id: "refresh-error",
      name: "刷新失败",
      condition: "已有目录，刷新没有取得新状态",
      expected: "保留整张表格，警告与重新读取入口紧邻目录顶部",
      render: () => <Example refreshError />,
    },
    {
      id: "row-error",
      name: "单服务启停失败",
      condition: "仅 notes 的停用操作失败",
      expected: "原开关状态保留，失败归 notes 行，其他服务不出现相同报错",
      render: () => <Example rowError />,
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
