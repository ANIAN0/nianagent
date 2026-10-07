import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { ConversationPageExample } from "../../../ui-catalog/fixtures/conversation-page-stories"

export default {
  id: "conversation-page",
  name: "会话页面",
  group: "会话",
  layer: "页面",
  stage: "content",
  order: 400,
  pages: ["会话"],
  source: "src/features/conversation/live-conversation-view.tsx",
  description:
    "整页会话视图组合：头部状态、消息流、输入区、审批、队列、压缩、分支、上下文与材料预览、异常恢复。九个会话故事的组合入口，从打开会话到读懂进展、处理需要的操作，并在当前会话继续工作。",
  boundary:
    "只覆盖会话页本身，不含侧栏会话列表、首页与设置页。分步问答未接线，不在本条目验收。示例使用隔离服务与内存存储，由演示控制发布终态；不证明真实宿主流式、工具执行、审批、派生或跨重启恢复已验收。",
  story: {
    goal: "从打开会话到读懂进展、处理需要的操作，并在当前会话继续工作。",
    preconditions: [
      "首页首条输入已交付，或从会话列表打开一个已有会话。",
      "当前会话的工作目录、模型和历史归属明确。",
    ],
    result: "用户能读懂当前结果和进展，并在目标会话中继续工作。",
  },
  standards: [
    {
      id: "page-composition",
      name: "整页组合与可访问状态文本",
      rule: "会话页由头部、消息流、输入区和恢复入口组合；状态以可访问文本表达（等待确认/正在停止/正在回复/回复结束/已停止/回复失败等），消息正文最大 748px 居中，输入卡可见宽度 780px。",
      reason: "一整页需要同时表达进展、可操作入口与当前会话归属。",
      check:
        "阅读 page-ready 首读多轮，核对头部状态文本、消息流与输入区同时可读；分支后核对派生状态与来源入口。",
    },
    {
      id: "snapshot-draft",
      name: "服务快照与草稿分离、失败不是正文",
      rule: "服务快照与输入草稿分开保存；失败说明靠近所属操作，不拼入 Agent 回复正文；明确拒绝用输入附近紧凑原因与 Toast，未知只保留一个核对原消息入口。",
      reason: "读取或发送故障不能被误认为原内容或正在编辑的文字消失。",
      check:
        "在 page-recovery 触发发送拒绝与未知回执，核对 Toast、回显与两稿保留；重新加载只清读取错误，不清草稿。",
    },
    {
      id: "running-single-action",
      name: "运行中单一主动作与队列 dock",
      rule: "运行中空稿或不可发送时唯一主动作是停止，有有效新稿时同一按钮切为排队（Enter 排队、Ctrl/Cmd+Enter 补充）；QueueDock 贴输入区上沿、最大高度 180px，编辑、移除与补充在原项操作。",
      reason: "停止与排队不能并行表达，避免误操作或丢失待处理内容。",
      check:
        "在 page-running 空稿点击停止，再键入新稿核对按钮切换与排队；编辑、移除与补充后核对队列归属和草稿。",
    },
    {
      id: "unknown-recovery",
      name: "异常与未知回执恢复保留草稿",
      rule: "明确拒绝保留原消息与下一稿；未知结果保留 SubmissionReceipt 核对入口，未确认前不重复发送；队列操作失败或未知保留所属核对入口，核对不会重复执行。",
      reason: "异步结果不能覆盖新一轮状态或丢失未发送文字。",
      check:
        "在 page-recovery 拒绝后重发，核对原消息与草稿；未知回执核对成功后恢复，队列移除未知核对后确认归属。",
    },
    {
      id: "derived-compact-context",
      name: "派生、压缩与上下文组合",
      rule: "派生会话在消息流显示“派生自 · 来源标题”并提供“打开来源会话”；/compact 直接执行并在历史位置显示状态与摘要；有效上下文读数才显示用量入口，压缩中或待确认保留查看入口。",
      reason:
        "组合入口需要与来源、压缩和上下文状态归属一致，避免把整理失败当任务失败。",
      check:
        "在 page-ready 查看压缩摘要与上下文读数，从已完成的回复创建分支并核对派生标题与来源入口。",
    },
  ],
  inputs: [
    "ConversationSnapshot：会话消息、运行阶段、审批、队列、控制操作、压缩记录、来源与上下文读数。",
    "ConversationService：读取、跟随、回执、发送、停止、继续与队列操作；示例显式提供内存替身。",
    "HomeDraft：与服务快照独立的下一稿与材料；完整正式输入区仍可编辑。",
    "HomeData：模型目录、工作区与工具配置。",
    "readingPositions：当前窗口按会话保存的阅读位置；离开返回保留。",
    "queueRecoveryRecords / queueIssues / queueOriginalRetryAllowed：原队列操作恢复标识与所属回执。",
  ],
  events: [
    "useLiveConversation 驱动读取、跟随、发送、停止、继续、草稿与队列恢复；onReload 只重新读取对应会话。",
    "onSend / onStop / onContinue / onReconcile / onQueue* / onRetryQueueOriginal 由输入区与恢复入口调用。",
    "审批 reply 与 /compact 直接执行；分支 fork(entryId) 完成后自动打开派生会话。",
    "onOpenConversation 切换当前会话，返回时保留草稿与阅读位置；captureNavigation 保护当前页面归属。",
    "演示控制只切换服务可用性、发布终态与回执；不直接设置正式错误或伪造已停止。",
  ],
  composition: [
    "LiveConversationView → ConversationPage / ConversationTurnView / ConversationComposer（整页组合入口） · src/features/conversation/live-conversation-view.tsx",
    "ConversationPage → ConversationHeader / ConversationReadFeedback / ConversationList（组合入口） · src/features/conversation/conversation-page.tsx",
    "ConversationHeader · src/features/conversation/conversation-header.tsx",
    "ConversationReadFeedback → Empty / RecoveryAction（读取失败组合） · src/features/conversation/conversation-read-feedback.tsx",
    "ConversationList → ConversationNavigator · src/features/conversation/conversation-list.tsx",
    "ConversationTurnView → UserMessage / MarkdownContent / MessageActions（消息流） · src/features/conversation/messages/conversation-turn-view.tsx",
    "ConversationTurnFeedback（终态错误行） · src/features/conversation/conversation-turn-feedback.tsx",
    "ExecutionInlineStatus（等待重试行） · src/features/conversation/execution-inline-status.tsx",
    "ConversationSubmissionEcho（原消息回显） · src/features/conversation/conversation-submission-echo.tsx",
    "ConversationCompactionRecord → CompactionRecord（已保存压缩摘要） · src/features/conversation/controls/conversation-compaction-record.tsx",
    "CompactionStatus（手动压缩状态） · src/features/conversation/controls/compaction-status.tsx",
    "ForkFeedback（分支反馈） · src/features/conversation/controls/fork-feedback.tsx",
    "ConversationComposer（输入区） · src/features/conversation/composer/conversation-composer.tsx",
    "QueueDock（待处理消息） · src/features/conversation/composer/queue-dock.tsx",
    "QueueOperationRecovery（原队列操作恢复） · src/features/conversation/composer/queue-operation-recovery.tsx",
    "ApprovalCard（Agent 操作确认） · src/features/conversation/permissions/approval-card.tsx",
    "ConversationOperationFeedback（操作反馈） · src/features/conversation/conversation-operation-feedback.tsx",
    "SubmissionReceipt（未知回执核对） · src/components/feedback/submission-receipt.tsx",
    "MaterialPreviewDialog（材料预览） · src/features/materials/material-preview.tsx",
    "MessageEnvironmentProvider（材料/附件上下文） · src/features/conversation/messages/message-environment.tsx",
    "ComposerNotification → NotificationToast（发送拒绝 Toast） · src/components/composer/composer-notification.tsx",
    "useLiveConversation → ConversationService（读取、缓存、草稿、队列与恢复） · src/features/conversation/use-live-conversation.ts",
    "useConversationControls / useConversationCommand / useConversationStopShortcut · src/features/conversation/",
    "PermissionService / CommandService（审批与命令服务线） · src/features/conversation/permissions/permission-service.ts、src/features/conversation/controls/command-service.ts",
  ],
  consumers: ["App · src/App.tsx"],
  viewport: {
    width: 1200,
    height: 800,
  },
  states: [
    {
      id: "page-ready",
      name: "进入、阅读并继续工作",
      section: "normal",
      condition: "已打开多轮整页会话且首读成功，下一稿为空，输入区可用。",
      expected:
        "头部状态、消息流与输入区同时可读；空闲发送被接收后可请求审批、查看上下文，压缩摘要可见，分支后可打开派生会话。",
      steps: [
        "首读多轮会话，核对标题、状态文本与消息流；第五轮前有已保存压缩摘要。",
        "在输入区键入下一稿并发送，展开演示控制确认接收原消息。",
        "回复生成后请求执行命令，在确认卡选择允许并确认收到决定，再发布示例工具结果。",
        "查看上下文用量读数；在已完成回复上创建分支，核对“派生自 · 来源标题”并打开派生会话。",
      ],
      render: () => <ConversationPageExample scenario="page-ready" />,
    },
    {
      id: "page-recovery",
      name: "异常恢复与草稿保留",
      section: "exception",
      condition:
        "首次读取等待可手动失败；发送拒绝、未知回执与队列操作失败由隔离服务驱动。",
      expected:
        "首读失败空态可重新加载；明确拒绝有 Toast 且原消息与下一稿保留；未知回执可核对；队列移除未知可核对不重复执行。",
      steps: [
        "首次读取等待时在输入区键入下一稿，展开演示控制点击使首次读取失败，再点击重新加载会话恢复多轮记录并核对草稿仍在。",
        "令下次发送明确拒绝后发送，核对 Toast 与两稿保留，修正后重新发送并确认接收。",
        "令下次发送结果未知后发送，核对原消息回显与 SubmissionReceipt，令原消息回执可确认后点击核对。",
        "令下次移除结果未知后移除队列项，核对恢复说明，令原队列操作回执可确认并重新核对。",
      ],
      render: () => <ConversationPageExample scenario="page-recovery" />,
    },
    {
      id: "page-running",
      name: "运行中发送与队列",
      section: "states",
      condition: "会话正在回复且队列可用；空稿或新稿由正式输入控件切换主动作。",
      expected:
        "空稿唯一主动作是停止，键入新稿后同一按钮切为排队；QueueDock 支持编辑、移除与补充；停止后队列暂停且内容保留。",
      steps: [
        "运行中空稿时悬停主按钮查看停止与 Esc Esc 提示，点击停止并在演示控制确认本次停止完成。",
        "再次进入运行后键入新稿，Enter 排队并在演示控制确认接收；核对 QueueDock 出现待处理项。",
        "编辑或移除队列项，核对归属与草稿；再以 Ctrl+Enter 补充，进入补充交付边界。",
        "停止当前工作，核对队列暂停且未发送内容保留，再由用户主动发送原项。",
      ],
      render: () => <ConversationPageExample scenario="page-running" />,
    },
    {
      id: "page-narrow",
      name: "会话切换与窄窗长内容",
      section: "states",
      condition: "多轮长内容会话与可切换会话；以窄窗阅读并继续输入。",
      expected:
        "切到其他会话再返回保留阅读位置与草稿；长正文正常换行、代码和宽表局部横向滚动，窄窗输入发送仍可达。",
      steps: [
        "在第五轮阅读长 Markdown、宽表与多行代码，核对代码和宽表局部横向滚动不撑宽页面。",
        "键入下一稿并上翻到较早轮次，切到另一个会话再返回原会话，核对阅读位置与草稿保留。",
        "以 390px 窄窗继续阅读与回到最新，确认输入区与发送仍可达。",
      ],
      render: () => <ConversationPageExample scenario="page-narrow" />,
    },
  ],
} satisfies CatalogEntry
