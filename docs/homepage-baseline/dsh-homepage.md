# DSH 首页：布局、组件、功能与交互

记录日期：2026-10-05。用途：保存 DSH 本身的首页参考，区分其界面能力与 Moon 的产品选择。本轮只观察首页及菜单。

同组文档：[Moon 当前首页](H:/newworkspace/example/toolwork/nianagent/docs/homepage-baseline/moon-homepage.md)、[旧项目首页设计与原型](H:/newworkspace/example/toolwork/nianagent/docs/homepage-baseline/legacy-homepage.md)。

## 1. 范围、版本与证据

- 本地源码：`H:\newworkspace\example\deepseek-harness`，HEAD `639ed015397290b3745d163aafe02ffee4aa3f84`；本轮 Git status 无未提交输出。
- 运行入口：本机已安装的官方 DeepSeek Harness CLI，使用全新隔离 `DSH_HOME`、回环地址和独立端口。CLI 实际返回运行包版本 `0.2.0-rc.2`；运行包不因本地源码存在就自动视为同一构建。
- 本轮实际观察：内置浏览器 1280×720；首次预览说明、API Key 引导的“稍后配置”、空白首页、＋菜单、模型根菜单/模型子列表、访问模式菜单。未填写凭据、未发送消息、未选新模型或更改权限。
- 源码检查：应用列布局、Hero、InputBar、workspace、commands、model-selection、attachment 及统计槽位。运行实测和仅源码可见的状态在下文分开记录。
- 不把 agenttool 中的 `vendor/dsh` 适配组件当成当前 DSH 官方实现，也不把 Moon 的“工具/项目指令”配置 Dialog 写成 DSH 官方首页控件。

## 2. 布局

### 2.1 实际空白首页

```text
AppFrame
├─ SidebarRoot
│  ├─ DeepSeek Harness 品牌、收起、新会话
│  ├─ 全局面板（当前显示插件）
│  ├─ 工作区、搜索、视图选项、添加
│  ├─ 工作区/会话树（默认工作区 → 新会话）
│  └─ 设置
├─ ConversationMainPanel
│  ├─ 空会话 header：右侧边栏入口
│  └─ ConversationContent / scrollBody（hero）
│     └─ composerSeat / composerStack
│        ├─ HeroShell：鲸鱼标记、探索未至之境、预览版
│        ├─ WorkspaceChip + Agent preset（默认工作区、标准模式）
│        ├─ conversation.input.dock（有所属内容才显示）
│        └─ InputBar（hero）
│           ├─ 信息 notice / 错误 Toast（条件显示）
│           ├─ 输入卡：附件、编辑器、工具行
│           │  ├─ 左：＋、访问模式、计划及插件槽位
│           │  └─ 右：插件控件、模型与推理等级、活动/发送
│           └─ dock：统计槽位、ContextMeter（有数据才显示）
└─ 可选右侧工作面（首页默认关闭，本轮不展开审查）
```

依据：[AppFrame](H:/newworkspace/example/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx:1)、[SidebarRoot](H:/newworkspace/example/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx:1)、[主面板状态](H:/newworkspace/example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx:13)、[内容组合](H:/newworkspace/example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx:164)。

### 2.2 尺寸、居中和响应式

| 对象 | 本地源码规则 | 本轮运行观察 |
|---|---|---|
| 左侧栏 | 默认 280px；可调 264–420px；收起 56px | 空白首页展开，宽约 280px |
| 宽窄切换 | 低于 1024px 自动收为图标轨；手动展开有单独状态 | 本轮没有调整视口；不能当作响应式实测 |
| 三列分配 | 主区保护宽度 400px；右区可缩小/失去列；右区初开偏好为视口 45% | 本轮右区关闭 |
| Hero | 整个标题、工作区行、输入组合 flex 居中；组合底部 32px | 1280×720 首页处于中间，标题在输入卡上方 |
| 主内容宽度轴 | `clamp(680px, 主内容列宽×0.64, 920px)`；输入卡加 32px；两侧 clearance 16px | 输入卡实测 x=420.5、y=353、宽 712px、高 114px |
| 标题 | 26px / 32px / 500；图标宽 34px；预览 badge 独立 | 标题“探索未至之境”，鲸鱼与 badge 在同一区域 |
| 输入 | Hero 正文最小 52px；编辑区域高度上限在 composerSeat 统一为 336px | 正文实测 14px；正文区域高 52px |
| 输入卡 | `--dsw-radius-panel` = 28px；卡内上下区间距 12px | computed borderRadius 为 28px |
| 输入下辅助区 | flex 居中，间距 12px，顶部 4px；空 dock 不占位 | 新会话没有统计/上下文数据，本轮空态不显示辅助按钮 |

依据：[列宽常量](H:/newworkspace/example/deepseek-harness/packages/client/ui-layout/src/client/columns.ts:9)、[共享宽度轴](H:/newworkspace/example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css:381)、[Hero 居中](H:/newworkspace/example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css:503)、[输入卡](H:/newworkspace/example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css:45)、[圆角 tokens](H:/newworkspace/example/deepseek-harness/packages/client/ui-theme/src/styles/base.css:16)。

