import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ToolCall } from "@/features/conversation/messages/tool-call"
import type { ConversationToolCall } from "@/features/conversation/conversation-types"

const recorded: ConversationToolCall = {
  id: "extension-note-call",
  occurrenceId: "example-assistant:0",
  name: "moon_ext__example_note__note",
  source: "扩展 · 扩展接入示例",
  status: "success",
  input: '{"text":"正文和工具结果分别保留。"}',
  result: "验收记录\n正文和工具结果分别保留。",
  presentation: {
    kind: "moon.note",
    version: 1,
    payload: '{"title":"验收记录","text":"正文和工具结果分别保留。"}',
  },
}

function Preview({ tool }: { tool: ConversationToolCall }) {
  return (
    <div className="p-6">
      <ToolCall tool={tool} defaultOpen />
    </div>
  )
}

export default {
  id: "extension-result-presentation",
  name: "扩展结果展示",
  layer: "复合组件",
  group: "对话过程",
  source: "src/features/extensions/tool-result-presentation.tsx",
  description:
    "按公开 kind/version 展示已记录结果，工具状态、参数和复制仍由正式 ToolCall 管理。",
  boundary:
    "隔离的已记录数据，不调用扩展或模型；展示失败、未知版本和失败工具保留真实结果，不能重新执行副作用。",
  inputs: ["ConversationToolCall.presentation", "宿主控制的路径预览回调"],
  events: ["展开已记录参数与结果", "复制实际工具结果"],
  composition: [
    "ToolCall",
    "ToolResultPresentation",
    "Suspense",
    "PresentationBoundary",
  ],
  consumers: ["ToolCall"],
  viewport: { width: 760, height: 400 },
  states: [
    {
      id: "recorded",
      name: "结构化结果",
      condition: "已成功记录 moon.note v1。",
      expected: "扩展卡展示标题与内容，正式工具摘要、输入和原文复制保持可达。",
      render: () => <Preview tool={recorded} />,
    },
    {
      id: "unsupported-version",
      name: "未知展示版本",
      condition: "历史携带尚未支持的展示版本。",
      expected: "显示原始工具结果，不伪造卡片，也不重新执行工具。",
      render: () => (
        <Preview
          tool={{
            ...recorded,
            presentation: { ...recorded.presentation!, version: 2 },
          }}
        />
      ),
    },
    {
      id: "renderer-failed",
      name: "展示数据不兼容",
      condition: "已记录工具成功，但展示数据缺少标题和正文。",
      expected:
        "展示边界说明不可用并保留实际工具结果，成功状态不被展示故障改写。",
      render: () => (
        <Preview
          tool={{
            ...recorded,
            presentation: { ...recorded.presentation!, payload: "{}" },
          }}
        />
      ),
    },
    {
      id: "tool-failed",
      name: "工具实际失败",
      condition: "工具失败而不是展示失败。",
      expected: "不以扩展成功卡隐藏失败；显示实际失败结果与状态。",
      render: () => (
        <Preview
          tool={{
            ...recorded,
            status: "failed",
            result: "扩展工具未能完成，未记录新的结果。",
          }}
        />
      ),
    },
  ],
} satisfies CatalogEntry
