# Moon 当前首页：布局、组件、功能与交互

记录日期：2026-10-05。用途：固定当前首页的事实，供后续逐页面优化对照。本轮不修改产品实现。

同组文档：[DSH 首页](H:/newworkspace/example/toolwork/nianagent/docs/homepage-baseline/dsh-homepage.md)、[旧项目首页设计与原型](H:/newworkspace/example/toolwork/nianagent/docs/homepage-baseline/legacy-homepage.md)。

## 1. 范围、版本与证据

- 对象是未开始对话的正式首页，以及从该页展开的目录、材料、模型、会话配置和相关弹层。发送后进入会话，只记录交接边界，不扩展为会话页审查。
- 仓库：`H:\newworkspace\example\toolwork\nianagent`；HEAD：`98a846ea81b9015625848cf49a37e865931d3bc1`。当前页面包含既有未提交修改，HEAD 本身不能代表当前实现。本轮开始已有 282 个 Git 未提交路径条目。
- 实际画面依据：用户本次四张截图。图 1 为 800×630 外窗的首页；图 2 为配置读取提示；图 3 为会话配置；图 4 为工作区文件候选。截图对应的运行包与当前源码尚未建立文件指纹对应关系。
- 源码依据：正式 `App`、首页及共用组件；设计依据另读当前 `DESIGN.md`。本轮没有启动或重新验收 Moon 原生窗口，没有执行单元测试、构建或真实模型调用。
- 已读取执行会话“初始化 Moon 技术仓库”。其中的完成陈述只是历史上下文，不代替当前代码和用户截图；本轮也不据其自行继续修复。

下文“源码事实”表示可直接定位的代码；“截图事实”表示用户现场；“推断”说明两者之间的解释及其限制。

## 2. 布局

### 2.1 正式页面结构

```text
App / AppShell
├─ 左侧导航 HomeSidebar
│  ├─ moon 品牌、折叠按钮
│  ├─ 新建会话、插件、定时任务
│  ├─ 工作区标题、搜索
│  ├─ 按工作目录分组的会话列表 / 空态 / 读取反馈
│  └─ 本地用户菜单
└─ 主内容区（flex column）
   ├─ App 级提交确认反馈 / 其他目录的提交核对入口（条件显示）
   └─ 当前目录的 OwnedHomeComposer（独立纵向滚动容器）
      └─ HomeComposer / .home-launch
         ├─ 开始一项工作
         ├─ WorkspacePicker 与目录同行反馈
         ├─ 提交副本、配置读取、保存和恢复反馈（条件显示）
         ├─ form → fieldset → ComposerPanelProvider → FieldGroup → Field
         │  └─ ComposerInputCard / InputGroup
         │     ├─ PromptInput
         │     ├─ SelectedMaterials
         │     └─ ComposerToolbar：＋ / 模型与思考 / 会话配置 / 发送
         └─ /compact 不适用提示、材料错误、演示提交结果（条件显示）
```

正式应用使用 `OwnedHomeComposer`；[HomePage](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-page.tsx:7) 是另一个可供组件库组合的入口，不能只检查它就推断正式 `App` 的反馈与恢复行为。正式组合见 [App](H:/newworkspace/example/toolwork/nianagent/src/App.tsx:472)。

### 2.2 尺寸和位置

| 对象 | 当前源码规则 | 可见效果或边界 |
|---|---|---|
| 侧栏 | 默认 280px，拖动范围 240–360px，收起为 56px | 图 1 展开侧栏占约 280px；列表滚动，顶部和账户固定 |
| 主区 | 独立 `flex` 列；当前首页容器 `flex-1 / min-h-0 / overflow-y-auto` | 侧栏和首页各自滚动 |
| 首页组合 | 宽 `min(100% - 64px, 880px)`；`margin: auto`；底部 32px | 正常高度以整个标题、目录、输入及反馈组合居中，并非只居中输入框 |
| 宽度 <768px | 左右合计 32px；底部 24px；侧栏改导航抽屉 | 抽屉上限 320px，并为遮罩留 48px |
| 高度 ≤600px | `margin-block: 0`；顶部 24px、底部 40px | 直接取消垂直居中，首页靠上；收起侧栏或同时为窄窗时顶部改 72px |
| 标题 | 26px / 32px / 500；下方 12px | “开始一项工作”，没有副标题 |
| 输入卡 | 16px 圆角；正文最小 52px、上限 `min(288px, 25dvh)` | 文本区域内部滚动，材料另占卡片空间 |
| 输入文字 | 共用 CSS 明确为 14px / 24px | 当前 DESIGN 的首页表仍写 15px / 24px，记录与实现不一致 |
| 工具栏 | 两个 flex 组；可换行；组间 8px/12px | 左＋，右模型、配置、发送；容器变窄时收紧间距和思考显示 |

