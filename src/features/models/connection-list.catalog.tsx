import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ConnectionList } from "./connection-list"
import { connectionFixtures } from "./mock-model-service"
import "./model-settings.css"
function Example({
  empty = false,
  loading = false,
  error = false,
}: {
  empty?: boolean
  loading?: boolean
  error?: boolean
}) {
  const [notice, setNotice] = useState("")
  return (
    <div>
      <ConnectionList
        connections={empty ? [] : connectionFixtures}
        loading={loading}
        error={error ? "模拟服务暂时不可用。" : undefined}
        onRetry={() => setNotice("已请求重试")}
        onAdd={() => setNotice("已请求添加连接")}
        onEdit={(item) => setNotice(`编辑：${item.name}`)}
        onRemove={(item) => setNotice(`请求删除：${item.name}`)}
      />
      <p role="status" className="px-8">
        {notice}
      </p>
    </div>
  )
}
export default {
  id: "connection-list",
  name: "模型连接列表",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/connection-list.tsx",
  description: "连接搜索、分页、端点凭据与可用状态。",
  boundary: "不提交配置；编辑和删除由宿主处理。",
  inputs: ["connections、loading、error、busy、view"],
  events: ["onEdit、onRemove、onAdd、onRetry、onViewChange"],
  composition: [
    "Table、Input、DropdownMenu、SettingsPagination、Empty、Skeleton",
  ],
  consumers: ["ModelSettingsPage"],
  viewport: { width: 1000, height: 720 },
  states: [
    {
      id: "default",
      name: "完整目录",
      condition: "6个示例连接",
      expected: "搜索端点与凭据，打开行菜单，状态与模型数完整",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "空目录",
      condition: "没有连接",
      expected: "可从空态发起添加",
      render: () => <Example empty />,
    },
    {
      id: "loading",
      name: "加载中",
      condition: "读取等待",
      expected: "骨架避免布局跳动",
      render: () => <Example loading />,
    },
    {
      id: "error",
      name: "读取失败",
      condition: "服务失败",
      expected: "说明失败并提供重试",
      render: () => <Example error />,
    },
  ],
} satisfies CatalogEntry
