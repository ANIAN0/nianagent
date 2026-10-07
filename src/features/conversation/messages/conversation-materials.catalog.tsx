import type { CatalogEntry } from "../../../../ui-catalog/catalog-types"
import { ConversationReadingExample } from "../../../../ui-catalog/fixtures/conversation-reading-stories"

export default {
  id: "conversation-materials",
  name: "查看消息中的文件与图片",
  order: 302,
  source: "src/features/conversation/messages/message-attachments.tsx",
  composition: [
    "UserMessage → MessageAttachments（组合入口） · src/features/conversation/messages/user-message.tsx",
    "MaterialPreviewDialog · src/features/materials/material-preview.tsx",
    "MaterialThumbnail · src/features/materials/material-thumbnail.tsx",
    "LiveConversationView → MessageEnvironmentProvider（组合入口） · src/features/conversation/live-conversation-view.tsx",
  ],
  group: "查看消息中的文件与图片",
  layer: "复合组件",
  stage: "content",
  pages: ["会话"],
  description:
    "消息附件（图片、文件）以气泡前材料条呈现，点击进入受控预览；图片来源与工具输出路径可回查，无法读取时保留来源与原因。",
  boundary:
    "只管已属于消息的材料展示与预览返回；不管输入卡材料选择、准备状态与重试（属空闲输入与已选材料规则）。",
  story: {
    goal: "查看已经属于某条消息的文件、目录或图片，理解材料来源并返回原消息。",
    preconditions: [
      "会话已有带材料的用户消息或工具输出路径。",
      "材料按该会话的真实记录读取。",
    ],
    result: "用户能看到可读取的材料，无法读取时保留来源和原因。",
  },
  standards: [
    {
      id: "attachment-metrics",
      name: "附件尺寸与截断",
      rule: "文件附件宽240px、最小高64px、16px圆角、28px文件图标；单图最长边240px不放大；长名截断但保留完整名称入口（悬停标题）。",
      reason: "材料在消息流中只占必要空间，图片不被拉伸失真。",
      check: "核对画廊场景文件卡与图片尺寸；长文件名以省略号截断且悬停显示全名。",
    },
    {
      id: "preview-return",
      name: "预览打开与返回",
      rule: "点击附件打开受控预览：图片看完整内容，文件看原文与来源；关闭预览返回原消息，不改变已发送记录。",
      reason: "查看材料不离开阅读位置，来源始终可核对。",
      check: "打开任一附件后关闭，消息列表与触发入口保持原状。",
    },
    {
      id: "unreadable-source",
      name: "不可读保留来源",
      rule: "材料读取失败或图片无法解码时，保留来源路径与失败原因，不伪造内容。",
      reason: "来源留着，用户能据此找回原始文件。",
      check: "不可读场景中图片显示解码失败态，文件不含虚构正文，来源路径可见。",
    },
  ],
  inputs: [],
  events: [],
  consumers: [
    "LiveConversationView · src/features/conversation/live-conversation-view.tsx",
  ],
  viewport: {
    width: 1000,
    height: 760,
  },
  states: [
    {
      id: "materials-gallery",
      name: "混合材料可预览",
      section: "normal",
      condition: "用户消息带一张图片与一个长名文件，回复已结束。",
      expected: "图片按最长边240px呈现，文件卡240px宽、28px图标、长名截断；点击附件打开受控预览，标题保留完整文件名、来源可见。",
      steps: ["打开图片附件核对完整内容", "打开文件附件核对标题与来源", "关闭预览回到原消息"],
      knownIssue:
        "隔离材料服务不返回文件正文，文件预览如实显示来源与无法读取状态；原文读取在正式服务连接时可用。",
      render: () => <ConversationReadingExample scenario="materials-gallery" />,
    },
    {
      id: "materials-unreadable",
      name: "材料不可读保留来源",
      section: "exception",
      condition: "历史材料的源文件已移走，图片无法解码、文件内容缺失。",
      expected: "图片显示失败占位与原因，文件卡不含伪造正文，两者都保留来源路径；其余消息不受影响。",
      steps: ["核对图片失败态与来源", "核对文件卡来源与原因", "确认回复正文说明可用动作"],
      render: () => <ConversationReadingExample scenario="materials-unreadable" />,
    },
    {
      id: "materials-mixed",
      name: "混合材料与长名截断",
      section: "states",
      condition: "一条消息同时有图片与超长文件名，宽窄窗口下依次查看。",
      expected: "长名以省略号截断但悬停保留完整名称入口；图片不被放大；关闭预览后回到原消息。",
      steps: ["悬停文件卡核对完整名称", "核对图片最长边240px不放大", "关闭预览回到原消息"],
      render: () => <ConversationReadingExample scenario="materials-gallery" />,
    },
  ],
} satisfies CatalogEntry
