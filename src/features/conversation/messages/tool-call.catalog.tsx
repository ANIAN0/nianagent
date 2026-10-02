import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ToolCall } from "./tool-call"
export default {
  id: "conversation-tool-call",
  name: "工具调用",
  layer: "复合组件",
  group: "对话过程",
  source: "src/features/conversation/messages/tool-call.tsx",
  description: "工具摘要与独立折叠的输入、结果。",
  boundary: "只查看已记录数据，不执行真实命令。",
  inputs: ["tool: ConversationToolCall", "defaultOpen"],
  events: ["展开工具、输入、结果", "展开超过20行的结果"],
  composition: ["Collapsible", "Button", "Separator"],
  consumers: ["ExecutionProcess"],
  viewport: { width: 760, height: 500 },
  states: [
    {
      id: "stopped",
      name: "执行中断",
      condition: "命令在返回结果前停止",
      expected: "保留输入，结果明确标注已停止而非空白或成功。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "stopped",
              name: "读取工作目录下的项目配置",
              source: "本地工作区文件工具",
              status: "stopped",
              input:
                '{"path":"H:/workspace/moon/src/features/conversation/messages"}',
            }}
          />
        </div>
      ),
    },
    {
      id: "success",
      name: "执行成功",
      condition: "已保存结果",
      expected: "展开后输入默认折叠，结果展开。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "read",
              name: "读取文件",
              source: "内置工具",
              status: "success",
              input: '{"path":"src/App.tsx"}',
              result: "export default App",
            }}
          />
        </div>
      ),
    },
    {
      id: "running",
      name: "执行中",
      condition: "没有结果",
      expected: "摘要为执行中；展开提示尚未收到结果。",
      render: () => (
        <div className="p-6">
          <ToolCall
            tool={{
              id: "run",
              name: "检查项目",
              source: "内置工具",
              status: "running",
              input: "读取目录结构",
            }}
          />
        </div>
      ),
    },
    {
      id: "failed",
      name: "非零退出码",
      condition: "退出码1",
      expected: "即使状态success也呈现失败。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "failed",
              name: "运行命令",
              source: "内置工具",
              status: "success",
              exitCode: 1,
              result: "找不到指定文件。",
            }}
          />
        </div>
      ),
    },
    {
      id: "long",
      name: "长结果",
      condition: "30行结果",
      expected: "先显示20行，可展开和收起。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "long",
              name: "读取目录",
              source: "内置工具",
              status: "success",
              result: Array.from(
                { length: 30 },
                (_, i) => `第 ${i + 1} 行记录`
              ).join("\n"),
            }}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
