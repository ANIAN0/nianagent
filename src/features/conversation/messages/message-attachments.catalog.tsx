import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { MessageAttachments } from "./message-attachments"
export default {
  id: "conversation-message-attachments",
  name: "消息附件",
  layer: "复合组件",
  group: "对话消息",
  source: "src/features/conversation/messages/message-attachments.tsx",
  description: "已发送的文件和图片，提供可聚焦的预览入口。",
  boundary: "没有内容时明确说明，不伪造本地文件读取。",
  inputs: ["attachments: MessageAttachment[]"],
  events: ["onOpenAttachment(attachment)"],
  composition: ["Attachment", "Dialog"],
  consumers: ["UserMessage", "AssistantMessage"],
  viewport: { width: 700, height: 460 },
  states: [
    {
      id: "mixed",
      name: "混合附件与长文件名",
      condition: "图片和文本文件并列",
      expected: "图片64px，长文件名省略但悬停可读，文本和图片均可预览。",
      render: () => (
        <div className="p-6">
          <MessageAttachments
            attachments={[
              {
                id: "image",
                name: "moon.svg",
                kind: "image",
                url: "/moon.svg",
              },
              {
                id: "long",
                name: "会话页面设计评审与交互验收记录-2026-10-02.md",
                kind: "file",
                bytes: 2380,
                content: "# 验收记录\n\n检查消息布局、附件预览和中断反馈。",
              },
            ]}
          />
        </div>
      ),
    },
    {
      id: "image-failed",
      name: "图片无法读取",
      condition: "图片内容损坏",
      expected: "明确显示加载失败，预览中同样显示失败反馈。",
      render: () => (
        <div className="p-6">
          <MessageAttachments
            attachments={[
              {
                id: "broken",
                name: "无法读取的截图.png",
                kind: "image",
                url: "data:image/png;base64,invalid",
              },
            ]}
          />
        </div>
      ),
    },
    {
      id: "file",
      name: "文本附件",
      condition: "有预览文本",
      expected: "打开显示原文，关闭恢复焦点。",
      render: () => (
        <div className="p-6">
          <MessageAttachments
            attachments={[
              {
                id: "doc",
                name: "README.md",
                kind: "file",
                bytes: 1200,
                content: "# Moon\n\n本地 Agent 工作入口。",
              },
            ]}
          />
        </div>
      ),
    },
    {
      id: "metadata",
      name: "仅名称",
      condition: "没有文件内容",
      expected: "明确说明没有可预览内容。",
      render: () => (
        <div className="p-6">
          <MessageAttachments
            attachments={[
              { id: "doc", name: "界面评审记录.pdf", kind: "file" },
            ]}
          />
        </div>
      ),
    },
    {
      id: "image",
      name: "图片预览",
      condition: "本地已有图片地址",
      expected: "显示图片缩略图和完整预览。",
      render: () => (
        <div className="p-6">
          <MessageAttachments
            attachments={[
              {
                id: "image",
                name: "moon.svg",
                kind: "image",
                url: "/moon.svg",
              },
            ]}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
