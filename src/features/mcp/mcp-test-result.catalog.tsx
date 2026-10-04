import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { mcpTestFixture } from "../../../ui-catalog/fixtures/mcp"
import { McpTestResult } from "./mcp-test-result"
export default {
  id: "mcp-test-result",
  name: "MCP 测试结果",
  layer: "复合组件",
  group: "MCP 服务",
  source: "src/features/mcp/mcp-test-result.tsx",
  description: "验证状态、观察时间与工具参数目录。",
  boundary: "展示给定真实结果，不代表持续连接或执行成功。",
  inputs: ["result、stale、busy、onRetry"],
  events: ["展开工具参数、请求重新测试"],
  composition: ["OperationFeedback", "Collapsible", "Button"],
  consumers: ["McpServerEditor"],
  viewport: { width: 740, height: 400 },
  states: [
    {
      id: "success",
      name: "验证成功",
      condition: "工具目录发现通过",
      expected: "显示工具数量、描述、schema与时点，展开不调用服务",
      render: () => (
        <div className="p-6">
          <McpTestResult result={mcpTestFixture} />
        </div>
      ),
    },
    {
      id: "stale",
      name: "参数已变化",
      condition: "旧测试对应其他参数",
      expected: "明确需要重新测试，不继续声称新参数已验证",
      render: () => (
        <div className="p-6">
          <McpTestResult result={mcpTestFixture} stale />
        </div>
      ),
    },
    {
      id: "failure",
      name: "服务失败",
      condition: "协议启动失败",
      expected: "原因文字明确且不暴露凭据",
      render: () => (
        <div className="p-6">
          <McpTestResult
            result={{
              ...mcpTestFixture,
              state: "failed",
              tools: [],
              error: "本地服务启动失败，请检查命令、参数和环境。",
            }}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
