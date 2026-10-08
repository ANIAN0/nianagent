import type { CatalogEntry } from "../../../../ui-catalog/catalog-types"
import { ConversationExecutionExample } from "../../../../ui-catalog/fixtures/conversation-execution-stories"

export default {
  id: "conversation-execution",
  name: "跟随执行并查看工具",
  order: 301,
  source: "src/features/conversation/messages/execution-process.tsx",
  composition: [
    "LiveConversationView → ConversationPage / ConversationComposer（完整组合入口） · src/features/conversation/live-conversation-view.tsx",
    "useLiveConversation → 稳定ConversationService（正式读取、跟随与草稿） · src/features/conversation/use-live-conversation.ts",
    "ConversationTurnView · src/features/conversation/messages/conversation-turn-view.tsx",
    "ConversationTurnFeedback · src/features/conversation/conversation-turn-feedback.tsx",
    "ExecutionProcess → ThinkingBlock / ToolCall（组合入口） · src/features/conversation/messages/execution-process.tsx",
    "ThinkingBlock · src/features/conversation/messages/thinking-block.tsx",
    "ToolCall · src/features/conversation/messages/tool-call.tsx",
    "MessageEnvironmentProvider · src/features/conversation/messages/message-environment.tsx",
  ],
  group: "跟随执行并查看工具",
  layer: "复合组件",
  stage: "content",
  pages: ["会话"],
  description:
    "跟随同一轮中思考、文字与工具调用，区分工具失败、模型重试、终态失败和同运行后续恢复；场景使用完整正式组合并手动发布隔离数据。",
  boundary:
    "工具成功不等于任务达成。returned只证明工具已结束，unknown表示执行情况无法确认；缺记录不证明未执行。结果可用事实独立于状态，空的真实结果仍为available，部分输出与缺失结果分别表达。示例不执行模型、工具或真实写入，未执行条目仅为明确标记的隔离数据；发送、停止、配置及材料操作经隔离服务明确拒绝并保稿。不验证真实宿主流式、审批或停止恢复。",
  story: {
    goal: "知道 Agent 当前在做什么，并按需查看思考、工具输入和真实结果。",
    preconditions: [
      "当前会话有正在执行或已结束的 Agent 轮次。",
      "该轮可能包含思考或工具调用。",
    ],
    result: "用户能从真实执行过程判断进展与失败位置。",
  },
  standards: [
    {
      id: "terminal-failure",
      name: "当前与历史失败共用DSH行内反馈",
      rule: "实心状态点、短标题、具体原因和可选错误码沿用DSH终态行，不附更多按钮、诊断弹窗或继续按钮。具体原因属于实际回复条目；当前终态精确去重，同轮同运行后有完整成功正文才显示后续已恢复。工具失败与模型终态分开，不用大红底卡，也不因重试倒计时归零补成功。",
      reason: "完整执行结果不能只靠输入或工具卡样式验收。",
      check:
        "执行中令本次回复失败，阅读错误行；重置走重试场景，到0仍等待，再分别令终态失败或手动恢复并完成。当前原因一次、历史恢复清楚，草稿和离开返回保留，错误行无更多按钮或弹窗。",
    },
    {
      id: "ordered-process",
      name: "进展与结果分别表达",
      rule: "同一轮可包含多个assistant步骤，每步思考、中间回复和工具按实际块次序保留，各调用身份稳定。最后一次无工具的assistant回复仍可有自己的思考，再生成正文；无思考内容不生成空思考区。",
      reason: "用户需要知道当前在做什么，并能把结论与真实依据对上。",
      check:
        "从等待走完第一步思考/中间回复/read结果、第二步思考/中间回复/bash结果，再读最后一步思考和正文增量；前步不被后步覆盖，同一调用不重复，纯正文不出现空过程。",
    },
    {
      id: "honest-result",
      name: "缺结果不猜未执行或成功",
      rule: "状态与resultAvailability独立。只有真实最终结果才available；partial明确仅部分输出，missing不冒充正文。已返回不等于成功，缺记录不当作未执行。",
      reason:
        "缺失记录或失败回查不能诱导重复执行，也不能把空输出误称丢失结果。",
      check:
        "读取缺结果历史，逐项查看unknown、returned、failed、stopped、明确未执行及空available；旧字段省略不从空文本推missing。",
    },
    {
      id: "active-reading",
      name: "结束保留主动阅读",
      rule: "默认未主动阅读时正常结束收纳。运行中主动展开思考、工具或参数，或聚焦/点击本过程已展开内容后，结束保留内容节点和焦点；可显式收纳。",
      reason: "回复完成不应隐藏用户正在看的依据或移走键盘焦点。",
      check:
        "先用默认多步流程核结束收纳；重置后在工具参数触发器保持焦点，以Ctrl+Alt+F9推进第二步与最终思考/正文，正文生成后Ctrl+Alt+F10结束，核对节点、焦点与局部阅读位置，随后显式收纳。",
    },
    {
      id: "tool-detail",
      name: "核心结果与次级参数",
      rule: "先呈现核心输出或可信差异，原始参数次级展开。命令目录、退出码和耗时仅显示已有事实；未提供保持未知。",
      reason: "用户能先读结果，再按需核查执行对象与参数。",
      check:
        "展开read和bash，读取输出、目录、退出码和耗时；以键盘展开原始参数并复制真实文字。",
    },
    {
      id: "local-reading",
      name: "长结果局部阅读",
      rule: "结果与参数局部滚动，超过20行可展开已保存内容；差异保持局部阅读。截断说明不称完整输出，不支持的扩展展示保留实际文本。",
      reason: "长内容不能撑出整页或掩盖输入入口，也不能以展示代替结果事实。",
      check:
        "长结果场景读取保存内容、差异和长参数，切换1000px与390px、浅深主题；上翻后驱动增长、返回最新后恢复跟随。",
    },
    {
      id: "retry-feedback",
      name: "重试等待仍有明确进展",
      rule: "次数、原因和等待时点来自运行数据；倒计时到0不自行宣告成功。工具失败原因和结果保留，不以整轮结束覆盖。",
      reason: "用户能区分等待下一次尝试、工具失败与最终回复结束。",
      check:
        "失败场景看真实exit7结果；重试场景手动开始模型重试，等待倒计时，再手动恢复并读最终正文。",
    },
  ],
  inputs: [
    "ConversationSnapshot：版本、运行反馈、有序消息块及每次工具调用的状态和结果可用事实。",
    "ComposerDraft：空的独立下一稿，经完整正式ConversationComposer编辑。",
    "稳定ConversationService与Session/Permission/Material/Extension/Command服务：示例全部显式隔离。",
    "MessageEnvironment：当前会话和块occurrence的展开选择；阅读位置沿当前窗口Map。",
  ],
  events: [
    "正式useLiveConversation接纳隔离服务发布的新版本；同版本follow等待并可取消。",
    "正式展开动作及本过程已展开内容的焦点/指针活动，仅运行中保留当前process展开选择。",
    "折叠演示控制手动推进数据；Ctrl+Alt+F9下一步，Ctrl+Alt+F10仅在可结束阶段结束回复，不移动阅读焦点。",
    "离开返回保同一服务、草稿和Map；组件库重置创建新iframe及新owner，退出清理订阅、等待请求和快捷键。",
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
      id: "execution-journey",
      name: "等待、思考、多工具与最终回复",
      section: "normal",
      condition: "原输入已接受，当前等待回复，下一稿为空；尚无完成工具结果。",
      expected:
        "运行反馈与有序过程可读；未主动阅读时结束收纳，主动阅读时内容和焦点保留，结束仍可回查。",
      steps: [
        "第一步开始思考→第一步生成回复→开始读取文件→返回读取部分输出→返回读取结果。",
        "第二步开始思考→第二步生成回复→开始运行命令→返回命令部分输出→返回命令结果；核对第一步文字和结果仍在。",
        "先不展开过程，继续开始最终思考→开始最终回复→继续生成回复→结束回复，核对正常结束收纳；再展开回查。",
        "组件库重置，在读取结果后展开工具与原始参数，保持参数触发器或复制按钮焦点，以Ctrl+Alt+F9推进第二步和最后一步，正文生成后Ctrl+Alt+F10结束，核对内容可见且焦点未丢。",
        "主动收纳过程，键入下一稿后离开再返回，核对原内容、选择与草稿归属。重置后走工具步骤再令本次回复失败，读DSH错误行；输入框中的下一稿仍保留。",
      ],
      render: () => (
        <ConversationExecutionExample scenario="execution-journey" />
      ),
    },
    {
      id: "tool-failure",
      name: "工具失败保留原因和退出码",
      section: "exception",
      condition: "从等待开始，命令在手动结果事件中返回exit7与具体失败正文。",
      expected:
        "工具失败和真实原因可辨认，最终回复结束不把该工具改成成功；不自动重跑。",
      steps: [
        "先取得第一步读取结果，再推进第二步思考、中间回复和命令，返回命令结果后展开失败调用。",
        "读取失败首行、核心输出、退出码7、耗时和原始参数。",
        "继续最后一步思考、正文生成和结束，再展开过程，确认前两步文字、失败事实与结果保留。",
      ],
      render: () => <ConversationExecutionExample scenario="tool-failure" />,
    },
    {
      id: "retry-recovery",
      name: "模型重试倒计时与手动恢复",
      section: "exception",
      condition: "从等待和工具执行开始，结果返回后手动进入模型重试等待。",
      expected:
        "原因、次数和倒计时可读；计时到0仍等待事件，不自动伪造回复；恢复后保已有结果和稿。",
      steps: [
        "走完第一步读取和第二步命令结果，在完整输入区键入下一稿。",
        "点击开始模型重试，读取原因、第1/3次和倒计时。",
        "等计时到0，确认仍显示重试等待；点击恢复回复并开始最终思考，再开始最终回复、继续生成回复和结束。",
        "核对已有工具结果与下一稿仍在；正式停止、发送等写操作只会明确拒绝。",
      ],
      render: () => <ConversationExecutionExample scenario="retry-recovery" />,
    },
    {
      id: "history-missing-results",
      name: "历史缺结果、空结果与未知执行",
      section: "exception",
      condition:
        "初始等待，手动读取标明不同权威事实的隔离历史，不预置完成画面。",
      expected:
        "unknown不称未执行，returned不称成功，failed保失败；空available不称未保存，旧省略字段不猜结果缺失。",
      steps: [
        "点击读取缺结果历史，展开结束后的执行过程。",
        "逐项打开unknown、exit0 returned、exit7 failed、stopped与明确未分发示例，读取对应文案。",
        "打开custom_empty真实空结果与legacy_empty旧省略字段，核对只说明无文字，不称未保存。",
        "核对无结果复制不可用，仍可查看原始参数；不触发工具重执行。",
      ],
      render: () => (
        <ConversationExecutionExample scenario="history-missing-results" />
      ),
    },
    {
      id: "text-only",
      name: "仅正文不生成空过程",
      section: "states",
      condition: "已接受原输入，等待没有思考或工具的纯正文回复。",
      expected: "等待、正文增长与结束可辨认，不生成空思考或工具过程。",
      steps: [
        "开始最终回复，继续生成回复，结束回复。",
        "确认只有正文与正式消息动作，下一稿可独立编辑。",
      ],
      render: () => <ConversationExecutionExample scenario="text-only" />,
    },
    {
      id: "thinking-only",
      name: "只有真实思考内容",
      section: "states",
      condition: "等待后手动发布真实的隔离思考内容，没有工具或最终正文。",
      expected:
        "有内容才显示思考，生成阶段与结束可辨认，结束后可展开回查，不补造答案。",
      steps: [
        "开始思考，打开思考区，再继续生成思考。",
        "保持思考区阅读焦点，以快捷键结束，核对内容保留；也可重置检查默认结束收纳。",
      ],
      render: () => <ConversationExecutionExample scenario="thinking-only" />,
    },
    {
      id: "long-results",
      name: "长输出、差异、参数与扩展回退",
      section: "states",
      condition:
        "从等待连续发布多工具结果，含超过20行的保存内容、截断事实、长路径、差异及未知扩展展示版本。",
      expected:
        "长内容局部可读可复制，截断只称保存内容；宽窄和浅深输入入口可达，主动阅读与跟随分别受控。",
      steps: [
        "走完第一步思考、中间回复和读取结果，打开长输出，展开已保存内容并局部滚动。",
        "继续第二步思考、中间回复和命令结果；第三步思考→中间回复→开始修改文件→返回文件修改结果；第四步思考→中间回复→开始扩展检查→返回扩展检查结果。每步独立保留，调用头先于结果，不向已结算步骤追加调用。",
        "查看命令目录及长参数、实际差异与未知扩展回退文本，复制输出或差异。",
        "切换1000px/390px和浅深主题，检查输出/参数360px、差异420px局部滚动与完整输入区。",
        "上翻阅读时以Ctrl+Alt+F9开始最终思考，再生成及继续生成同一回复正文，不抢阅读位置；回到最新再继续。",
        "在已展开参数或工具结果中保持焦点，以Ctrl+Alt+F10结束，确认内容可见；离开返回和整页重置分别检查。",
      ],
      render: () => <ConversationExecutionExample scenario="long-results" />,
    },
  ],
} satisfies CatalogEntry
