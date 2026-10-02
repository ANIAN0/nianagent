import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ExecutionProcess } from "./execution-process"
export default {
  id: "conversation-execution-process",
  name: "执行过程",
  layer: "复合组件",
  group: "对话过程",
  source: "src/features/conversation/messages/execution-process.tsx",
  description: "已完成轮次汇总折叠，运行轮次直接显示实时过程。",
  boundary: "负责折叠层级，工具状态由调用方提供。",
  inputs: ["thinking", "tools", "running", "defaultOpen"],
  events: ["展开过程"],
  composition: ["Collapsible", "ThinkingBlock", "ToolCall"],
  consumers: ["AssistantMessage"],
  viewport: { width: 760, height: 400 },
  states: [
    {
      id: "collapsed",
      name: "过程汇总",
      condition: "已完成工具调用",
      expected: "33px 汇总控制，下沿细分隔线。",
      render: () => (
        <div className="p-6">
          <ExecutionProcess
            thinking={{ text: "先读取入口。" }}
            tools={[
              {
                id: "read",
                name: "读取文件",
                source: "内置工具",
                status: "success",
                result: "文件已读取。",
              },
            ]}
          />
        </div>
      ),
    },
    {
      id: "running",
      name: "运行过程",
      condition: "工具正在执行",
      expected: "运行过程直接可见，没有误导性的已完成汇总。",
      render: () => (
        <div className="p-6">
          <ExecutionProcess
            running
            thinking={{ text: "正在核对入口。" }}
            tools={[
              {
                id: "read",
                name: "读取文件",
                source: "内置工具",
                status: "running",
              },
            ]}
          />
        </div>
      ),
    },
    {
      id: "thought",
      name: "仅思考",
      condition: "没有工具",
      expected: "显示已思考及传入时长。",
      render: () => (
        <div className="p-6">
          <ExecutionProcess
            thinking={{ text: "核对确认的页面结构。", duration: "8 秒" }}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
