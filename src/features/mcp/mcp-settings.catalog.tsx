import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { McpSettingsExample } from "../../../ui-catalog/fixtures/mcp"
export default {
  id: "mcp-settings",
  name: "MCP 服务设置",
  layer: "页面",
  group: "MCP 服务",
  source: "src/features/mcp/mcp-settings.tsx",
  description:
    "个人服务目录与配置，保存、启停、删除和协议验证，供正式会话选择工具。",
  boundary:
    "持有当前列表、筛选、编辑对象与请求；服务注入，展示不建立真实连接。",
  inputs: ["service: McpService；cwd: 测试目录；registerLeave: 离开保护"],
  events: ["通过正式 service 读取、保存、测试和删除"],
  composition: ["McpServerList", "McpServerEditor", "SettingsConfirmDialog"],
  consumers: ["ModelSettingsPage"],
  viewport: { width: 1100, height: 760 },
  states: [
    {
      id: "default",
      name: "多种服务状态",
      condition: "本地已连接、HTTP需要授权、停用",
      expected: "来源、最近验证与正式会话连接明确区分，搜索和配置可操作",
      render: () => <McpSettingsExample />,
    },
    {
      id: "empty",
      name: "尚未配置",
      condition: "个人服务为空",
      expected: "添加入口明确，进入配置后保存返回目录",
      render: () => <McpSettingsExample empty />,
    },
    {
      id: "load-error",
      name: "读取失败",
      condition: "服务替身读取失败",
      expected: "错误就近展示、可重读，不自动运行服务器",
      render: () => <McpSettingsExample failure="list" />,
    },
    {
      id: "delete-error",
      name: "删除失败",
      condition: "服务替身删除失败",
      expected: "确认框保留原因与原记录，取消不删除",
      render: () => <McpSettingsExample failure="remove" />,
    },
  ],
} satisfies CatalogEntry
