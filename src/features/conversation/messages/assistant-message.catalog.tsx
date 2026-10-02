import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { AssistantMessage } from "./assistant-message"
export default {
  id: "conversation-assistant-message",
  name: "Agent回复",
  layer: "复合组件",
  group: "对话消息",
  source: "src/features/conversation/messages/assistant-message.tsx",
  description: "无气泡正文，组合过程、Markdown、附件和操作栏。",
  boundary: "过程与正文保持独立；流式追加不替换组件身份。",
  inputs: ["message: ConversationMessage"],
  events: ["onRetry", "onOpenAttachment"],
  composition: [
    "Message",
    "Marker",
    "ExecutionProcess",
    "ThinkingBlock",
    "ToolCall",
    "MarkdownContent",
    "MessageAttachments",
    "MessageActions",
  ],
  consumers: ["ConversationMessageView"],
  viewport: { width: 780, height: 500 },
  states: [
    {
      id: "ordered-process",
      name: "正文与工具连续过程",
      condition: "工具执行前后都有说明文字",
      expected: "按记录顺序显示，复制正文不包含工具原始日志。",
      render: () => (
        <div className="p-6">
          <AssistantMessage
            message={{
              id: "ordered",
              role: "assistant",
              status: "settled",
              text: "先读取配置。发现路径不存在，保留当前配置。",
              blocks: [
                {
                  id: "intro",
                  type: "text",
                  text: "先读取工作区配置，确认入口文件。",
                },
                {
                  id: "tool",
                  type: "tool",
                  tool: {
                    id: "read",
                    name: "读取文件",
                    source: "内置工具",
                    status: "failed",
                    input: '{"path":"src/config.ts"}',
                    result: "ENOENT: 文件不存在。",
                  },
                },
                {
                  id: "result",
                  type: "text",
                  text: "没有找到该文件，**当前配置保持不变**。请确认实际入口路径后继续。",
                },
              ],
            }}
          />
        </div>
      ),
    },
    {
      id: "complete",
      name: "完成回复",
      condition: "过程与正文均有内容",
      expected: "过程默认汇总，正文没有气泡底色。",
      render: () => (
        <div className="p-6">
          <AssistantMessage
            message={{
              id: "assistant",
              role: "assistant",
              status: "settled",
              text: "已核对首页结构。\n\n- 保留主题色\n- 复用输入组件\n\n下一步接入会话阅读区域。",
              thinking: { text: "先核对组件及引用关系。" },
              tools: [
                {
                  id: "read",
                  name: "读取文件",
                  source: "内置工具",
                  status: "success",
                  result: "已读取入口文件。",
                },
              ],
            }}
          />
        </div>
      ),
    },
    {
      id: "pending",
      name: "等待正文",
      condition: "无正文无过程",
      expected: "仅显示正在处理，不重复占位。",
      render: () => (
        <div className="p-6">
          <AssistantMessage
            message={{
              id: "assistant",
              role: "assistant",
              status: "streaming",
              text: "",
            }}
          />
        </div>
      ),
    },
    {
      id: "interrupted",
      name: "停止后保留正文",
      condition: "运行中停止",
      expected: "保留已输出内容并显示已停止。",
      render: () => (
        <div className="p-6">
          <AssistantMessage
            message={{
              id: "assistant",
              role: "assistant",
              status: "interrupted",
              text: "已完成入口检查，接下来",
            }}
          />
        </div>
      ),
    },
    {
      id: "failed",
      name: "回复失败",
      condition: "没有正文",
      expected: "失败说明与重试入口均可見。",
      render: () => (
        <div className="p-6">
          <AssistantMessage
            message={{
              id: "assistant",
              role: "assistant",
              status: "failed",
              text: "",
            }}
            onRetry={() => {}}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