依据：[首页 CSS](H:/newworkspace/example/toolwork/nianagent/src/features/home/home.css:1)、[应用壳](H:/newworkspace/example/toolwork/nianagent/src/features/home/app-shell.tsx:173)、[输入卡 CSS](H:/newworkspace/example/toolwork/nianagent/src/components/composer/composer-input-card.css:1)。

图 1、图 2 的外窗约 630px 高，扣去约 30px 标题栏后接近 600px，符合取消居中的断点。**已确认直接原因是源码存在这条短窗规则；截图很可能命中了它，但本轮没有读取该原生窗口的 `innerHeight`，不能将这个对应关系写成新的运行实测。** 该规则在旧原型中也存在，不能归因于重写时丢失了 `margin: auto`。

## 3. 组件

| 组件 | 内容与职责 | 当前状态/行为 |
|---|---|---|
| HomeSidebar / PrimaryNavigation | 品牌、折叠、新建、插件、定时任务、搜索、账户 | 插件和定时任务点击后是“尚未实现”的提示弹窗；入口存在不代表功能完成 |
| ConversationHistory / Group / Item | 按工作区分组的会话、状态、选择 | 无会话显示空态；读取失败与刷新状态属于列表 |
| WorkspacePicker | 目录名、已有目录菜单、添加工作区 | 添加通过系统目录选择器；不可用目录保留名称和原因；反馈在目录行，窄时可换行 |
| ComposerInputCard / PromptInput | 多行正文、焦点轮廓、拖入反馈 | `InputGroupTextarea`；正文受控，键盘进入统一提交逻辑 |
| SelectedMaterials / MaterialChip | 已选文件、图片、Skill | 可预览、移除、按可恢复条件重试；模型不支持图片时保留材料并限制发送 |
| MaterialPicker / MaterialCandidateList | ＋菜单、资源搜索、`@`、`/` | 候选按材料/命令分组；候选名称在上、说明在下；由统一浮层 owner 管理打开项 |
| ModelPicker / ThinkingPicker | 模型与当前思考档位的组合入口 | 根菜单进入模型或思考列表；模型按连接分组，支持搜索、读取/失败反馈；选择更新草稿 |
| SessionConfig | 工具与项目指令配置 | Dialog + Tabs；打开建立候选，应用后更新有效配置，取消丢弃候选 |
| ToolPicker | 搜索、来源分组、复选框、详情 | 搜索固定，列表滚动；整组全选/全不选；详情在工具行下展开 |
| InstructionScopePicker | 全局与目录 / 仅目录 / 不加载 | 可查看指令来源和内容；磁盘候选与保存快照分别表达 |
| ExtensionConfig（另一个弹窗） | 应用级受信扩展模块的配置 | 会话配置工具页中的“配置扩展”打开；不是工具勾选的同一保存对象 |
| SendControl | 蓝色圆形箭头 | 无有效草稿或前置条件未就绪时禁用；配置、材料核对和原提交状态参与资格判断 |

组合依据：[工具栏](H:/newworkspace/example/toolwork/nianagent/src/features/home/composer-toolbar.tsx:103)、[输入资格与卡片](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:562)、[侧栏占位入口](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-sidebar.tsx:91)。

首页没有会话页的“逐条/全部交付”和“上下文用量”辅助栏。它们属于会话完整 Composer，不能因为此前讨论过这两个按钮就添加到当前空白首页的事实清单。

## 4. 功能