本次查看的 Hero 规则未出现 Moon/旧原型那条“高度 ≤600px 时取消居中、顶部 24px”的规则。只说明所查实现有不同策略；本轮没有在 600px 高度观察 DSH，不能据 720px 的画面宣称所有短窗都合理。

## 3. 组件

| 组件 | 内容与职责 | 与 Moon 直接对应的边界 |
|---|---|---|
| AppFrame / SidebarRoot | 应用列、折叠、导航、底部设置 | 可参考结构和对齐；导航条目取决于实际插件注册，不照搬 Moon 固定菜单 |
| WorkspaceBrowser / Rows | 工作区与会话树、搜索/视图/添加、行状态 | DSH 有自己的工作区组织与视图；不是 Moon 仅按目录自动分组的同一模型 |
| ConversationMainPanel / Content | blank、settling、hero、active 状态；常驻 composer | 参考空态到会话的连续性；不要将 sessionless 与空会话混为一份 DOM 重建 |
| HeroShell | 品牌图标、主标题、预览 badge | Moon 已确认主标题是“开始一项工作”，没有照搬徽标的要求 |
| WorkspaceChip / WorkspacePicker | 工作区入口及选择菜单 | 首条消息前可选择另一工作区；显示工作区标题，必要时从 cwd 推导 |
| Agent preset 槽位 | 当前实际“标准模式” | 当前 Moon 没有这个首页入口 |
| InputBar / ComposerEditor | 完整输入卡与附件、工具行、浮层锚点 | 该版本使用内容编辑器；不是 Moon 的 InputGroupTextarea |
| Commands / trigger menu / PopupSelectView | ＋、`/`、`@` 的候选和参数选择 | 可参考分组、键盘和焦点；候选资源范围包括文件或对话，超出 Moon 文件/Skill 范围 |
| Permission / Plan 槽位 | 访问模式、计划模式 | “工作区内修改”是访问规则，不是工具勾选或队列交付模式 |
| ModelSelect | 模型与推理等级两级菜单 | 与 Moon 组合入口同类，但模型目录与能力数据来自 DSH |
| Activity 槽位 / primary | 运行活动与发送、停止、插话/排队 | 本轮空态仅观察到禁用的发送按钮；执行态按源码记录 |
| ComposerAttachments / AttachmentRail | 文件/图片材料及移除、滚动 | 参考材料和文本分开的滚动职责 |
| StatsPills / ContextMeter | 实际运行统计、上下文投影 | 统计不是 Moon 的“逐条/全部交付”可写设置，不能按按钮数复制 |

输入区是明确槽位组合，见 [InputBar 工具行](H:/newworkspace/example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:418)。这说明插件能力可以参与 UI，不表示 Moon 应立即增加 DSH 所有槽位对应的功能。

## 4. 功能

| 功能 | 当前参考实现 | 本轮证据 |
|---|---|---|
| 新会话 | 从全局/工作区新建流程选取或建立空白会话 | 隔离首次启动已有“默认工作区 → 新会话”；未主动创建第二个 |
| 工作区 | 选择标题、建立归属；没有工作区时卡片本身承载选择动作 | 源码区分 inert、blocked 和可编辑状态；未实际删除/新增目录 |
| Agent preset | 为新任务选择预设 | 实际存在标准模式按钮，未改预设 |
| 附件与引用 | ＋选择文件；`@` 文件或对话；`/` 调用指令 | ＋候选实际打开；文件/引用选择未执行 |
| 模型与推理 | 一个入口分别进入模型、推理等级 | 根菜单和模型列表实际打开，模型列表为 DeepSeek 分组，当前项有选中语义 |
| 权限 | 仅可查看 / 工作区内修改 / 完全权限 | 菜单实际打开，未选择其他项 |
| 命令 | goal、plan、feedback、compact、permission、model、export 等 | 本轮＋候选可见；没有执行命令，也不将命令存在等同执行通过 |
| 发送与执行 | 根据运行状态决定发送、排队/插话、停止；原输入 machine 管理提交 | 本轮未发送，未验证推理或工具执行 |
| 统计与上下文 | 从真实会话投影取统计/容量，有效数据不足时按规则不显示 | 空首页实测无辅助统计；执行态仅源码核对 |

本轮＋菜单实际分为“添加”“指令”：添加中包含文件、目标、计划、反馈；指令中包含压缩、权限、模型、下载日志。普通空态未展示 Moon 的“会话配置 → 工具/项目指令 → 扩展能力”Dialog。

## 5. 交互

