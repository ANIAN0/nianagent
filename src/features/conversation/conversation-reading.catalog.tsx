import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { ConversationReadingExample } from "../../../ui-catalog/fixtures/conversation-reading-stories"

export default {
  id: "conversation-reading",
  name: "阅读并定位会话内容",
  order: 300,
  source: "src/features/conversation/live-conversation-view.tsx",
  composition: [
    "LiveConversationView → ConversationPage / ConversationTurnView / ConversationComposer（组合入口） · src/features/conversation/live-conversation-view.tsx",
    "useLiveConversation → ConversationService（读取、缓存与草稿） · src/features/conversation/use-live-conversation.ts",
    "ConversationPage → ConversationHeader / ConversationList（组合入口） · src/features/conversation/conversation-page.tsx",
    "ConversationHeader · src/features/conversation/conversation-header.tsx",
    "ConversationReadFeedback → Empty / StatusMessage / RecoveryAction（读取失败组合） · src/features/conversation/conversation-read-feedback.tsx",
    "ConversationList → ConversationNavigator（组合入口） · src/features/conversation/conversation-list.tsx",
    "ConversationNavigator · src/features/conversation/conversation-navigator.tsx",
    "ConversationTurnView → UserMessage / MarkdownContent / MessageActions（组合入口） · src/features/conversation/messages/conversation-turn-view.tsx",
    "ConversationCompactionRecord → CompactionRecord（已保存压缩摘要） · src/features/conversation/controls/conversation-compaction-record.tsx",
    "CompactionRecord · src/features/conversation/controls/compaction-record.tsx",
    "CompactionRow（DSH命令与摘要行） · src/features/conversation/controls/compaction-row.tsx",
    "MessageScroller · src/components/ui/message-scroller.tsx",
    "ConversationComposer · src/features/conversation/composer/conversation-composer.tsx",
  ],
  group: "阅读并定位会话内容",
  layer: "复合组件",
  stage: "content",
  pages: ["会话"],
  description:
    "打开已有会话，阅读用户原输入、同轮回复与已保存压缩摘要，定位历史内容并主动返回最新消息。压缩摘要使用DSH紧凑行展开Markdown，归本故事；命令提交和操作状态归空闲时继续输入。展示直接组合正式 LiveConversationView 与完整输入区。",
  boundary:
    "轮次以用户输入划分，多个 assistant 步骤仍属于同轮。至少两轮且会话容器宽于900px才显示轮次轨；方向/Home/End切换焦点与预览，Enter/Space激活跳转。位置只在当前窗口保存，整页刷新回最新。示例使用隔离历史与服务，故障和回复增长为手动数据驱动，不证明真实宿主读取、Skill执行或模型流式行为；发送、配置写入、材料读取及Agent操作明确拒绝，不连接生产服务。",
  story: {
    goal: "阅读已发送的输入和 Agent 回复，定位需要的轮次，并在查看历史后回到最新内容。",
    preconditions: [
      "已打开一个会话，正在读取或已有记录。",
      "宽容器的多轮会话提供轮次轨；窄容器仍可滚动与回到最新。",
    ],
    result:
      "用户找到目标内容，能继续原位置阅读，或主动回到最新并跟随后续内容。",
  },
  standards: [
    {
      id: "original-input",
      name: "原输入与同轮回复可辨认",
      rule: "用户文字按原文展示；一次用户输入形成一轮，多个回复步骤不拆成额外用户轮次。",
      reason: "读者需要把自己的问题与对应回复准确关联。",
      check:
        "阅读第一轮的普通Skill调用文字与第二轮的多步骤回复，核对正文及轮次预览，不把示例文字当作宿主Skill执行证据。",
    },
    {
      id: "message-info",
      name: "本轮用量明细对齐DSH",
      rule: "用量入口触发点显示图标与聚合文案（用量 X token）；弹窗对齐DSH stat-dialog：标题行千分位总量无单位、下接0.5px分隔线，明细行数值右对齐，含模型、缓存命中、未缓存输入、缓存读取、缓存写入、输出（单位 token）；未记录字段省略，不显示时间、耗时、费用、角色与执行状态。",
      reason:
        "核对一条回复的真实开销时与DSH用量对话框同构，不被推断或重复信息干扰。",
      check:
        "打开最新回复的信息弹窗，核对总量与分项逐条对应运行数据并检查标签不换行；无统计的轮次不显示入口。",
    },
    {
      id: "turn-navigation",
      name: "预览后激活定位",
      rule: "宽容器多轮会话可悬停或聚焦查看原输入和末端回复摘要，激活后定位对应轮次。方向/Home/End改变焦点，Enter/Space激活。",
      reason: "先识别目标再跳转，避免移动焦点时打断阅读。",
      check:
        "悬停不同刻度，再以键盘选中并激活；目标轮次原输入在阅读区出现，当前刻度可辨认。",
    },
    {
      id: "reader-control",
      name: "历史阅读与跟随最新分开",
      rule: "上翻阅读时内容增长不抢位置；主动回到最新后继续跟随。离开再返回保留同一内容与偏移。",
      reason: "新进展和读者选择的位置应同时受到尊重。",
      check:
        "增长场景先上翻并追加正文，再回到最新并继续追加；离开返回场景保留草稿与阅读位置，整页刷新不承诺恢复。",
    },
    {
      id: "read-recovery",
      name: "读取失败保留现有内容",
      rule: "首次读取失败在阅读区居中显示16px标题、13px原因和重新加载按钮；已有历史刷新失败在滚动区外显示紧凑状态行，13px红色短标题、灰色原因和同组蓝色重试链接。不显示原始错误码，不重复Toast，不把恢复动作放到标题栏或输入区。保留已有内容和下一稿。",
      reason: "读取故障不能被误认为原内容或正在编辑的文字消失。",
      check:
        "从等待触发失败并正式重新读取；另在缓存场景键入下一稿后触发刷新失败，再恢复，核对原内容与草稿。",
    },
    {
      id: "local-overflow",
      name: "长内容局部阅读",
      rule: "长正文正常换行，宽表和代码局部横向滚动，不撑宽页面；窄窗口保留滚动、回最新和输入入口。",
      reason: "内容长度与类型不应夺走整个页面的可操作空间。",
      check:
        "用长内容场景检查浅深主题及390px窄窗，横向阅读代码和宽表，同时核对输入区与回最新可达。",
    },
  ],
  inputs: [
    "ConversationSnapshot：会话原输入、回复步骤、版本与执行状态。",
    "ConversationSnapshot.compactions：已保存摘要与所属历史位置；缺少DSH压缩计数时显示摘要可用性文案，不替用Pi压缩前总量。",
    "ComposerDraft：与服务快照独立的下一稿；完整正式输入区仍可编辑。",
    "ConversationService：owner初次挂载捕获的稳定依赖；默认正式工厂，示例显式提供内存替身。",
    "readingPositions：当前窗口按会话保存锚点、偏移和跟随状态。",
  ],
  events: [
    "读取和跟随由useLiveConversation驱动；正式重新读取入口接收服务恢复后的新版本结果。",
    "轮次定位与回到最新由正式MessageScroller处理，位置变化保存到当前窗口Map。",
    "ConversationCompactionRecord在原历史位置展开Markdown摘要；手动压缩与所属命令结果合并，没有摘要时禁用展开。",
    "演示控制只切换服务可用性、发布正文增量或离开/返回；不直接设置正式读取错误或滚动位置。",
  ],
  consumers: ["App → LiveConversationView · src/App.tsx"],
  viewport: { width: 1000, height: 760 },
  states: [
    {
      id: "multi-turn",
      name: "阅读、预览并定位轮次",
      section: "normal",
      condition: "打开已有多轮会话，下一稿为空；记录通过正式hook首次读取。",
      expected:
        "原输入和同轮回复可读，预览识别目标轮次，激活跳转后可主动回到最新。",
      steps: [
        "阅读原输入和回复；第二轮包含多个assistant步骤。",
        "悬停轮次轨，查看原输入与末端回复摘要。",
        "聚焦刻度，以方向/Home/End选择，再用Enter或Space跳转。",
        "上翻后点击回到最新消息，核对最新内容与入口状态。",
      ],
      render: () => <ConversationReadingExample scenario="multi-turn" />,
    },
    {
      id: "initial-read-recovery",
      name: "首次读取等待、失败与恢复",
      section: "exception",
      condition:
        "首次follow(undefined)等待，尚无可显示的记录；完整输入区保留。",
      expected:
        "等待与失败原位可辨认，正式重新读取后显示目标会话；期间编辑的草稿保留。",
      steps: [
        "观察正在读取会话，在输入区键入下一稿。",
        "展开演示控制，点击使首次读取失败。",
        "阅读居中的首次读取失败空态，点击重新加载会话；原因和动作同组，没有标题栏孤立按钮或重复Toast。",
        "核对多轮记录出现，下一稿文字仍在。",
      ],
      render: () => (
        <ConversationReadingExample scenario="initial-read-recovery" />
      ),
    },
    {
      id: "cached-read-recovery",
      name: "刷新失败保留内容与下一稿",
      section: "exception",
      condition: "已有多轮记录，读取服务可用，下一稿从真实输入开始。",
      expected:
        "刷新失败仍可读原记录，草稿不丢；正式重新读取只清对应读取错误。",
      steps: [
        "在完整输入区键入下一稿并上翻阅读。",
        "展开演示控制，点击使刷新失败。",
        "核对旧记录和下一稿仍在；无论当前阅读位置，都能看到历史更新失败、灰色原因及同组重试入口。",
        "点击状态行的重试，确认错误解除，原内容、阅读位置和草稿仍保留；输入区没有读取恢复条。",
      ],
      render: () => (
        <ConversationReadingExample scenario="cached-read-recovery" />
      ),
    },
    {
      id: "long-content",
      name: "长正文、代码和宽表",
      section: "states",
      condition: "已有多轮记录，第五轮包含长Markdown、宽表与多行代码。",
      expected:
        "长内容不撑出整页，代码与表格分别局部横向阅读，窄窗口输入区与回最新仍可达。",
      steps: [
        "在宽容器定位第五轮，阅读标题、段落、列表与代码。",
        "核对三列短表无需多余横滚，再横向阅读宽表和长代码行，尝试复制代码。",
        "切换浅深主题及390px窄窗，继续滚动和回到最新。",
        "窄于或等于900px时轮次轨隐藏，不把隐藏当成故障。",
      ],
      render: () => <ConversationReadingExample scenario="long-content" />,
    },
    {
      id: "streaming-history",
      name: "正文增长与读者控制",
      section: "states",
      condition: "已有多轮记录；新回复及其增长由演示控制手动发布。",
      expected:
        "同条回复增量可读，上翻不被增长抢位，回到最新后后续增长重新跟随。",
      steps: [
        "展开演示控制，点击开始回复增长，再追加一段回复。",
        "向上滚动到历史，继续追加一段，核对正在阅读的位置。",
        "点击正式回到最新消息，再追加正文，核对跟随恢复。",
        "点击结束回复，核对正文保留、运行状态结束。",
      ],
      render: () => <ConversationReadingExample scenario="streaming-history" />,
    },
    {
      id: "return-position",
      name: "离开再返回继续阅读",
      section: "states",
      condition:
        "当前窗口已打开多轮会话；owner、服务、草稿和位置Map在离开期间保留。",
      expected:
        "返回原会话恢复同一内容与偏移，下一稿保留；跟随最新时返回仍定位最新。",
      steps: [
        "键入下一稿，上翻到较早轮次并停在段落中部。",
        "展开演示控制，离开会话，再返回会话。",
        "核对原段落、偏移和下一稿；随后回最新并再次离开返回。",
        "组件库重置是新iframe与新隔离存储；整页刷新不承诺恢复阅读位。",
      ],
      render: () => <ConversationReadingExample scenario="return-position" />,
    },
    {
      id: "empty-history",
      name: "无历史的就绪会话",
      section: "states",
      condition: "目标会话读取成功，但没有消息记录。",
      expected:
        "不伪造历史或持续显示读取中；完整输入区可编辑，外围执行明确说明演示边界。",
      steps: [
        "等待首次读取完成，核对就绪空会话与完整输入区。",
        "打开模型、权限和会话配置，查看隔离目录与当前配置。",
        "输入文字，尝试发送后读取明确拒绝反馈，核对草稿仍在。",
      ],
      render: () => <ConversationReadingExample scenario="empty-history" />,
    },
  ],
} satisfies CatalogEntry
