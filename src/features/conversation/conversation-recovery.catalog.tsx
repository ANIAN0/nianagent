import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { ConversationIdleInputExample } from "../../../ui-catalog/fixtures/conversation-idle-input-stories"

export default {
  id: "conversation-recovery",
  name: "停止与恢复回复",
  order: 305,
  source: "src/features/conversation/live-conversation-view.tsx",
  composition: [
    "ConversationComposer → ConversationSendControl（组合入口） · src/features/conversation/composer/conversation-composer.tsx",
    "ConversationSendControl · src/features/conversation/composer/conversation-send-control.tsx",
    "ConversationOperationFeedback · src/features/conversation/conversation-operation-feedback.tsx",
    "LiveConversationView / useLiveConversation / useConversationStopShortcut · src/features/conversation/",
    "ConversationTurnView / ExecutionProcess · src/features/conversation/messages/",
  ],
  group: "停止与恢复回复",
  layer: "复合组件",
  stage: "content",
  pages: ["会话"],
  description:
    "沿 DSH 停止当前回复，保留已生成内容和下一稿，再从输入框主动发送后续需求。",
  boundary:
    "直接复用正式 LiveConversationView、ConversationComposer、ConversationTurnView 与 useLiveConversation；复用已有隔离输入服务和控制，不新增演示状态机。停止完成和回复结果由服务发布，不以点击或快捷键冒充已停止。结果未知的核对属于 Moon 宿主恢复接口；隔离示例不证明真实模型、工具停止或跨重启恢复已验收。",
  story: {
    goal: "停止当前执行，了解回复未完成的原因，并在明确状态后决定如何继续。",
    preconditions: [
      "当前轮仍在执行，或已停止、失败、达到输出上限。",
      "恢复动作须基于当前会话的实际状态。",
    ],
    result: "用户能区分停止请求、已停止和继续结果，不丢已有内容。",
  },
  standards: [
    {
      id: "dsh-stop-action",
      name: "DSH 停止入口",
      rule: "运行中空稿或不可发送时沿用唯一主按钮停止；16px 实心圆角方块，500ms 顶部提示附 Esc Esc。双 Esc 默认间隔 500ms，只作用于同一会话、运行和历史或输入焦点区域；候选、弹窗、队列编辑、IME、修饰键及自动重复优先排除。切换运行、会话、焦点区域或窗口失焦重置序列。",
      reason: "停止当前执行时保留输入焦点，避免关闭浮层的 Esc 意外停止任务。",
      check:
        "从运行中空稿点击停止；另一次运行保留下一稿并连续两次 Esc，核对草稿不变。",
    },
    {
      id: "authoritative-stop-result",
      name: "停止请求与实际停止分开",
      rule: "请求等待时显示正在停止并禁止重复请求；已停止须由当前运行的宿主终态确认。普通取消使用 DSH 的 11px/18px 中性已停止标记，有执行过程时其收起标题也为已停止；不显示 cancelled 错误行。已输出内容、未发送草稿与暂停队列保留。",
      reason: "请求发出不能被视为工具和模型已经结束。",
      check:
        "先观察停止等待，再通过已有服务控制确认完成；检查旧回复、下一稿及暂停的队列。",
    },
    {
      id: "stop-recovery",
      name: "停止失败与未知结果",
      rule: "明确失败按宿主恢复策略处理；结果未知保留核对运行状态入口，禁重复停止，用静止的禁用停止图标，不持续旋转。迟到结果只归原会话运行；停止操作不占发送回执锁，不清除原消息的未知接收结果。",
      reason: "异步停止不能覆盖新一轮的状态或丢失原发送回执。",
      check:
        "结合真实宿主核对拒绝、超时与 run_stop_failed；确认仅重新读取运行状态，原输入仍可恢复。",
    },
    {
      id: "dsh-follow-on-input",
      name: "主动发送后续需求",
      rule: "停止、失败或输出上限后从正常输入框发送继续或新需求，不添加继续上次回复按钮；输出上限保留 DSH 的发送继续提示。已有内容与原状态保留，不自动提交下一稿或消费暂停队列。",
      reason: "继续内容由用户表达，沿统一的输入和发送交互。",
      check:
        "停止或失败后输入后续需求，确认接收及结束；输出上限沿正式消息的 length 状态显示。",
    },
  ],
  inputs: [
    "当前会话、运行、宿主快照与停止请求等待状态。",
    "保留的 HomeDraft、待处理队列及消息终态。",
  ],
  events: [
    "点击或双 Esc 调用当前运行的 stop 服务。",
    "停止终态由正式 hook 接纳；核对仅重新读取运行状态。",
    "继续由正常输入的 send 服务接收。",
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
      id: "stop-and-send",
      name: "停止后继续输入",
      section: "normal",
      condition: "既有隔离服务启动正在运行的正式会话，输入为空。",
      expected:
        "请求等待与已停止可区分；旧输出保留，下一稿可编辑，继续使用正式发送入口。",
      steps: [
        "悬停主按钮查看停止及 Esc Esc 提示，然后点击停止。",
        "等待期间输入下一稿，在折叠演示控制中确认本次停止完成；检查已停止标记与原稿。",
        "发送后续需求，在演示控制确认接收、生成正文和结束本次工作。",
        "本次运行中保留下一稿，在输入区连续两次 Esc；确认完成后检查草稿仍在。",
      ],
      render: () => <ConversationIdleInputExample scenario="running-normal" />,
    },
    {
      id: "failed-and-send",
      name: "失败后发送后续需求",
      section: "exception",
      condition: "复用已有空闲输入服务，从正常输入开始触发生成失败。",
      expected:
        "失败属于原运行并保留已有内容；用户从输入框修正或继续，没有额外继续按钮。",
      steps: [
        "发送需求，在演示控制确认接收并生成正文。",
        "输入下一稿，通过已有控制令本次回复失败；查看原运行的失败说明。",
        "编辑并发送后续需求，确认接收与结束；检查原失败记录和旧输出仍可阅读。",
      ],
      render: () => <ConversationIdleInputExample scenario="idle-submit" />,
    },
    {
      id: "stop-with-queued-draft",
      name: "保留下一稿和待处理消息",
      section: "states",
      condition: "运行中通过正式输入排队，再停止当前工作。",
      expected:
        "双 Esc 可在有下一稿时停止；结束前不显示已停止，结束后队列暂停且内容保留。",
      steps: [
        "输入待处理需求，Enter 排队并在演示控制确认接收。",
        "输入下一稿，连续两次 Esc 发起停止；确认本次停止完成。",
        "检查下一稿与暂停队列仍在；需要执行时由用户主动发送。",
      ],
      render: () => <ConversationIdleInputExample scenario="running-normal" />,
    },
  ],
} satisfies CatalogEntry