| 功能 | 首页当前链路 | 限制 |
|---|---|---|
| 新建工作 | 全局或工作区组内新建，进入对应目录草稿 | 不自动发送；未接纳的首页提交要先核对原请求 |
| 目录选择与恢复 | 选择已有工作区或原生添加；按目录恢复草稿与配置身份 | 不静默替换不可用目录，不把目录记录等同文件仍可访问 |
| 材料 | 本地附件、拖入/粘贴、`@` 工作区文件、`/` Skill | 文件引用与读取文件是两个动作；资源失效、图片不兼容可阻塞发送 |
| 模型与思考 | 读取模型目录，按模型能力选择档位 | 不支持思考的模型不显示可调档位；无可用模型提供设置入口 |
| 会话配置 | Pi 实际工具、MCP/扩展工具、项目指令范围及快照 | 配置读取与保存失败有独立恢复状态；应用级扩展保存与会话工具应用分开 |
| 首次发送 | 建立原提交副本，保留等待期间下一稿，核对接纳后进入正式会话 | 结果未知不允许重复发原消息；恢复失败/材料未完成可保留首页反馈 |
| 草稿持久化 | 按目录保存文字、材料、模型和会话配置 | 写入失败保留内存草稿并显示重试；不是已保存成功 |
| 侧栏会话搜索 | 独立搜索弹窗，打开已有会话 | 搜索、列表刷新和首页状态是不同责任区 |

`/compact` 在首页只显示“请先打开已有会话”的说明，不把命令发送给模型。插件、定时任务的完整页面仍是占位入口；本文件不把 README 中的会话功能扩展成首页已显示的控件。

## 5. 交互

| 操作 | 当前响应 | 取消/失败/焦点 |
|---|---|---|
| 进入或恢复目录首页 | 恢复草稿，读取工具目录与保存配置 | 源码安排输入焦点；后到配置响应不应抢回已移走的焦点 |
| 切换目录 | 保留原草稿，恢复目标目录身份 | 正在确认提交等状态可禁用目录；失败保留原选择和原因 |
| Enter / Shift+Enter / IME | 提交 / 换行 / 合成期间不提交 | 菜单候选与正文共用键盘策略；本轮未进行新的 IME 实测 |
| ＋ / `@` / `/` | 打开候选、搜索资源或插入命令/Skill | 上下键选择；关闭保留正文；资源面板属于输入卡浮层 |
| 模型根菜单 → 子列表 | 改模型或思考档位 | 支持返回、选中标记、关闭回焦；正式保存/生效不能由菜单显示推断 |
| 会话配置 → 勾选/改范围 | 只改变弹窗候选 | 取消、关闭、Esc 放弃；应用成功才更新，失败保留候选 |
| 工具详情 → Esc | 收起当前详情 | 先返回详情按钮，不同时关闭整个配置弹窗 |
| 配置扩展 | 从会话配置再打开应用级配置弹窗 | 引入另一配置层级和另一提交责任区 |
| 首次发送等待 | 原提交副本留在输入上方，当前输入承载下一稿 | 已接纳/离开时卡片禁用；未知时检查原状态；明确拒绝后恢复草稿 |
| Ctrl+B / Ctrl+K | 切换侧栏 / 搜索会话 | 导航保存门禁与弹层焦点规则参与；`d` 外观快捷键避开编辑输入 |

## 6. 输入框上方所有文字反馈代码

### 6.1 检查边界

已沿正式 `App → OwnedHomeComposer → HomeComposer → WorkspacePicker / 提交反馈 / 输入卡` 检查条件渲染、父级传入和状态写入。下表列出**能在正文输入卡之前占据页面文档流的全部反馈入口**，包括提交副本中的状态文字；动态 `message/details` 可来自后端，不可能只靠搜索截图中的一句文案枚举。

标题、目录名是正常内容。材料/模型候选虽然视觉上位于卡片上方，却是弹层；卡片下方的材料错误、命令说明也另外列出，避免和上方常驻提示混淆。

### 6.2 当前 HomeComposer 内的反馈入口

