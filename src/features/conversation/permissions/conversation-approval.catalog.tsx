import type { CatalogEntry } from "../../../../ui-catalog/catalog-types"
import { ConversationIdleInputExample } from "../../../../ui-catalog/fixtures/conversation-idle-input-stories"

export default {
  id: "conversation-approval",
  name: "确认 Agent 操作",
  order: 306,
  source: "src/features/conversation/permissions/approval-card.tsx",
  composition: [
    "ApprovalCard / useApprovalReply · src/features/conversation/permissions/",
    "ConversationComposer · src/features/conversation/composer/conversation-composer.tsx",
    "Alert / Field / RadioGroup / Input / Button（审批变体） · src/components/ui/",
    "OperationFeedback / RecoveryAction · src/components/feedback/",
    "PermissionServiceContext · src/features/conversation/permissions/permission-service.ts",
    "ToolCall / MessageEnvironmentProvider · src/features/conversation/messages/",
    "LiveConversationView · src/features/conversation/live-conversation-view.tsx",
  ],
  group: "确认 Agent 操作",
  layer: "复合组件",
  stage: "content",
  pages: ["会话"],
  description:
    "沿 DSH 的审批输入区核对本次操作，明确允许一次或拒绝，再看到原请求的实际处理状态。",
  boundary:
    "直接复用正式会话、审批卡、工具消息和既有隔离服务。审批临时接管输入区，保留原草稿和队列；决定接收与工具结果由服务分别发布。扩展确认、选择、输入沿 Moon 已有宿主契约使用同一容器。示例不执行真实命令、不写入真实文件，不证明真实权限策略、工具执行或跨重启恢复已验收。",
  story: {
    goal: "在执行需要确认的操作前看清请求，再明确允许或拒绝。",
    preconditions: [
      "当前会话产生有效审批请求，服务按会话、运行及请求标识接收回答。",
      "当前权限由宿主提供，允许一次不改变会话权限模式。",
    ],
    result: "决定只作用于原请求，用户能区分等待确认、决定接收和后续工具结果。",
  },
  standards: [
    {
      id: "dsh-approval-composer",
      name: "DSH 审批接管输入区",
      rule: "审批沿 DSH ApprovalPanel 临时接管输入区。20px 卡片圆角、1px 琥珀边框；顶部色条内边距 10px/16px、文字 13px/18px。正文内边距 12px/16px/0、6px 间隔，原因 15px/24px，命令或路径 13px/20px 等宽字。正文最大 336px 局部滚动，底部按钮行固定可见。原草稿、材料和队列保持挂载并隐藏，输入浮层关闭，审批结束恢复。",
      reason: "当前操作清晰可见，保留未发送内容并沿 DSH 的输入区交互。",
      check:
        "在正式输入写下下一稿，再由服务产生审批；展开完整参数并完成审批，查看恢复的原稿。",
    },
    {
      id: "dsh-approval-actions",
      name: "允许一次与拒绝",
      rule: "按钮行靠右，14px/16px 内边距、8px 间隔；共享审批按钮 36px 高、12px 圆角、14px/22px 正常字重。允许一次用 DSH 中性主按钮；拒绝用 0.5px 中性描边，悬停浅红底与红字，按下不位移，禁用透明度 40%。详情区有焦点时 Enter 允许、Esc 拒绝；输入控件、按钮原生行为及 IME 优先，修饰键、重复键排除。",
      reason: "视觉及鼠标反馈沿 DSH 源码，快捷键不抢占输入或触发停止。",
      check:
        "悬停并操作两个按钮；详情区按 Enter/Esc，输入法确认时不提交扩展输入。",
    },
    {
      id: "approval-request-ownership",
      name: "决定属于原请求",
      rule: "提交状态按会话、epoch、runId 和请求 id 保留，切换会话不解锁待确认决定；发送等待和成功提交后均禁重复回答，等实际快照移除原请求。结果未知只能读取原请求；明确未接收可重新选择。到期或停止后的请求不可继续回答。工具等待通过 runId/toolCallId 关联，批准和实际工具结果分别显示。",
      reason: "迟到或未知决定不作用于另一请求，也不被当成工具执行成功。",
      check:
        "未知结果时读取状态并切换会话再返回；由服务接收原决定后单独发布工具结果。",
    },
    {
      id: "approval-extension-input",
      name: "扩展请求共用确认容器",
      rule: "confirm 用确认/取消，select 先单选再明确确认，input 使用已有 Input 并保护输入法确认与重复 Enter。取消返回宿主约定的 deny/cancel，确认返回该请求的原回答，不新增会话配置。",
      reason: "沿 Moon 已有扩展契约完成实际输入，同时复用审批样式和提交门禁。",
      check:
        "依次发起扩展确认、选择、输入，检查未选择时确认禁用及服务实际接收值。",
    },
  ],
  inputs: [
    "宿主 ConversationApproval：请求 id、runId、kind、原因、工具及参数、选项与到期时间。",
    "当前会话 id / epoch、PermissionService、重新读取状态入口及停止状态。",
  ],
  events: [
    "允许/拒绝或扩展确认通过 PermissionService.reply 回答原会话、运行及请求。",
    "请求消失和工具结果由正式 useLiveConversation 接纳，未发送草稿保持原归属。",
    "未知或到期只读取当前请求，不重复发送原决定。",
  ],
  consumers: [
    "LiveConversationView · src/features/conversation/live-conversation-view.tsx",
  ],
  viewport: { width: 1000, height: 760 },
  states: [
    {
      id: "tool-decision",
      name: "核对操作并允许或拒绝",
      section: "normal",
      condition:
        "既有隔离服务提供运行中的正式会话，由服务控制产生对应工具审批。",
      expected:
        "审批接管输入区且保留下一稿；决定被接收后恢复输入，工具结果单独出现。拒绝不会执行该工具。",
      steps: [
        "输入下一稿，展开演示控制并请求执行命令；查看原因、命令、参数和工具等待确认状态。",
        "悬停两个按钮，在审批详情区按 Enter 或点击允许一次；等待时不可重复选择。",
        "在演示控制确认收到本次决定，检查原稿恢复且工具尚无结果；再发布示例工具结果。",
        "请求访问外部文件，核对目标与完整参数后拒绝；确认接收后查看未执行结果与原稿。",
        "通过既有控制生成正文并结束工作，查看保留的工具记录。",
      ],
      render: () => <ConversationIdleInputExample scenario="approval-tool" />,
    },
    {
      id: "decision-rejected",
      name: "决定明确未被接收",
      section: "exception",
      condition: "隔离服务明确拒绝首次提交，原审批请求仍有效。",
      expected: "错误属于原请求，重新选择入口恢复；不显示已批准或已执行。",
      steps: [
        "请求执行命令并允许一次，读取明确未接收的原因。",
        "重新选择允许或拒绝，再确认收到本次决定；核对结果只属于同一请求。",
      ],
      render: () => (
        <ConversationIdleInputExample scenario="approval-rejected" />
      ),
    },
    {
      id: "decision-unknown",
      name: "决定结果未知与会话切换",
      section: "exception",
      condition: "隔离服务保留已发送的原决定，但首次回应丢失。",
      expected:
        "原请求显示结果待核对并禁重复回答；切换会话返回仍锁定，读取只核对，宿主移除原请求才恢复。",
      steps: [
        "保留下一稿，请求执行命令并允许一次；查看未知提示和禁用按钮。",
        "读取当前请求，再切换另一会话并返回，检查未知状态及下一稿仍保留。",
        "在演示控制确认收到本次决定，检查审批消失；单独发布示例工具结果。",
      ],
      render: () => (
        <ConversationIdleInputExample scenario="approval-unknown" />
      ),
    },
    {
      id: "extension-requests",
      name: "扩展确认、选择和输入",
      section: "states",
      condition:
        "既有服务依次产生 confirm/select/input 请求，使用同一正式审批卡。",
      expected:
        "每种请求有明确提交和取消动作；选择不立即提交，输入法确认不误发，实际回答可从服务接收值区分。",
      steps: [
        "请求扩展确认，确认或取消后由演示控制接收本次决定。",
        "请求扩展选择，观察确认禁用；选择一项并确认，再接收决定。",
        "请求扩展输入，用中文输入法填写标题并确认，再核对服务接收的原文。",
        "另一次请求通过已有控制撤回，检查原稿恢复；迟到决定不能作用于新请求。",
      ],
      render: () => (
        <ConversationIdleInputExample scenario="approval-extension" />
      ),
    },
  ],
} satisfies CatalogEntry
