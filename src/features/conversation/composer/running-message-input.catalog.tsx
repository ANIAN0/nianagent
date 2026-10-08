import type { CatalogEntry } from "../../../../ui-catalog/catalog-types"
import { RunningMessageStoryExample } from "../../../../ui-catalog/fixtures/running-message-stories"

export default {
  id: "running-message-input",
  name: "运行中发送新消息",
  group: "运行中发送新消息",
  layer: "复合组件",
  stage: "content",
  order: 304,
  pages: ["会话"],
  source: "src/features/conversation/composer/conversation-composer.tsx",
  description:
    "按 DSH 的单一主动作和紧凑队列，在工作运行时排队下一条需求，或补充当前工作。",
  boundary:
    "直接使用 LiveConversationView、ConversationComposer、QueueDock 和 useLiveConversation，接收、交付边界与终态由隔离服务控制。运行状态不由演示组件直接改写；不运行真实模型或证明真实宿主、跨重启恢复已验收。输入区没有 Enter 或逐条/全部配置入口；现有宿主交付协议及暂停恢复继续保留，补充是否能进入当前工作由宿主决定。",
  story: {
    goal: "当前工作运行时继续表达需求，明确选择排队或补充，并管理尚未处理的消息。",
    preconditions: ["当前会话正在执行，输入为空。", "所选模型和工作目录有效。"],
    result:
      "当前工作和待处理内容归属清楚；已接收、未接收和未知结果可区分，下一稿不会被原请求覆盖。",
  },
  standards: [
    {
      id: "dsh-running-primary",
      name: "DSH 单一主动作",
      rule: "普通运行会话空稿或不可发送时显示唯一停止按钮；有可发送新稿时同一按钮改为发送，不再附第二个停止按钮。点击与 Enter 均排队，Ctrl/Cmd+Enter 补充，Shift+Enter 换行；候选和 IME 优先。",
      reason: "新输入与当前执行共用清楚的主动作。",
      check:
        "从空稿输入新需求、清空并重新输入，检查唯一主按钮切换；用 Enter 排队及 Ctrl/Cmd+Enter 补充。",
    },
    {
      id: "dsh-queue-dock",
      name: "DSH 紧凑队列与原位编辑",
      rule: "队列紧贴输入卡上沿；单条直接显示，多条默认折叠为数量。36px 行、24px 附件条、28px 编辑/移除/补充图标。纯文字原行编辑，Enter 保存、Shift+Enter 换行、Escape 取消；摘要和文件图片条只作展示，无整行悬停背景及点击浮层；含附件条目可移除和补充，正文编辑禁用并保原生说明。图标仅局部圆形悬停、颜色不变且不位移，500ms底部紧凑提示、内侧2px焦点圈。",
      reason: "待处理输入可就地管理，不另起输入卡或重复说明区。",
      check:
        "从空稿提交一条再两条，展开多条、编辑保存与取消、移除；添加文件和图片并查看身份条及禁用原因。",
    },
    {
      id: "authoritative-delivery",
      name: "接收与实际交付分开",
      rule: "排队提交等待回执留在队列原项；接收后留在待处理列表，只有宿主实际交付后进入会话记录。补充是边界请求，不承诺立即消费。停止后队列暂停，原条目和下一稿保留。",
      reason: "接收不能被显示成已经执行。",
      check:
        "排队发送后先观察等待，确认接收后检查仍在队列；结束当前工作触发后续交付。补充接收后通过服务边界消费；停止完成后检查暂停并主动发送原项。",
    },
    {
      id: "running-request-recovery",
      name: "保留原请求与下一稿",
      rule: "明确拒绝用共享 Toast，原稿与下一稿保留；未知结果在原排队项核对同一个请求，禁止重复发送。编辑、移除和交付沿原回执与持久草稿恢复，不靠前端删除模拟成功。",
      reason: "运行中的迟到结果不能覆盖正在编辑的新需求。",
      check:
        "提交后编辑下一稿，再分别拒绝和丢失回应；确认原回执，检查下一稿和材料仍在，原请求不会重复。",
    },
  ],
  inputs: [
    "运行快照、权威队列及原请求回执。",
    "当前会话 ComposerDraft、现有模型和材料资格。",
    "固定默认 Enter 排队、Ctrl/Cmd+Enter 补充；现有宿主队列及原操作恢复。",
  ],
  events: [
    "正式发送入口保存原提交与下一稿，并按 followUp/steer 调用服务。",
    "编辑、移除和补充经正式队列服务回写，回执不明时核对原请求。",
    "演示控制仅发布隔离服务的接收、边界和终态。",
  ],
  composition: [
    "ConversationComposer · src/features/conversation/composer/conversation-composer.tsx",
    "ConversationSendControl · src/features/conversation/composer/conversation-send-control.tsx",
    "QueueDock / QueueEditEditor / QueueAttachments · src/features/conversation/composer/",
    "QueueActionHint · src/features/conversation/composer/queue-action-hint.tsx",
    "LiveConversationView / useLiveConversation · src/features/conversation/",
  ],
  consumers: [
    "LiveConversationView · src/features/conversation/live-conversation-view.tsx",
  ],
  viewport: { width: 1000, height: 720 },
  states: [
    {
      id: "normal",
      name: "排队、编辑与补充",
      section: "normal",
      condition: "正式会话正在运行，输入为空、队列为空。",
      expected:
        "从正常输入完成接收、排队管理和实际交付；单条/多条及编辑样式沿 DSH。",
      steps: [
        "输入下一条需求并按 Enter，在演示控制确认接收；观察等待项留在队列而非历史。",
        "编辑原条目，Shift+Enter 换行、Enter 保存；再次编辑后 Escape 取消。",
        "再排队一条并确认接收，展开数量行，移除其中一条。",
        "输入补充，Ctrl/Cmd+Enter 提交并确认接收，再进入补充交付边界；检查正文进入当前运行。",
        "输入并保留下一稿，结束本次演示工作；检查后续队列交付与草稿归属。",
      ],
      render: () => <RunningMessageStoryExample />,
    },
    {
      id: "rejected",
      name: "明确拒绝与下一稿",
      section: "exception",
      condition: "运行中提交新需求，服务可明确拒绝。",
      expected: "原稿与下一稿保留，Toast 说明拒绝；当前工作继续。",
      steps: [
        "发送新需求，等待期间写下一稿。",
        "在演示控制明确拒绝本次请求；检查两稿保留，再主动发送并确认接收。",
      ],
      render: () => <RunningMessageStoryExample scenario="running-rejected" />,
    },
    {
      id: "unknown",
      name: "排队结果未知",
      section: "exception",
      condition: "第一次运行中发送丢失回应，原请求仍可核对。",
      expected:
        "原排队项显示待核对，核对成功后仍按宿主队列处理，不重复发送；下一稿保留。",
      steps: [
        "排队发送并编辑下一稿，观察原项核对入口。",
        "令原消息回执可确认，再从原项核对；结束当前工作并检查交付。",
      ],
      render: () => <RunningMessageStoryExample scenario="running-unknown" />,
    },
    {
      id: "paused-materials",
      name: "附件与停止后的暂停",
      section: "states",
      condition: "运行中空稿；文件图片由隔离材料服务提供。",
      expected:
        "紧凑附件条显示文件大小和图片身份，含附件正文不编辑；停止完成后仍保留暂停队列，可主动继续。",
      steps: [
        "通过加号选择附件或 @ 引用文件，发送并确认接收。",
        "阅读队列材料身份，查看编辑禁用原因；在 390px 窄窗核对入口可达。",
        "清空新稿并停止，在演示控制确认停止完成；从原条目发送此消息。",
      ],
      render: () => <RunningMessageStoryExample scenario="running-paused" />,
    },
  ],
} satisfies CatalogEntry
