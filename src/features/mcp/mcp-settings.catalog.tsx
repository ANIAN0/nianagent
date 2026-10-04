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
    "读取反馈归目录、启停反馈归单服务、删除反馈只归确认弹窗；服务及对象校验迟到结果。展示不建立真实连接。",
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
      id: "refresh-error",
      name: "刷新失败保留目录",
      condition: "首次读取成功；点击刷新使第二次读取失败，再次读取恢复",
      expected: "表格与原配置保持可见，读取警告只有一处，重试不写配置",
      render: () => <McpSettingsExample failure="refresh" />,
    },
    {
      id: "toggle-error",
      name: "启停失败",
      condition: "点击一个服务的启用开关，首次保存明确失败",
      expected: "只有该行显示失败及重试，其他服务的开关仍可操作；再次保存恢复",
      render: () => <McpSettingsExample failure="toggle" />,
    },
    {
      id: "delete-error",
      name: "删除失败",
      condition: "服务替身删除失败",
      expected: "确认框保留原因与原记录，取消不删除",
      render: () => <McpSettingsExample failure="remove" />,
    },
    {
      id: "delete-unknown",
      name: "删除结果待确认",
      condition: "删除已提交但未收到结果，按原删除请求读取回执",
      expected:
        "确认弹窗只有警告与核对动作，不重复发送删除；原删除回执明确提交后读取目录并关闭",
      render: () => <McpSettingsExample failure="remove-unknown" />,
    },
    {
      id: "toggle-unknown",
      name: "启停结果待确认",
      condition: "切换已提交但未收到结果",
      expected:
        "该行暂禁再次修改，只读原请求回执；确定原写入提交或拒绝后读取目录，不能按开关碰巧相同解除警告",
      render: () => <McpSettingsExample failure="toggle-unknown" />,
    },
    {
      id: "list-restart",
      name: "读取需重启宿主",
      condition: "list返回host_version",
      expected: "恢复动作显示真实重启指引",
      render: () => <McpSettingsExample failure="list-restart" />,
    },
  ],
} satisfies CatalogEntry