| 编号 | 渲染位置 | 触发条件与文字来源 | 状态来源及退出条件 |
|---|---|---|---|
| H1 | [WorkspacePicker 目录反馈](H:/newworkspace/example/toolwork/nianagent/src/features/home/workspace-picker.tsx:236) | `feedback` 非空；来自本地选择错误、父级 issue/error 或当前目录 unavailable | 选择/重读成功清 localIssue；外部状态更新决定是否消失。目录 loading/missing 还会改变入口文字 |
| H2 | [提交副本](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:797) → [HomeSubmissionEcho](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-submission-echo.tsx:81) | `pendingCopy`；显示原输入；未接受且 checking/unresolved 时显示“正在核对原消息…”或 issue.message / 默认未知说明 | localSubmission 或父级 pendingSubmission；接纳、拒绝恢复及 controller 核对推进该状态 |
| H3 | [无副本的未知状态](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:811) | `unknownSubmission && !pendingCopy`；“原消息的接收结果暂未确认，当前草稿已保留。”及检查动作 | `unconfirmedSessionIds`、pendingCopy、failure.code=result_unknown / recovery=check；核对结果后切换 |
| H4 | [配置失败](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:835) | `configFailure`；标题为读取取消/未能读取，内容为结构化错误的 message/details | `configFeedback.key === configKey`；catalog/read 的 catch 写入；重读更换 revision，成功清除 |
| H5 | [草稿保存失败](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:863) | `saveError`；“草稿未保存”及内存保留说明、重试保存按钮 | [updateDraft catch](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:251)；写入成功或重试成功清除 |
| H6 | [截图中的读取提示](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:890) | `configLoading`；“正在读取会话配置，草稿可继续编辑…” | 详见下节。此分支直接写 `<p>`，没有经过 HomeSubmissionNotice 的定时消失逻辑 |
| H7 | [父级提交恢复反馈](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:895) | `submissionFeedback` 任意 ReactNode；正式 App 在 cleanupErrors 非空时传 HomeSubmissionFeedback | [App 传入](H:/newworkspace/example/toolwork/nianagent/src/App.tsx:498)，[具体组件](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-submission-feedback.tsx:18)：等待材料交接/首页提交需要处理及恢复动作 |
| H8 | [普通提交失败通知](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:896) | 无 H7，且 submissionFailure、非 unknown、非 accepted、非 recovering | [HomeSubmissionNotice](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-submission-notice.tsx:6)；默认 8 秒，悬停/聚焦暂停；reload/settings/restart 为 persistent；可手动关闭 |

H8 的 `submissionFailure` 取当前 session 的本地 `submitFeedback`，否则取父级 `submissionIssue`。写入点包括恢复原提交（391 行）、自动核对失败（474 行）、检查结果反馈（700 行）、提交 catch（748 行）；父级来自当前 homeDraft.issue。H3 的判定集中在 [355 行](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:355)。这意味着删除单一提示组件，并不会关闭 H4、H5、H6 或 H7。

### 6.3 H6 的完整触发链

```text
sessionId + workspacePath + configRevision → configKey
有 SessionService 且有目录，readySession != configKey，且无当前 configFailure
  → configLoading = true
  → 在 form 之前显示读取提示
  → Promise.all(catalog(workspacePath), read(sessionId))
     ├─ 成功：恢复 saved / seed / defaults → readySession = configKey → 提示消失
     └─ 失败：写 configFeedback → configFailure → 读取提示替换为错误反馈
```

依据：[configKey 定义](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:340)、[loading 条件与读取 effect](H:/newworkspace/example/toolwork/nianagent/src/features/home/home-composer.tsx:499)。首次进入、目录/身份变化、重读 revision 变化都会重新进入。没有延迟显示门槛，也没有只在配置入口内显示的规则；等待真实读取的时长即是占位文字显示时长。**这条代码仍在，不能宣称“上方文字提示已经全部移除”。**

### 6.4 HomeComposer 外的主区上方入口

| 编号 | 位置 | 触发 |
|---|---|---|
| A1 | [App 顶部 OperationFeedback](H:/newworkspace/example/toolwork/nianagent/src/App.tsx:288) | `notice` 非空，标题“首页提交已确认”；controller 在原消息已接受、下一稿带入会话后 [setNotice](H:/newworkspace/example/toolwork/nianagent/src/features/home/use-home-submission-controller.ts:657) |
| A2 | [App 顶部提交核对入口](H:/newworkspace/example/toolwork/nianagent/src/App.tsx:297) | 存在不属于当前可见输入/会话的待核对提交；按钮提供返回原提交的路径 |
| A3 | [首次工作区读取](H:/newworkspace/example/toolwork/nianagent/src/App.tsx:462) | `!selected && workspaces.initialLoading`；可见内容是 Skeleton，`aria-label` 有读取文字。不是截图中那条可见文字提示 |

