import type { CatalogEntry } from "../../../../ui-catalog/catalog-types"
import { ConversationIdleInputExample } from "../../../../ui-catalog/fixtures/conversation-idle-input-stories"

export default {
  id: "conversation-idle-input",
  name: "空闲时继续输入",
  order: 303,
  source: "src/features/conversation/composer/conversation-composer.tsx",
  composition: [
    "ConversationComposer → PromptInput → ComposerEditor（组合入口） · src/features/conversation/composer/conversation-composer.tsx",
    "ModelPicker · src/features/home/model-picker.tsx",
    "SessionConfig · src/features/home/session-config.tsx",
    "PermissionPicker · src/features/conversation/permissions/permission-picker.tsx",
    "SelectedMaterials · src/features/home/selected-materials.tsx",
    "MaterialPicker · src/features/home/material-picker.tsx",
    "ConversationSubmissionEcho · src/features/conversation/conversation-submission-echo.tsx",
    "ConversationOperationFeedback · src/features/conversation/conversation-operation-feedback.tsx",
    "ConversationTurnFeedback · src/features/conversation/conversation-turn-feedback.tsx",
    "/compact 命令入口 · src/features/conversation/live-conversation-view.tsx",
    "CompactionStatus · src/features/conversation/controls/compaction-status.tsx",
    "CompactionRow（DSH命令与摘要行） · src/features/conversation/controls/compaction-row.tsx",
    "useConversationControls（压缩提交与原状态自动查询） · src/features/conversation/controls/use-conversation-controls.ts",
    "NotificationToast · src/components/ui/notification-toast.tsx",
    "SubmissionReceipt · src/components/feedback/submission-receipt.tsx",
  ],
  group: "空闲时继续输入",
  layer: "复合组件",
  stage: "content",
  pages: ["会话"],
  description:
    "在当前会话继续输入，等待、运行和结束沿用同一首页输入主体；下一稿独立保留，终态失败显示DSH错误行，普通发送失败使用短暂Toast。/compact命令提交及会话内操作状态归本故事，已保存摘要归阅读并定位会话内容。",
  boundary:
    "完整示例直接使用LiveConversationView、ConversationComposer和useLiveConversation。服务、历史和材料在预览内存隔离；接收、拒绝、原回执及最终回复结果由演示控制发布，后续需求使用正常输入入口。模型目录恢复只恢复可用选择，重新读取只恢复记录保存结果；不调用真实模型或宿主。工具、思考和模型重试流程在执行故事验证，运行中输入与交付在运行中发送新消息故事验证；隔离旅程不证明真实执行或跨重启恢复已验收。",
  story: {
    goal: "在当前会话继续提出需求，选择需要的模型、配置和材料，并知道本次输入是否被处理。",
    preconditions: [
      "目标会话空闲，当前工作目录和可用模型已明确。",
      "正在编辑的草稿属于当前会话。",
    ],
    result: "用户能继续当前会话，并保留尚未发送的下一稿。",
  },
  standards: [
    {
      id: "conversation-failure-recovery",
      name: "终态异常与输入恢复连续可读",
      rule: "当前及历史失败共用DSH行内反馈：实心状态点、短标题、具体原因和可选错误码，不附更多按钮、弹窗或继续按钮。普通发送失败用顶部Toast，原消息和下一稿保留；未知结果仍须核对原请求。新输入不抹旧失败；停止、读取与草稿保存等异常保清楚的操作对象。",
      reason: "外观与恢复必须一起成立，不能用样式隐藏失败或把下一稿误送。",
      check:
        "从空稿接收后令最终回复失败，阅读错误行及长原因；下一稿与材料保留。主动新发送后旧失败归原轮，切换及重置不串。明确拒绝时读顶部Toast及恢复后的两稿。模型目录与保存结果恢复不伪造回复成功；工具与同运行重试在执行故事交叉回归。",
    },
    {
      id: "shared-idle-input",
      name: "连续使用同一输入主体",
      rule: "空闲、提交等待、运行、停止中和结束均沿首页正文提示和留白，保留/、@发现入口；工具栏、候选与材料直接复用。底部停靠和消息列宽保留会话页面差异，主动作按当前工作状态变化。",
      reason: "同一种输入能力需要熟悉、一致的表达。",
      check:
        "从空稿打开模型、权限和配置，输入短长文、选择候选和材料；发送后写下一稿，经过接收、停止等待、结束或失败，在宽窄及浅深主题核对同一输入组合。",
    },
    {
      id: "relevant-settings",
      name: "当前任务相关的辅助信息",
      rule: "输入区不显示 Enter 或逐条/全部交付配置；旧设置失败或待确认仍保留所属恢复。上下文与统计仅在有有效对应读数时显示，位于卡外次级区域。/compact不接受参数，通过正常发送按钮直接执行，沿用空闲门禁；开始提交即清空本次命令，输入框下方不显示压缩禁用提示，原因仅沿发送按钮的既有提示展示。执行、失败和取消结果共用DSH紧凑命令行，没有附加操作按钮；未决结果自动查询同一操作。已保存摘要合并为一条可展开的Markdown记录，正文使用14px/24px常规Markdown排版，不显示时间、压缩前估算或定位按钮；没有DSH压缩计数字段时使用摘要可用性文案。",
      reason: "继续输入应先看到正文和发送，恢复不能因列表变化而消失。",
      check:
        "用辅助信息场景切换未知/有效历史读数和待发项。压缩命令场景提交/compact，查看紧凑进度、原操作自动更新及Markdown摘要；带参数时显示用法错误，不调用模型。",
    },
    {
      id: "disabled-reason",
      name: "非空稿说明禁发原因",
      rule: "空稿不追加冗余提示；非空稿的实际禁用提交可查看原因。材料、图片、候选和压缩沿原专项反馈，Stop不套用草稿资格原因。",
      reason: "用户需要知道下一步应修改什么，同时避免重复反馈。",
      check:
        "输入到不可用模型场景，阅读原因并改选；添加图片到文本模型，检查材料反馈和发送原因，切换图片模型后恢复。",
    },
    {
      id: "submission-ownership",
      name: "原提交与下一稿分开",
      rule: "提交前保存两份内容；普通等待只回显原消息，不附重复状态段落。原接收只清原请求，明确拒绝用就近短原因并合并保留两稿；未知只有一个紧凑核对入口，等待核对仍指向原请求。新提交成功保存后清本会话过时发送失败，保未知及本地恢复。切换会话分别保留草稿和所属结果。",
      reason: "原请求结果不能覆盖用户已经开始编辑的新内容。",
      check:
        "发送等待中写下一稿，再分别确认、拒绝或丢失回应；切另一个会话编辑后返回，并通过正式恢复入口核对原结果。",
    },
  ],
  inputs: [
    "HomeDraft与现有composerDraftEligibility：正文、材料、模型和配置的共同资格事实。",
    "modeIssue：仅保留旧交付操作的必要恢复；上下文及统计入口按有效数据显示。",
    "context、statistics：可展示的对应数值，保留已有来源、估算和历史标记。",
    "compactDisabledReason与ConversationControlOperation：压缩资格、原操作身份和当前结果。",
    "ConversationService与各Provider：正式默认服务；预览显式替换为隔离内存端口。",
  ],
  events: [
    "空闲Enter/发送经正式useLiveConversation.send保存原提交与下一稿，再调用服务。",
    "接收、明确拒绝和核对结果由服务返回，正式hook处理恢复和原回执；演示不直接修改草稿或反馈。",
    "模型、权限、会话配置和材料在同一完整输入组合中操作；演示写入仅预览内存。",
    "/compact由LiveConversationView调用useConversationControls；新操作开始提交即清除本次命令，未决结果自动查询同一操作，终态只刷新对应历史，不清除下一稿或回填旧命令。",
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
      id: "idle-submit",
      name: "发送并继续下一稿",
      section: "normal",
      condition:
        "已有会话结束上一轮，当前输入为空；模型、配置和材料入口均有隔离服务。",
      expected:
        "等待只回显原文，下一稿独立；接收后原文仅一次，输入主体贯穿运行与终态，切换返回不丢对应草稿。",
      steps: [
        "空闲时也可输入/compact并通过正常发送提交，开始提交即清空命令并出现compact · 正在压缩…；输入下一稿，再展开演示控制并完成压缩，摘要出现且下一稿保留。",
        "从空稿输入A，按Enter发送；输入B作为下一稿。",
        "切到另一个会话输入C，再确认接收原消息；当前会话不出现A，返回原会话核对A只出现一次且B仍在。",
        "清空B以查看主停止按钮，点击停止执行；停止等待中输入主体不变，再用演示控制确认本次停止完成。",
        "重新输入并发送，确认接收后可生成最小示例正文再结束；再次发送接收，下一稿写B并添加文件，令回复失败（长原因）。具体原因一次，无大红卡、更多按钮或弹窗。",
        "主动发送B并接收，旧终态不冒充新请求错误；切换往返核对应草稿，再整页重置。",
        "分别重置并发送/接收，令所选模型不可用后从模型入口检查设置（仅隔离说明），再恢复示例模型目录；或令会话记录保存失败后恢复示例记录。目录恢复不自动回复，记录恢复不改已生成正文，下一稿仍在。",
      ],
      render: () => <ConversationIdleInputExample scenario="idle-submit" />,
    },
    {
      id: "compact-command",
      name: "提交 /compact 并查看结果",
      section: "normal",
      condition:
        "会话空闲、草稿为空、无材料和待处理消息；压缩由隔离控制服务响应。",
      expected:
        "通过正常发送提交/compact，开始提交即清空命令并显示DSH紧凑命令行；没有弹窗、输入框下方提示、附加状态按钮或定位按钮。完成后原状态与摘要合为一条，可展开常规Markdown；失败显示原结果，未决状态自动更新，下一稿保留。带参数只显示用法错误，不执行压缩。",
      steps: [
        "在正文输入/compact，按Enter或点击正常发送箭头；输入正文立即清空，会话内出现compact · 正在压缩…，没有第二次确认、输入框下方提示及附加动作。",
        "切到另一个会话再返回，原压缩仍属于原会话；压缩期间把正文改成下一稿。",
        "展开演示控制，点击完成压缩并发布示例摘要；下一稿不被清除，摘要只出现一次。点击compact行展开Markdown摘要，没有时间、估算、局部高度限制或定位动作，原历史仍可阅读。",
        "保持空闲，重新输入/compact并提交；点击令压缩失败，命令行显示原因，下一稿不被改动，输入框不回填旧命令。需要重试时重新输入/compact提交。",
        "重新输入/compact提交，再点击令压缩结果待确认；命令行保持执行状态，自动查询原操作，不能重复提交。输入下一稿，再通过演示控制发布原操作的完成结果；下一稿继续保留。",
        "输入/compact 保留重点并提交；命令行显示用法错误，不开始模型压缩。重新输入/compact后可提交。",
      ],
      render: () => <ConversationIdleInputExample scenario="compact-command" />,
    },
    {
      id: "submission-rejected",
      name: "明确拒绝保留两稿",
      section: "exception",
      condition: "空闲空稿开始，服务等待本次输入的明确处理结果。",
      expected:
        "迟到拒绝只在原会话用顶部Toast提示，保留两稿；输入框上方无常驻错误，重复拒绝可重新提示，不重复拼接草稿。",
      steps: [
        "输入A发送，等待中输入B。",
        "切到另一个会话输入C，再点击明确拒绝原消息；当前会话不显示A的原因和正文。",
        "返回原会话，阅读顶部深色Toast及恢复后的A、B；提示3秒后用1秒淡出。修正后再发送，确认接收原消息。",
        "切回另一个会话，C仍保留；原会话的新消息只出现一次。",
      ],
      render: () => (
        <ConversationIdleInputExample scenario="submission-rejected" />
      ),
    },
    {
      id: "submission-unknown",
      name: "待确认只核对原消息",
      section: "exception",
      condition: "第一条输入的回应丢失，原服务回执尚不能确认。",
      expected:
        "结果待确认用顶部Toast通知，原消息回显下保留检查发送状态入口；原内容与下一稿分开保留，不能重复发。输入框保留正常发送按钮，原回执明确后解除阻断。",
      steps: [
        "输入A发送，再输入B；阅读顶部Toast，在原消息A下点击检查发送状态两次，结果仍未知且不重复发送。输入框不出现警告图标或错误段落。",
        "切到另一个会话编辑C，再返回原会话，原A和下一稿B仍在。",
        "展开演示控制，点击令原消息回执可确认，再点击原消息下同一个检查发送状态入口。",
        "检查只出现一次原消息A，B和另一个会话的C保留。",
      ],
      render: () => (
        <ConversationIdleInputExample scenario="submission-unknown" />
      ),
    },
    {
      id: "model-unavailable",
      name: "不可用模型与禁发原因",
      section: "exception",
      condition: "原模型已不在可用目录中，当前草稿为空。",
      expected:
        "空稿无冗余提示；输入首次成为非空且模型不可用时，顶部共享Toast主动说明原因，持续打字不重复弹出。模型入口保留不可用标记；改选可用模型后解除禁发，草稿保留。",
      steps: [
        "从空稿输入正文，读取顶部模型不可用Toast；继续打字不重新弹出。检查模型入口始终可见的不可用标记及发送按钮的悬停/键盘说明。",
        "通过选择模型改选文本或图片模型，原因解除，再发送并确认接收。",
      ],
      render: () => (
        <ConversationIdleInputExample scenario="model-unavailable" />
      ),
    },
    {
      id: "long-materials",
      name: "长正文与文件图片",
      section: "states",
      condition: "空闲空稿，材料服务包含一份文本文件和一张代表性图片。",
      expected:
        "长正文局部阅读，材料预览、移除和模型兼容可操作，输入与主动作在宽窄主题下可达。",
      steps: [
        "输入多段正文；用/选择review并保留普通Skill文字，或用@选择README.md。",
        "通过加号添加附件，打开文件和图片预览，再返回输入。",
        "文本模型下检查图片禁发原因，改选图片模型；移除一项材料，核对正文和剩余材料。",
        "在390px窄窗和浅深主题检查长稿及相邻入口；发送并确认接收，核对原文和材料归属。",
      ],
      render: () => <ConversationIdleInputExample scenario="long-materials" />,
    },
    {
      id: "auxiliary-visibility",
      name: "辅助信息与必要恢复",
      section: "states",
      condition: "空闲、无待发项、无对应读数；辅助恢复由正式服务结果驱动。",
      expected:
        "无数据不造辅助占位；有效历史读数可查，有待发项显示队列；设置待确认时列表清空也能核对。",
      steps: [
        "检查输入区无Enter/交付配置、无未知上下文和空统计。",
        "展开演示控制，展示有效历史用量并查看详情，再改为无对应读数。",
        "展示待处理消息，检查队列与上下文的归属。",
        "清空演示待处理列表，上下文与统计按实际数据显示。",
        "从正常输入发送并确认接收；运行和空闲都不出现两个配置菜单。展开演示控制，点击结束本次演示工作，再清空草稿及材料。",
        "保持无读数，提交正文/compact直接发起压缩；会话内显示原命令行并自动查询状态，用量入口仍隐藏。演示控制结束该请求，只返回明确未执行的失败结果，不生成摘要。",
      ],
      render: () => (
        <ConversationIdleInputExample scenario="auxiliary-visibility" />
      ),
    },
  ],
} satisfies CatalogEntry
