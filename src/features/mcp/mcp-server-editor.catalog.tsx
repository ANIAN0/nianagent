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
    "草稿及测试归当前服务；保存期间禁止离开，取消测试等待资源清理，迟到结果不覆盖新草稿。",
  inputs: ["initial: McpServer；service: McpService；cwd: 测试目录"],
  events: ["onSaved(server)、onClose、registerLeave(guard)"],
  composition: [
    "McpTransportFields",
    "McpTestResult",
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
      condition: "服务替身保存失败",
      expected: "错误与恢复动作明确，保留所有输入",
      render: () => <McpEditorExample failure="save" />,
    },
  ],
} satisfies CatalogEntry