此外，材料候选的 loading/error/diagnostics 在 [MaterialCandidateList](H:/newworkspace/example/toolwork/nianagent/src/features/materials/material-candidate-list.tsx:121)，模型读取反馈在 ModelPicker，配置读取/保存反馈在 SessionConfig；它们只有对应面板打开时才属于该面板。拖入文字在输入卡覆盖层。`unsupportedCompact`（1021 行）、材料 feedback（1028 行）、`result`（1062 行）在 form 之后，不能当作输入框上方的 H6。

## 7. 用户指出的七项问题与直接依据

### 7.1 首页靠上

存在明确的高度 ≤600px 取消居中规则。旧原型也这样实现，说明是沿用策略在常见桌面客户区中的适用性问题；目前不能仅用“照抄原型”认定视觉合格。图 4 的大窗口输入位置也不能证明 800×630 窗口体验合理。

### 7.2 上方文字反复出现

上方反馈分布在 H1–H8 和 A1–A3，分别由目录、配置、草稿、提交、恢复控制。H6 为独立原始 `<p>`，H8 为另一个带计时的通知组件。**状态安全逻辑和反馈位置没有由同一页面规则统一约束**，是当前可确认的结构性原因；只修某句文案或某一种错误，其他分支仍可显示。本轮未逐次考证历史上“至少五次”的全部修复提交。

### 7.3 会话设置的官方组件差距

按图 3 红框定位，这里实际是 **Tabs 标签组件**，不是 Table 数据表；[SessionConfig 导入](H:/newworkspace/example/toolwork/nianagent/src/features/home/session-config.tsx:14) 和组合都能核实。

已读本地 shadcn 技能、执行 `pnpm exec shadcn info --json`；CLI 因 `https://ui.shadcn.com/r/index.json` 请求 `other side closed` 失败。配置据 [components.json](H:/newworkspace/example/toolwork/nianagent/components.json:1) 核对为 radix-nova、Tailwind v4、Lucide；不冒称 CLI 返回成功配置。

