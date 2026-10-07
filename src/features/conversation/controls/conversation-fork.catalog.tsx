import type { CatalogEntry } from "../../../../ui-catalog/catalog-types"
import { ConversationForkExample } from "../../../../ui-catalog/fixtures/conversation-fork-stories"

export default {
  id: "conversation-fork",
  name: "从完成轮次创建分支",
  order: 309,
  source: "src/features/conversation/controls/fork-action.tsx",
  composition: [
    "LiveConversationView → ConversationTurnView / ConversationPage（组合入口） · src/features/conversation/live-conversation-view.tsx",
    "ConversationTurnView → MessageActions（仅已关闭轮次尾部渲染动作组） · src/features/conversation/messages/conversation-turn-view.tsx",
    "MessageActions → ForkAction（只在可派生边界传入 onFork） · src/features/conversation/messages/message-actions.tsx",
    "ForkAction · src/features/conversation/controls/fork-action.tsx",
    "ForkFeedback（挂在原回复尾部） · src/features/conversation/controls/fork-feedback.tsx",
    "useConversationControls → ConversationControlService（提交、轮询与 issue 归属） · src/features/conversation/controls/use-conversation-controls.ts",
    "ConversationPage → lineage 标题区 / 打开来源会话（组合入口） · src/features/conversation/conversation-page.tsx",
  ],
  group: "从完成轮次创建分支",
  layer: "复合组件",
  stage: "content",
  pages: ["会话"],
  description:
    "从已保存的 Agent 回复尾部动作组创建独立普通会话并直接打开，错误、未知与完成反馈挂在原回复尾部，新会话标题区显示来源并可打开来源会话。展示直接组合正式 LiveConversationView、ConversationTurnView、MessageActions、ForkAction 与 ForkFeedback。",
  boundary:
    "职责只有派生入口、创建与导航、结果反馈和来源关系；不管输入、队列、材料与上下文压缩，也不复制来源未发送草稿。示例使用隔离快照与控制服务，创建结果由演示控制推动，不证明真实 Pi createBranchedSession、跨重启恢复或真实宿主导航；发送、停止、压缩及材料操作明确拒绝。",
  story: {
    goal: "从一个已完成的 Agent 回复另开普通会话，继续不同方向，并能随时回到来源会话。",
    preconditions: [
      "存在一条已保存、可派生的已完成 Agent 回复。",
      "来源会话空闲、无待答或未决上下文操作，且当前模型可用。",
    ],
    result:
      "用户得到带来源关系的新会话，原会话与未发送内容保留，操作结果在原回复尾部可读。",
  },
  standards: [
    {
      id: "fork-entry",
      name: "派生入口与可用边界",
      rule: "已保存 Agent 回复的尾部动作组显示 Lucide GitBranch 的 icon-sm 按钮，与复制和消息信息同组；用户消息没有同名入口。运行中或 stopReason 为 toolUse 的中间边界不渲染尾部动作组。来源执行、待答、压缩、待处理消息、边界未完成、旧格式只读历史或操作尚未确认时入口保留并禁用，Tooltip 给出进行中或具体禁用原因；当前模型不可用时同样说明。",
      reason:
        "派生必须从权威的已完成回复边界发起，不能出现在不可靠的中间位置，也不能用消失代替原因。",
      check:
        "在 fork-legacy-disabled 与 fork-busy-disabled 中悬停/聚焦末轮分支按钮读取 Tooltip 原因；在 fork-created 中确认两轮已完成回复各有一个入口，用户消息行没有同名按钮。",
    },
    {
      id: "fork-create-open",
      name: "点击即创建并打开",
      rule: "点击直接经 useConversationControls 调用 controls.fork(entryId) 创建普通新会话，不弹命名或确认；进行中禁止重复，完成且带 targetSessionId 时由 LiveConversationView 自动 onOpenConversation 打开。切换来源会话后，迟到结果不改变当前导航。",
      reason:
        "派生应是低摩擦动作，既不需要额外确认，也不能因重复点击产生多个分支或抢占别的导航。",
      check:
        "在 fork-created 点击末轮分支按钮，确认直接打开新会话且没有命名或确认弹窗；在 fork-unknown 确认未决期间按钮禁用且只有检查入口，没有第二个分支回执。",
    },
    {
      id: "fork-feedback",
      name: "反馈挂在原回复尾部",
      rule: "错误、未知与完成反馈都由 ForkFeedback 挂在发起操作的回复尾部；未知只查询冻结的原操作 ID，不重复创建；明确失败才提供重新创建；已完成且有新会话时提供打开新会话。",
      reason:
        "异步结果必须能对应到发起它的那条回复，未知不能被当作失败或成功。",
      check:
        "在 fork-failed 读取失败反馈与具体原因并点击重新创建分支；在 fork-unknown 点击检查分支结果，确认状态变为已创建后打开新会话。",
    },
    {
      id: "fork-lineage",
      name: "来源关系与空输入",
      rule: "派生会话复制根到所选回复的真实前缀，标题区显示“派生自 · 来源标题”，并在 headerActions 提供打开来源会话；新输入为空，不复制来源未发送材料或队列。",
      reason:
        "用户需要知道新会话的来源并在两侧之间往返，派生不应继承未发送内容。",
      check:
        "完成一次派生后读取标题区的来源说明，点击打开来源会话返回源会话；确认派生会话输入区为空、没有材料与队列。",
    },
  ],
  inputs: [
    "ConversationSnapshot：轮次尾部 entryId、status、stopReason、forkable 与 historyNotice。",
    "ConversationSnapshot.control：forkDisabledReason、busy 与当前操作回执。",
    "ConversationSnapshot.lineage：来源会话标识、标题与来源回复标识（仅派生会话）。",
    "HomeDraft：源与派生会话各自独立的空下一稿。",
  ],
  events: [
    "点击 ForkAction 调用 useConversationControls.fork(entryId)，经 ConversationControlService 提交原操作 ID。",
    "ForkFeedback 的检查分支结果 / 重新创建分支 / 打开新会话分别调用 read、重新 fork 与 onOpenConversation。",
    "LiveConversationView 在 completed 且带 targetSessionId 时调用 onOpenConversation 打开新会话；标题区打开来源会话返回 lineage.sourceSessionId。",
    "演示控制只推动未知结果确认与失败后允许重试；不直接改写正式组件状态。",
  ],
  consumers: [
    "LiveConversationView · src/features/conversation/live-conversation-view.tsx",
  ],
  viewport: {
    width: 1000,
    height: 760,
  },
  states: [
    {
      id: "fork-created",
      name: "创建并打开新会话",
      section: "normal",
      condition:
        "源会话有两轮已完成回复，末轮回复 forkable:true，控制空闲且模型可用。",
      expected:
        "点击后直接打开带 lineage 的新会话；源会话保留，新会话历史到所选回复为止、输入为空且无来源未发送内容。",
      steps: [
        "在末轮已完成回复的尾部动作组，点击 GitBranch“在新会话中分支”。",
        "确认直接打开新会话，没有命名或确认弹窗；标题区显示“派生自 · 项目会话派生讨论”。",
        "核对新会话历史到所选回复为止，输入区为空、没有材料与队列。",
        "点击标题区的“打开来源会话”返回源会话，核对两轮历史仍在，且原回复尾部显示“会话分支已创建”。",
      ],
      render: () => <ConversationForkExample scenario="fork-created" />,
    },
    {
      id: "fork-unknown",
      name: "结果待确认，只查原操作",
      section: "exception",
      condition: "首次提交返回 unknown，未决期间没有 targetSessionId。",
      expected:
        "反馈挂在原回复尾部，分支按钮禁用防重复；只查询原操作，确认后才打开新会话。",
      steps: [
        "点击末轮回复的分支按钮，读取“分支结果待确认”。",
        "确认反馈只有“检查分支结果”，分支按钮保持禁用（待确认期间标注正在创建），无法重复提交。",
        "展开演示控制点击“确认分支已创建”，再点击反馈里的“检查分支结果”。",
        "确认自动打开新会话并显示来源；点击“打开来源会话”返回源会话，可见原回复尾部的“会话分支已创建”与“打开新会话”。",
      ],
      render: () => <ConversationForkExample scenario="fork-unknown" />,
    },
    {
      id: "fork-failed",
      name: "明确失败后重新创建",
      section: "exception",
      condition: "首次提交被明确拒绝，未创建新会话。",
      expected:
        "失败反馈挂在原回复尾部，原会话不变；提供重新创建，成功后打开新会话。",
      steps: [
        "点击末轮回复的分支按钮，读取“会话分支未创建”和失败原因。",
        "确认仍停留在源会话，两轮历史与输入不变，反馈提供“重新创建分支”。",
        "展开演示控制点击“允许再次创建分支”，再点击反馈里的“重新创建分支”。",
        "确认打开带来源关系的新会话；点击“打开来源会话”返回并核对原回复保有完成反馈。",
      ],
      render: () => <ConversationForkExample scenario="fork-failed" />,
    },
    {
      id: "fork-legacy-disabled",
      name: "旧格式只读历史入口禁用",
      section: "states",
      condition: "末轮已完成回复 forkable:false，快照带旧格式只读历史说明。",
      expected:
        "分支入口仍出现但禁用，Tooltip 说明需先显式发送完成迁移；不创建会话。",
      steps: [
        "悬停或聚焦末轮回复的分支按钮，读取 Tooltip 的旧格式只读历史原因。",
        "确认按钮禁用，点击不产生操作回执，也没有新会话或自动导航。",
        "确认源会话两轮历史仍可阅读，输入区可用。",
      ],
      render: () => <ConversationForkExample scenario="fork-legacy-disabled" />,
    },
    {
      id: "fork-busy-disabled",
      name: "控制忙时入口禁用",
      section: "states",
      condition:
        "末轮回复 forkable:true，但快照 control.busy:true（有待处理的上下文操作）。",
      expected:
        "分支入口保留并禁用，Tooltip 说明“上下文操作尚未完成，请先查看其状态。”。",
      steps: [
        "悬停或聚焦末轮回复的分支按钮，读取忙碌原因。",
        "确认按钮禁用；源会话仍可阅读，未发送输入保留。",
        "核对没有创建回执，也没有自动导航到其他会话。",
      ],
      render: () => <ConversationForkExample scenario="fork-busy-disabled" />,
    },
  ],
} satisfies CatalogEntry
