import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { HomeStoryExample } from "../../../ui-catalog/fixtures/home-stories"

export default {
  id: "prompt-input",
  name: "输入文本消息",
  source: "src/features/home/home-composer.tsx",
  group: "输入文本消息",
  layer: "复合组件",
  order: 104,
  pages: ["首页", "会话"],
  stage: "content",
  description: "用户从空稿输入文字、换行和提交，等待或失败时原输入有明确归属。",
  boundary:
    "首页示例复用完整 HomeComposer，共享消费回归直接复用正式 ConversationComposer。服务、草稿和浏览器存储只存在预览内存；演示到提交回调结束，不模拟路由、队列接收或 Agent 回复。正文使用正式 Lexical 编辑器，不以 Textarea 替代。",
  story: {
    goal: "编辑一条文本请求，确认它提交了什么，并在失败时继续原草稿。",
    preconditions: ["目录、模型和会话配置可用。", "初始正文为空，发送不可用。"],
    result:
      "正文、换行、目录、模型与配置形成不可变提交副本；失败可恢复，下一份草稿不污染原提交。",
  },
  standards: [
    {
      id: "T1",
      name: "正文与布局",
      rule: "输入卡20px圆角，正文与工具栏12px间隔；正文最大336px并随视口收缩，长文局部滚动，发送始终可达。",
      reason: "用户任务是输入与发送；提示和长内容不能挤掉工具栏。",
      check: "短文、长文和390px视口核对焦点、滚动、工具栏。",
    },
    {
      id: "T2",
      name: "占位与输入语义",
      rule: "占位为“描述你想完成的工作，/ 选择命令或 Skill，@ 引用文件”；占位不进入数据。普通 @ 和句内 / 是正文，未选择的符号不猜测成材料；开头命令仍校验。IME期间不误发送；Shift+Enter换行，候选开启时Enter优先选择。",
      reason: "占位说明可用动作，不能成为默认消息或静态提示行。",
      check:
        "核对 @Override 整句、句内 /usr 关闭候选后的完整正文，以及候选Enter、未知开头命令和已选材料门禁。",
    },
    {
      id: "T3",
      name: "提交副本与恢复",
      rule: "发送固定本次副本；等待仍可编辑后续输入。明确拒绝按应用时最新草稿合并一次，正在编辑的新稿光标与选区随实际前置长度平移；失焦或所有者变化不抢焦点。空正文或缺前置条件不能误发送。",
      reason: "用户不应因为等待或失败丢失工作，也不能把下一份输入当成原请求。",
      check:
        "冻结原稿与新稿A的拒绝结果，继续编辑B并建立选区，再交付与重放；核对内容、选区和另一所有者。",
    },
  ],
  inputs: [
    "ComposerDraft.text 为纯文本，保留换行；材料原子引用由编辑器同步",
    "onSubmit(draft,signal,originalDraft) 接收固定副本；data提供可用目录/模型/配置",
    "initialDraft只用于挂载初稿，后续编辑由组件受控草稿管理",
    "onSubmissionPrepare捕获实际不可变副本，恢复按同一会话/目录/请求应用到最新稿",
  ],
  events: [
    "onDraftChange / draftStore.write保留编辑草稿",
    "Enter发送，Shift+Enter换行；IME不发送，开启候选的Enter优先选择",
    "onSubmit失败恢复草稿；示例成功记录accepted，不进入对话",
  ],
  composition: [
    "HomeComposer / PromptInput / ComposerInputCard / ComposerToolbar / SendControl",
    "ConversationComposer / PromptInput / ComposerInputCard / ConversationSendControl",
  ],
  consumers: ["首页输入区", "会话输入区（共享正文门禁）"],
  states: [
    {
      id: "type-submit",
      name: "输入、换行与提交",
      section: "normal",
      condition: "空正文，目录/模型可用。",
      steps: [
        "输入“请检查首页”。",
        "Shift+Enter换行，输入“说明差异”。",
        "点击发送或按Enter。",
        "展开演示数据与事件，核对home.accepted中的text、目录、模型。",
      ],
      expected:
        "发送一次，保留两行正文；占位不进入payload，清空后成为下一份输入。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "clear-edit",
      name: "编辑与清空",
      section: "normal",
      condition: "没有材料。",
      steps: ["输入、选择文字替换、撤销。", "清空全部正文，查看占位与发送。"],
      expected: "编辑历史有效；清空回到占位，空消息不能发送。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "literal-text",
      name: "普通符号正文",
      section: "normal",
      condition: "空稿，无已选材料。",
      steps: [
        "输入“请解释 Java 的 @Override 注解。”，按Enter并查看home.submit完整正文。",
        "重置本状态，输入“请解释 /usr”，若候选打开按Esc关闭，再点击发送。",
        "重置后输入 /missing，关闭候选，核对开头未知命令仍不能当普通消息发送。",
      ],
      expected:
        "未选普通符号正文可以提交，不依赖白名单；实际候选Enter仍只操作候选，未知开头命令仍校验。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "send-failure",
      name: "提交失败保留输入",
      section: "exception",
      condition: "第一次提交失败，再次可成功。",
      steps: [
        "输入一条消息并发送。",
        "查看失败后原文字。",
        "继续编辑，使用恢复动作或再次发送。",
      ],
      expected:
        "原输入保留且可编辑；重试不会重复合并，成功payload为用户最终内容。",
      render: () => <HomeStoryExample scenario="send-error" />,
    },
    {
      id: "delayed-recovery-selection",
      name: "迟到拒绝与新稿选区",
      section: "exception",
      condition: "从空稿实际发送；拒绝结果分为冻结与交付两步。",
      steps: [
        "输入“原稿”并发送；等待时输入“新稿A”。按一次Alt+Shift+R冻结拒绝结果，事件demo.recovery.metadata只含当时的新稿A。",
        "继续输入“+B”，把光标放在新稿中段或选择其中一段文字；再次按Alt+Shift+R交付旧结果。",
        "不点鼠标继续输入，核对插入/替换仍发生在新稿原位置，正文保留原稿及A+B。",
        "按第三次Alt+Shift+R重放同一恢复通知，核对正文与选区不再偏移，home.submit仍一次；再次发送核对最终正文。",
        "重置后分别检查新稿末尾、空新稿及与原稿相同的新稿；不应重复合并或一律跳到末尾。",
      ],
      expected:
        "旧恢复metadata不覆盖后来B；按实际前置长度平移选区两端，重复恢复不重复拼接或移动。冻结与交付按钮可用于失焦检查，快捷键保留正文焦点。",
      render: () => <HomeStoryExample scenario="send-recovery-pending" />,
    },
    {
      id: "delayed-recovery-focus",
      name: "恢复不抢已移出的焦点",
      section: "exception",
      condition: "原稿等待拒绝，新稿已编辑；演示按钮可分步交付。",
      steps: [
        "输入原稿并发送，等待时输入新稿，按Alt+Shift+R冻结拒绝结果。",
        "继续编辑后点击演示区的“交付旧拒绝结果”按钮，保持焦点在按钮。",
        "核对正文恢复但焦点仍在按钮；用Tab继续访问，不应自动跳回正文。",
        "点击重放通知，核对不重复合并；重置后以正文选区加快捷键方式核对保留选区。",
      ],
      expected:
        "被动恢复只在原编辑器仍可交互且聚焦时恢复选区；失焦的请求不在随后重新聚焦时复活。",
      render: () => <HomeStoryExample scenario="send-recovery-pending" />,
    },
    {
      id: "delayed-recovery-owner",
      name: "恢复只属于原首页所有者",
      section: "exception",
      condition:
        "两个正式首页使用不同会话和工作目录；切换后原首页inactive并隐藏。",
      steps: [
        "输入原稿并发送，等待时写新稿，按Alt+Shift+R冻结拒绝结果。",
        "点击“切换演示所有者”，在notes的新任务输入另一份文字并保留正文焦点。",
        "按Alt+Shift+R交付旧拒绝结果，再按一次重放；另一任务正文与焦点不变。",
        "点击“返回原任务”，核对原稿与最新新稿已合并一次，另一任务未被覆盖。",
      ],
      expected:
        "数据恢复核对原会话/目录/请求；隐藏的inactive编辑器不排恢复焦点，通知不能覆盖新所有者。",
      render: () => <HomeStoryExample scenario="send-recovery-pending" />,
    },
    {
      id: "recovery-auto-check",
      name: "自动核对明确拒绝",
      section: "exception",
      condition: "发送先返回未知，自动核对等待两阶段拒绝结果；不会重发。",
      steps: [
        "输入原稿发送，等待出现home.result_unknown和home.check。",
        "输入新稿A，按Alt+Shift+R冻结拒绝metadata；继续加B并把光标放中段或选择文字。",
        "按Alt+Shift+R交付，核对自动检查使用原副本恢复最新A+B及选区。",
        "再次按快捷键重放，核对不重复合并，home.submit仍一次。",
      ],
      expected:
        "自动检查不发送，明确拒绝应用时读取最新稿，不采用冻结时的旧合稿。",
      render: () => <HomeStoryExample scenario="send-recovery-auto-pending" />,
    },
    {
      id: "recovery-manual-check",
      name: "手动核对明确拒绝",
      section: "exception",
      condition: "前三次自动读取均未知；自动核对结束后手动检查原副本。",
      steps: [
        "输入原稿发送，等待事件出现三次home.check且自动核对结束。",
        "输入新稿A，按Alt+Shift+R冻结结果；继续输入B。",
        "从输入卡外的原提交入口打开原文，点击“检查发送状态”；手动第4次读取保持等待。",
        "返回正文放置中段光标或选区，按Alt+Shift+R交付旧拒绝，再重放同一通知。",
      ],
      expected:
        "手动检查持有请求前原副本，恢复最新稿且不重复发送；打开原文与检查仍是正式组合。",
      render: () => (
        <HomeStoryExample scenario="send-recovery-manual-pending" />
      ),
    },
    {
      id: "conversation-idle",
      name: "会话空闲普通正文",
      section: "normal",
      condition: "正式ConversationComposer完整组合，回调仅记录数据。",
      steps: [
        "输入@Override整句，按Enter核对conversation.submit完整正文。",
        "清空输入句内/usr，Esc关闭候选再发送；再核对未知开头命令仍禁用。",
        "实际选择文件，准备中Enter不提交，完成后材料与正文一同进入回调。",
      ],
      expected: "共享正文门禁与首页一致；示例不声称后台接受或完成会话执行。",
      render: () => <HomeStoryExample consumer="conversation" />,
    },
    {
      id: "conversation-running",
      name: "会话运行中普通正文",
      section: "states",
      condition: "正式ConversationComposer running，演示不启动Pi运行。",
      steps: [
        "空稿核对停止入口，输入@Override整句并按Enter。",
        "核对conversation.submit包含完整正文与交付方式，停止入口仍可达。",
        "清空后输入句内/usr，关闭候选再提交；未知开头命令继续受原运行门禁约束。",
      ],
      expected:
        "普通文字可以进入运行中的交付回调，命令、材料和停止行为保持；不模拟队列接收。",
      render: () => (
        <HomeStoryExample consumer="conversation" conversationRunning />
      ),
    },
    {
      id: "no-workspace",
      name: "缺少目录",
      section: "exception",
      condition: "没有工作目录。",
      steps: ["尝试编辑和发送，核对前置条件。", "添加演示目录再输入发送。"],
      expected: "无法把消息发给未知目录；补齐后可继续。",
      render: () => <HomeStoryExample scenario="workspace-empty" />,
    },
    {
      id: "empty",
      name: "空稿与初始焦点",
      section: "states",
      condition: "空正文且无材料。",
      steps: [
        "点击正文获得焦点。",
        "Tab访问工具栏，检查发送禁用。",
        "输入后再清空。",
      ],
      expected: "初始状态安静，焦点外观沿共享输入卡，不出现常驻状态提示。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "long-text",
      name: "长正文",
      section: "states",
      condition: "预置长文本仅核对布局，不作为正常流程证据。",
      steps: [
        "滚动正文到末尾并编辑。",
        "检查工具栏仍可达。",
        "发送并查看payload完整行数。",
      ],
      expected: "正文局部滚动，不卡住页面或发送，内容不截断。",
      render: () => <HomeStoryExample scenario="text-long" />,
    },
    {
      id: "submitting",
      name: "提交等待与后续草稿",
      section: "states",
      condition: "提交待演示解除。",
      steps: [
        "输入第一条并发送。",
        "等待期间输入第二条，在观测区查看第一条提交数据。",
        "按Alt+Shift+R完成等待，检查第二条仍独立。",
      ],
      expected:
        "原payload固定；输入卡下不追加历史消息气泡，后续编辑不修改原请求，忙状态不重复发送。",
      render: () => <HomeStoryExample scenario="send-pending" />,
    },
    {
      id: "unknown-result",
      name: "未知结果与后续草稿",
      section: "exception",
      condition: "原提交结果未知，演示只通过核对释放原副本。",
      steps: [
        "输入第一条并发送，原提交核对入口位于输入卡外，发送位置保留正常箭头。点击查看原提交，核对中的原文也可读。",
        "在正文写第二条，自动核对结束后原副本仍保留。",
        "在演示区点击模拟接收原提交，再打开核对入口点击检查发送状态。",
        "检查副本释放，第二条保留，home.submit仍只有一次。",
      ],
      expected:
        "核对只读原会话结果；接收后仅释放原副本，不清空下一稿或重复提交。",
      render: () => <HomeStoryExample scenario="send-unknown" />,
    },
  ],
  viewport: {
    width: 800,
    height: 680,
  },
} satisfies CatalogEntry
