import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { McpEditorExample } from "../../../ui-catalog/fixtures/mcp"
export default {
  id: "mcp-server-editor",
  name: "MCP 服务编辑",
  layer: "复合组件",
  group: "MCP 服务",
  source: "src/features/mcp/mcp-server-editor.tsx",
  description: "维护单个服务草稿、就近连接验证、工具目录和保存。",
  boundary:
    "草稿、验证失败与保存失败归当前服务，分别靠近测试结果和保存动作；等待/取消使用普通状态。未知写入只核对，不重提。",
  inputs: ["initial: McpServer；service: McpService；cwd: 测试目录"],
  events: ["onSaved(server, keepOpen?)、onClose、registerLeave(guard)"],
  composition: [
    "McpTransportFields",
    "McpTestResult",
    "OperationFeedback",
    "RecoveryAction",
    "Field",
    "Select",
    "Switch",
    "SettingsConfirmDialog",
  ],
  consumers: ["McpSettings"],
  viewport: { width: 860, height: 980 },
  states: [
    {
      id: "stdio",
      name: "本地程序",
      condition: "实际字段结构与演示工具 schema",
      expected: "命令与参数分开，修改参数使旧测试失效，取消离开保留正式记录",
      render: () => <McpEditorExample />,
    },
    {
      id: "http",
      name: "HTTP 与凭据",
      condition: "远程服务与环境变量请求头",
      expected: "请求头直接展示，测试后可展开真实结构的示例工具",
      render: () => <McpEditorExample transport="http" />,
    },
    {
      id: "test-error",
      name: "测试失败",
      condition: "服务替身验证失败",
      expected: "测试反馈靠近参数，不清空草稿，可取消及重试",
      render: () => <McpEditorExample failure="test" />,
    },
    {
      id: "save-error",
      name: "保存失败",
      condition: "修改配置后点击保存，首次写入明确失败；再次保存恢复",
      expected: "错误与恢复动作明确，保留所有输入",
      render: () => <McpEditorExample failure="save" />,
    },
    {
      id: "test-request-error",
      name: "测试请求失败",
      condition: "点击测试连接，调用层明确拒绝",
      expected: "错误仅在测试区域；保留参数，可重新测试，保存区域不重复错误",
      render: () => <McpEditorExample failure="test-request" />,
    },
    {
      id: "cancel-test",
      name: "取消连接测试",
      condition: "点击测试连接，在等待期间取消",
      expected: "取消以普通信息呈现，没有红色失败；输入与保存动作仍可用",
      render: () => <McpEditorExample failure="slow-test" />,
    },
    {
      id: "saving",
      name: "保存等待",
      condition: "修改参数后保存，再点击返回",
      expected:
        "保存按钮与底栏显示等待，返回不产生红色报错，完成后更新已保存基线",
      render: () => <McpEditorExample failure="slow-save" />,
    },
    {
      id: "save-unknown",
      name: "保存结果待确认",
      condition: "修改配置后保存已提交，但响应未确认",
      expected:
        "保留草稿且禁重复保存，读取原保存回执确认结果；不以目录内容猜提交",
      render: () => <McpEditorExample failure="save-unknown" />,
    },
    {
      id: "save-unknown-later-draft",
      name: "未知保存后的继续编辑",
      condition: "修改描述为A并保存，结果未知后继续改为B，再核对保存结果",
      expected:
        "确认A已保存后表单保留B，以普通信息说明B未保存；保存B使用新的revision且完成，不丢输入",
      render: () => <McpEditorExample failure="save-unknown" />,
    },
    {
      id: "test-restart",
      name: "测试需重启宿主",
      condition: "test返回host_version",
      expected: "重启指引而非重复测试，所有草稿保留",
      render: () => <McpEditorExample failure="test-restart" />,
    },
    {
      id: "save-pending",
      name: "保存回执尚未确认",
      condition: "原请求结果保持unknown",
      expected: "核对原回执；不根据目录缺少配置解除阻挡",
      render: () => <McpEditorExample failure="save-unknown-pending" />,
    },
  ],
} satisfies CatalogEntry