| 操作 | 参考行为 | 证据/边界 |
|---|---|---|
| 首次打开 | 预览说明 → 可稍后配置 API Key → 空态 | 本轮实际操作；未配置密钥 |
| 点击＋ | 输入编辑器获得焦点，候选列表出现在输入卡上方 | 本轮实际打开，listbox/option 语义；不占主区常驻说明位置 |
| Esc 关闭候选 | 保留编辑输入，关闭该菜单 | 本轮执行；关闭后模型菜单能单独打开 |
| 点击模型入口 | 根菜单显示模型、推理等级 | 本轮实际观察 |
| 进入模型列表 | 按提供者分组，当前模型 menuitemradio checked | 实测两项模型，未点击切换；Esc 先返回根，再关闭 |
| 点击访问模式 | 小菜单列出三个预设 | 本轮实测打开；未改变权限 |
| 工作区切换 | 先显示 pending 工作区标题，切换成功后归属完成；失败清 pending | [ConversationContent](H:/newworkspace/example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx:119)，仅源码核对 |
| 空态 → 对话 | 保持 composer 树和编辑器实例；settling 时隐藏未知位置的输入 | [ConversationMainPanel](H:/newworkspace/example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx:23)，仅源码核对 |
| 无工作区 / 阻塞 | 无工作区卡片整体成为选择入口；其他 blocker 使用 reason 并保留模型席位 | 源码明确两类前置条件的不同恢复路径，不泛化为统一 disabled |
| 输入 / IME / 候选确认 | keymap 与输入 machine 承担提交和候选规则 | 本轮未输入、未测真实 IME 或提交时序 |

## 6. 输入框上方文字与反馈

DSH **也存在上方信息反馈**，不能形成“参考页绝无上方文字”的错误结论。

- [InputBar 365 行](H:/newworkspace/example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:365)：只有 `notice?.level === 'info'` 时，以单个 `.notice` 输出 notice.text；该样式为 12px/18px、卡宽上限、下间距 6px。
- [InputBar 90 行](H:/newworkspace/example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:90)：错误通知进入 anchored Toast；错误 notice 的 effect 调用 showToast，卡片不为每类错误另建一组永久说明。
- `conversation.input.dock` 是明确的上方业务槽位；待处理、问题接管和其他业务状态不是一概无文字。
- placeholder 与 claim hint 位于编辑器内部；无工作区说明也可以由选择卡内部 placeholder 承载。
- 本轮正常空白首页没有出现读取配置文字，也没有人为制造错误 notice。该实际观察不证明所有配置慢加载或错误状态都无文字。

DSH 的参考价值是把信息、错误、候选、业务 dock 与输入内部提示分成明确责任，并保持完整输入组合。Moon 是否继续保留上方提示仍由用户的明确要求决定，不能因为 DSH 有 info notice 就保留 Moon 的全部 H1–H8。

## 7. 会话设置、工具、圆角、文件来源的对照边界

| Moon 问题维度 | DSH 当前首页事实 | 可对照内容 |
|---|---|---|
| 首页靠上 | 本轮空态整个组合居中；源码 Hero flex 居中 | 同视口位置和空间分配；需另验短窗 |
| 上方提示 | info notice 与错误 Toast 有集中入口；空态实测无常驻读取提示 | 反馈 owner、位置和显示条件，不能只比一句文案 |
| 会话配置 Tabs | 本轮 DSH 首页没有“工具/项目指令”的同名 Dialog | 官方 Tabs 对照应查 shadcn；Moon 该方案来自旧原型 |
| 扩展配置按钮 | DSH 通过插件槽位提供功能，＋菜单本轮有命令 | 不存在可直接一对一替换的“配置扩展”按钮 |
| 工具列表嵌套 | 该菜单不是 Moon 的复选工具清单 | 可以比较候选行/分组密度，不能把命令列表当工具配置清单 |
| 弹窗圆角 | DSH 自有 token；输入卡实测 28px | 输入卡、菜单、模态分别比较；28px 不能当 Moon 所有弹窗规范 |
| 文件双路径 | PopupSelect 以 label、badge、detail 分职责；引用插件定义候选信息 | 未实际打开文件候选，本轮不声称 DSH 文件行永远只显示一条路径 |

候选渲染依据：[PopupSelectView](H:/newworkspace/example/deepseek-harness/packages/client/ui-commands/src/client/PopupSelectView.tsx:139)。每个参考对象需确认相同状态、用途及运行版本；DSH 的权限、预设、统计和完整工作区管理不是 Moon 首页已确认功能的自动增补清单。

## 8. 对实现劣化原因的参考意义

可确认三条区别：DSH 的首页和会话复用常驻完整输入树；输入宽度与会话内容共用一个轴；插件控件通过约定槽位参与组合。Moon 目前首页上方反馈跨 App、目录、配置、提交恢复多个入口，业务 source 被直接拼接为显示说明，部分页面自行覆盖基础样式。两者确有职责和组合策略差别。

不能从这些差别推出“必须重建 DSH 架构”或“照搬所有按钮才能好用”。旧原型已经对 Moon 的产品边界作过明确选择；应先检查这些选择与当前实现是否一致，再判断哪些策略需要重新确认。

## 9. 后续对照范围与未验证项

本轮实际范围限定在空白首页和上述只读菜单。未验：600px 及更矮窗口、侧栏拖宽/收起、右侧工作面、文件候选具体来源文案、长正文、多附件、IME、真实发送/工具、错误恢复、会话切换、统计实值和上下文压缩。

隔离的 DSH 数据、进程和浏览器页在文档收尾时清理。参考运行不保留个人配置、密钥或测试会话到用户正式 DSH 数据中；文档没有包含临时访问令牌。