官方 Radix 文档提供默认及 `line` 变体：[Tabs 官方文档](https://ui.shadcn.com/docs/components/radix/tabs)。当前基础 [tabs.tsx](H:/newworkspace/example/toolwork/nianagent/src/components/ui/tabs.tsx:24) 确有 default/line；页面选 `variant="line"`，又在 [621 行](H:/newworkspace/example/toolwork/nianagent/src/features/home/session-config.tsx:621) 覆盖全宽、左对齐、24px 间距、底边、无内边距、高 36px，并把 Trigger 改成非伸展、13px、常规字重、无圆角及单独下划线位置。因此最终呈现是经过页面改写的线形标签，不能把“导入了官方组件”当作“保持官方呈现”。官方截图无需用户另行提供；本轮未做官方 radix-nova 同尺寸渲染的逐像素比较。

### 7.4 扩展配置按钮及上下对齐

[657 行](H:/newworkspace/example/toolwork/nianagent/src/features/home/session-config.tsx:657) 新增独立边框卡片：`flex items-start`。左侧标题加两行说明，右侧 ghost/sm“配置扩展”。顶端对齐由代码明确指定，故按钮没有以整个左侧说明块上下居中。扩展卡不是旧首页原型会话配置中的原有区块，加入后会占用固定 500px 弹窗的工具列表空间；本轮只记录这项新增的布局影响。

### 7.5 工具列表多层嵌套

当前层次：Dialog → Tabs → fieldset → 工具 TabsContent → 扩展卡 → ToolPicker → 固定搜索 → 滚动列表 → 来源 section → 工具行 → 左侧 checkbox/名称/摘要 → 下方详情 region → 补充说明 → 分隔线 → 来源/工具名/位置 dl。

[ToolPicker](H:/newworkspace/example/toolwork/nianagent/src/features/home/tool-picker.tsx:77) 采用多重缩进与详情展开，行圆角 10px，详情左缩进 24px 并加竖线和内部横线。基本分组与详情层级在旧原型中已有；Moon 再加入扩展卡，使工具区的入口和滚动空间更密集。不能笼统把所有嵌套说成 Moon 重写新增。当前计数是“已选/本组全部”，旧记录要求“已选/可用”；分组也按传入顺序，没有按名称排序代码。

### 7.6 弹窗圆角差异

| 来源 | 当前值 |
|---|---|
| 通用 [DialogContent](H:/newworkspace/example/toolwork/nianagent/src/components/ui/dialog.tsx:62) | `rounded-xl`，当前对应 12px |
| [SessionConfig](H:/newworkspace/example/toolwork/nianagent/src/features/home/session-config.tsx:564) | 页面覆盖 `rounded-3xl`，24px |
| [DESIGN rounded.dialog](H:/newworkspace/example/toolwork/nianagent/DESIGN.md:54) | 24px |
| [DESIGN components.dialog](H:/newworkspace/example/toolwork/nianagent/DESIGN.md:113) | 引用 rounded.xl，即 12px |

会话配置确实与通用弹窗相差一倍；24px 来自旧原型，不是当前官方 Dialog 的统一默认规则。规范自身同时写了两套映射，这是已确认的规范一致性缺口，不能任选一条作为所有弹窗都合格的证据。DSH 的输入卡圆角又是另一个产品的 token，不能用来裁决 Moon 弹窗。

### 7.7 工作区文件下的两条路径

[后端目录扫描](H:/newworkspace/example/toolwork/nianagent/backend/materials.mjs:423) 返回 `name=文件名`、`description=relative(cwd, actual)`、`source=绝对真实路径`；[MaterialPicker](H:/newworkspace/example/toolwork/nianagent/src/features/home/material-picker.tsx:306) 用 `[item.description, item.source].filter(Boolean).join(" · ")` 生成候选说明，[候选行](H:/newworkspace/example/toolwork/nianagent/src/features/materials/material-candidate-list.tsx:104) 在文件名下原样显示。

相对路径可区分同名文件；绝对路径用于定位真实资源和后续引用核对。**source 在业务上有用途，不代表它必须常显在每个候选行。** 当前把业务定位字段直接当辅助文案输出，导致顶层文件名再次出现在相对路径，并追加当前工作区已有的完整绝对前缀。未查到要求普通候选常显双路径的确认记录。

## 8. 实现劣化原因：已确认与未确认

| 现象 | 当前可确认的原因 | 不能据此扩大成的结论 |
|---|---|---|
| 常见小桌面窗口靠上 | 短窗断点无条件取消居中；策略从旧原型延续 | 不是整个首页居中实现全部丢失；本轮未验证运行窗口精确高度 |
| 修过提示仍出现 | 多个独立 owner 和独立渲染分支；配置 loading 仍直接渲染 | 未考证每次历史修复的具体失误，不归结为某个人或工具能力 |
| 官方控件外观差异 | 页面覆盖官方默认形态；旧原型也自绘标签 | 组件导入/无报错不等于视觉与交互合格 |
| 扩展入口挤占列表 | 新业务设置插入固定高度工具工作面，使用顶对齐卡片 | 扩展能力存在不等于应采用当前入口层级 |
| 工具复杂 | 沿用旧分组/详情嵌套，再叠新增配置区；计数/排序细节也漂移 | 不把“旧记录已实施”当作用户已确认当前所有细节 |
| 圆角不统一 | 专用弹窗覆盖基础组件，设计规范内部映射冲突 | 不能以任一局部规范证明整套弹窗一致 |
| 双路径 | 数据 source 与展示 description 未做职责区分 | 不应删除真实资源定位能力来解释展示问题 |

这份基线显示，问题既包括新接入功能后的布局叠加，也包括旧策略本身不适合当前窗口，以及规范和实现之间没有持续保持一致。上述是可定位的实现关系；是否采用新的布局、提示承载方式或工具组织方式，留给后续按页面确认，不在本轮实施。

## 9. 后续对照范围与未验证项

后续优化至少应同时检查空白首页、600px 临界客户区、配置读取中/失败、保存失败、原提交未知/恢复、工具搜索/详情、扩展弹窗、`@` 文件候选和材料较多状态。每项以整个首页组合和展开状态判断，不能只看默认组件示例或模型调用成功。

本轮未验：Moon 新的浏览器/原生运行复现、全部失败交错、原生跨窗口拖入、真实 IME、模型推理、官方 Tabs 同视口视觉比较。文档完成不表示七项问题已修复或首页验收通过。
