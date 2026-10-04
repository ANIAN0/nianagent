# 旧项目首页：设计记录、原型组件、功能与交互

记录日期：2026-10-05。用途：固定 Moon 重写应继承的旧项目依据，区分文字要求、已确认记录、原型实现与真实业务能力。本轮不修改旧项目。

同组文档：[Moon 当前首页](H:/newworkspace/example/toolwork/nianagent/docs/homepage-baseline/moon-homepage.md)、[DSH 首页](H:/newworkspace/example/toolwork/nianagent/docs/homepage-baseline/dsh-homepage.md)。

## 1. 范围、版本与证据

- 旧仓库：`H:\newworkspace\example\toolwork\agenttool`；HEAD `8769b93267dbce7a99d9fabca1b5f81b56655370`。原型位置 `redesign-2026/prototype/frontend`；本文件以本轮磁盘文件为准，不声称 HEAD 包含所有原型文件。
- 需求和设计：[首页](H:/newworkspace/example/toolwork/agenttool/redesign-2026/design/workbench/home.md:1)、[工作台布局](H:/newworkspace/example/toolwork/agenttool/redesign-2026/design/workbench/layout.md:1)、[会话侧栏](H:/newworkspace/example/toolwork/agenttool/redesign-2026/design/workbench/session-sidebar.md:1)、[输入区](H:/newworkspace/example/toolwork/agenttool/redesign-2026/design/agent-interaction/composer.md:1)、[会话配置](H:/newworkspace/example/toolwork/agenttool/redesign-2026/design/agent-interaction/configuration.md:1)。
- 实施记录：[COMPONENTS.md](H:/newworkspace/example/toolwork/agenttool/redesign-2026/COMPONENTS.md:16)。001 输入、002 附件轨、003 候选、004 资源、005 材料条目、006 队列、007 发送、022 布局、023 首页、024 配置、025 模型、026 工具、047 目录、049 侧栏等被记为“已实施”。这证明记录状态，不自动证明用户逐项视觉确认或生产接入。
- 原型实现：[NewSessionWorkbench](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/pages/home/NewSessionWorkbench.tsx:17)、[ShadcnComposer](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/components/composer/ShadcnComposer.tsx:1)、[Application](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/app/Application.tsx:1)。
- 本轮读取源码、Story 和记录，没有重新启动/运行原型；既有记录的实测不是本轮实测。原型 README 明确多数服务、文件、持久化及失败是内存演示，不能当 Moon 当前真实能力的证明。

## 2. 布局

### 2.1 首页组合

```text
Application / 工作台布局
├─ 会话侧栏
│  ├─ 品牌、折叠、新建
│  ├─ 插件、定时任务固定入口
│  ├─ 工作区标题、搜索、目录分组会话列表
│  └─ 本机账户菜单
└─ NewSessionWorkbench (.root → .scroll → .launch)
   ├─ 开始一项工作
   ├─ hidden 文件 input
   └─ 共享 ShadcnComposer (.home-composer)
      ├─ 目录条（仅首页）
      ├─ 待处理/提交/notice（对应状态才存在）
      ├─ 输入卡：材料、Skill、多行正文、工具栏
      │  ├─ ＋ / 候选与引用资源
      │  └─ 模型与思考 / 会话配置 / 发送
      └─ 上下文、交付等辅助能力（按会话状态和 props）
```

首页只调整共享 Composer 的空间，不另写一份卡片。设计把首页定义为“未开始对话的会话空态”，首次发送原处进入执行，与会话中的输入和配置复用。

### 2.2 尺寸与空间

| 对象 | 旧需求/原型规则 | 与当前 Moon 的关系 |
|---|---|---|
| 左侧栏 | 默认 280px，可调 240–360px；收起 56px | Moon 沿用数值 |
| 品牌与导航 | 品牌 60px；新建 38px；固定导航 36px；工作区标题/目录/会话各有紧凑行高 | 保持侧栏阅读层级，不以大量卡片表达分组 |
| 首页组合 | `min(100% - 64px, 880px)`；margin:auto；底部 32px | Moon 当前首页 CSS 同样采用 |
| 标题 | 26px / 32px / 500；下间距 12px | Moon 沿用“开始一项工作” |
| 首页正文 | 最少 52px；最高 `min(288px, 40dvh)`；15px / 24px | Moon 当前共享 CSS 改为 14px，上限改 25dvh；不能当作完全延续 |
| 窄窗 | <768px 主区全宽，左右各 16px；完整侧栏抽屉 | 这是 agenttool 选择，不是当前 DSH 的 1024px 自动图标轨规则 |
| 短窗 | ≤600px 取消居中，顶部 24px、底部 40px；侧栏收起顶部 72px | Moon 沿用了主要策略，所以“靠上”不全是迁移新增 |
| 会话配置 | 600px×500px 上限适配视口，圆角 24px；内容左右 24px；底部固定取消/应用 | Moon 专用配置 Dialog 与旧原型一致，但通用 Dialog 采用了另一套圆角 |

精确原型样式见 [NewSessionWorkbench.module.css](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/pages/home/NewSessionWorkbench.module.css:19)。**旧方案存在或被标记已实施，不等于在 600px 常见客户区取消居中的效果已经满足本次用户期望。**

## 3. 组件

| 组件/记录编号 | 内容与职责 | 实现来源及性质 |
|---|---|---|
| 023 NewSessionWorkbench | 标题、目录草稿、共享输入组合 | 原型页，不是真实业务服务 |
| 022 工作台布局 | 侧栏调宽、折叠、抽屉、独立滚动 | Application 组合，要求状态不因布局切换丢失 |
| 049/050 会话侧栏与列表 | 固定导航、目录分组、状态、菜单、空态与错误 | 不是把完整工作空间插件当基础聊天前置条件 |
| 047 ShadcnDirectoryBar | 目录入口、已有目录菜单、浏览器、核对状态 | 状态只显示于目录入口同行一次，窄时换行 |
| 001 ShadcnComposer | 正文、材料、工具栏、反馈、辅助区的完整组件 | 顶层明确规定 002/003/004/024 等组成，不只算 textarea |
| 002/005 ShadcnAttachmentRail / SkillReferences | 横向材料轨、缩略图/来源、预览/移除/重试 | 与正文的滚动职责分开，目录/会话草稿保持引用 |
| 003 ShadcnCandidateMenu | `@` 文件、`/` Skill/模板/命令、＋程序化候选 | 同一候选管线，不为每个入口重写资源逻辑 |
| 004 ShadcnResourcePicker | 搜索文件、Skill、插件资源的弹层 | hold-focus 搜索，与输入候选共用引用结果 |
| 025 ShadcnModelSelect | 模型/思考组合，两级列表 | 当前组合在尾部勾选；模型不可用保留原因 |
| 024/026 ComposerToolsPicker | 统一“会话配置”：工具与项目指令 | 旧原型 vendor/desktop 的适配组件，并非当前 DSH 官方同名 Dialog |
| 007 ComposerSendButton | 发送、排队、停止、等待/阻塞 | 主动作随状态变化，不能只实现空闲蓝箭头 |
| 上下文/队列辅助组件 | 用量、上下文压缩、队列交付模式 | 会话完整 Composer 范围；不能因在卡片外而漏审 |

[ShadcnComposer 顶部说明](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/components/composer/ShadcnComposer.tsx:2) 将正式目标写成独立 shadcn 输入路线，参考 DSH 的交互但不依赖 DSH/Lexical 运行时。目录名含 vendor 不自动证明官方组件未改写。

### 3.1 工具配置的实际结构

旧 [ComposerToolsPicker](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/vendor/desktop/ComposerToolsPicker.tsx:90) 使用 shadcn Dialog、Input、Checkbox、RadioGroup、Button；**工具/项目指令标签由原生 button + role=tablist/tab/tabpanel 自行实现**，并不是官方 Tabs 的默认示例。

工具页是固定搜索 + 单个列表滚动；列表按来源分组，组标题和全选/全不选，工具行显示勾选、名称、摘要、不可用原因、详情。详情在行下方缩进 24px、竖线承接，再以分隔线和来源/工具名/位置标签列展示。源码 [145 行](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/vendor/desktop/ComposerToolsPicker.tsx:145) 已有这组嵌套。**当前工具嵌套的基本结构并非 Moon 新增；继承它时仍需要判断体验是否满足本次期望。**

旧工具页没有当前 Moon 的应用级“扩展能力 / 配置扩展”卡片，因此当前列表额外缩小的可用空间属于后续新增区块影响。

## 4. 功能

| 功能 | 旧需求 | 原型/生产边界 |
|---|---|---|
| 首页输入 | 直接发起工作，首条发送后原处呈现执行 | 原型 onSubmit 和示例状态不能证明真实 Pi 执行 |
| 草稿恢复 | 每个目录保留一份，进入自动回填并聚焦，不另建草稿菜单 | 重启持久化是需求；内存原型只证明当前组合行为 |
| 工作目录 | 启动不强制选择；新建与发送校验关联；不可用不迁移草稿 | 原型目录宿主是内存目录树，不是真实 Windows 文件校验 |
| 材料/引用 | 图片内容、真实文件或资源引用、Skill 用途和来源 | 真实准备/读取/失效仍需正式接入；引用不等于已读 |
| 模型/思考 | 恢复目录/会话选择；无选择读应用默认；默认失效要求选择 | 不准以列表第一项代替明确默认 |
| 工具/项目指令 | 一个配置面板、同一候选事务；应用后才有效 | 工具选择不是审批授权；指令有自己的生效边界 |
| 首次提交核对 | 原位提交副本；未知检查原状态；明确拒绝才恢复编辑 | 不能通过再次发送猜测第一次是否接受 |
| 侧栏会话 | 按绑定目录分组、消息时间降序、本应用范围 | 空未发送首页不制造普通历史行，独立分支有例外 |
| 插件/定时任务 | 固定宿主入口及对应业务页面 | 旧原型已有模拟页面；Moon 当前两个入口仍占位，不能视为自然继承完成 |

旧首页要求、原型演示和当前 Moon 生产实现是三个不同事实。记录“已实施”并不能填补新的后端契约、持久化、资源来源和错误状态。

## 5. 交互

| 操作 | 已记录的规则 | 当前需要对照的边界 |
|---|---|---|
| 新建 | 自动回填该目录草稿并聚焦；重复新建不清稿 | 首页整体链路，不只按钮 onClick |
| 切目录 | 先保存原草稿、再恢复目标；不同目录不覆盖/合并 | 目录和提交身份必须一致 |
| 文本 Enter | 当前主动作；Shift+Enter 换行；IME 选字不提交 | 候选打开先选候选，Esc 关闭不同时发送 |
| 材料选择 | 同来源去重，候选与＋资源共用结果，预览/移除/重试 | 光标后的正文保留；不可用材料仍有来源和原因 |
| 模型/思考 | 根菜单分两项，子列表只列实际能力；宿主成功才更新并关闭 | 失败保留原值和候选；不任意降档或换模型 |
| 会话配置 | 打开候选；应用提交；取消/Esc 放弃；同刻只保存一份 | 保存/未知不丢候选，停止与只读能力按职责保留 |
| 工具详情 | 无填充文字箭头，整行只有一个悬停面；详情对齐名称轴 | 摘要不重复、来源标签列统一；不能再叠独立胶囊背景 |
| 工具搜索与组操作 | 搜名称、用途；组操作影响整个来源组，需表达整组范围 | 全选仅可用项，全不选也移除失效项；计数为已选/可用 |
| 首次等待/未知 | 保留原输入副本及下一稿，提供检查发送状态 | 接纳/拒绝后分别交接，不误删等待期间新材料 |
| 折叠/调宽/窄窗 | 不清草稿、不停止执行、不重置阅读现场；Esc 只关最上层 | 抽屉焦点回返与 modal 语义也属于页面交互 |

工具和配置的原要求见 [configuration.md](H:/newworkspace/example/toolwork/agenttool/redesign-2026/design/agent-interaction/configuration.md:1)；队列交付、停止和未知状态见 [composer.md](H:/newworkspace/example/toolwork/agenttool/redesign-2026/design/agent-interaction/composer.md:1)。

## 6. 输入框上方文字与反馈的历史依据

旧记录并没有给“输入卡上方可随意添加任何说明”授权，也不是整个输入组件绝无文字反馈。

| 对象 | 旧设计/实现 | 与本次问题的关系 |
|---|---|---|
| 目录状态 | [home.md](H:/newworkspace/example/toolwork/agenttool/redesign-2026/design/workbench/home.md:1) 要求只在目录入口同行显示一次；卡片不重复通用阻塞文案 | 反馈应靠其负责入口，不能多个区块重复 |
| 错误 notice | ShadcnComposer 使用 anchored Toast | 不以一个永久 error 段落覆盖所有情况 |
| info notice | [694 行](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/components/composer/ShadcnComposer.tsx:694) 为单条 composer-input-notice | 这是旧组件的明确输入，不等于 Moon 独立 configLoading 已获确认 |
| 原提交/未知 | 原位副本和 `submission-notice`；未知不提供重新发送原消息 | 属于提交生命周期，不是首页常驻副标题 |
| blockedReason | 原型 [661 行](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/components/composer/ShadcnComposer.tsx:661) 仍有条件 status；可由宿主传 null 把说明交给外部 | 旧实现也需核对实际组合，不能只引文字要求称零重复 |
| 待处理消息 | 原型输入区 dock 明确在正文上方 | 仅对应会话状态，不因首页空态自动显示 |

未在所查旧首页原型中发现 Moon 那句“正在读取会话配置，草稿可继续编辑…”的同名读取分支。Moon 接入真实配置服务后新增了这条独立反馈；若只复用空态布局而不统一新增业务反馈位置，就会出现当前 H1–H8 并列输出的情况。

## 7. 七项问题的继承、漂移与缺口

| 用户问题 | 旧项目事实 | 对原因判断的影响 |
|---|---|---|
| 首页靠上 | 短窗 ≤600px 取消居中已存在 | 是旧策略适用性也要重审，不全是迁移劣化 |
| 上方文字重现 | 单条 info/Toast、目录同行、提交副本已有明确类型；没有同句 configLoading | 真实业务新增反馈没有统一继承展示职责，是新增差异 |
| 官方 Tabs 差距 | 旧工具标签是自绘 role tabs；Moon 改用官方 Tabs 后又保持线形覆盖 | “改为官方组件”没有自动回归官方呈现，需区分基底与页面覆盖 |
| 扩展按钮 | 原会话配置工具页无此应用级卡片 | 是新增区块，应单独记录入口位置、对齐和对列表空间的影响 |
| 工具多层嵌套 | 分组、行下详情、竖线、元数据列已存在 | 一部分是继承的设计；新增扩展层进一步叠加，不应错误归因 |
| 弹窗圆角 | 此专用面板明确 24px | 可解释 Moon 特例来源，不能解释与通用 12px 的统一性；本轮未审完旧项目全部弹窗 |
| 文件双路径 | [ResourceEntry](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/components/composer/ShadcnResourcePicker.tsx:25) 规定文件 source 为工作目录相对路径；用途 detail 分开 | 没有要求普通候选常显相对+绝对路径；Moon 数据接入后把两个职责合成说明 |

另有可定位漂移：旧正文 15px→Moon 14px；旧正文上限 40dvh→25dvh；旧组计数可用数→Moon 全部数；旧工具按名称排序→Moon ToolPicker 依输入顺序。这些只是已查差异，不自动断言每项都是错误或要求本轮恢复。

## 8. 实现劣化原因：旧记录能证明什么

旧设计有完整页面与输入组件边界，包含正常、加载、失败、未知、取消、焦点、窄窗与材料状态。当前问题不能简单解释为“旧需求完全缺失”。但设计条目“已实施”、组件能打开、模拟调用能成功，都不能保证迁移后的正式页面维持相同密度和责任边界。

这次对照确认了三类情况：**继承但需重审的策略**（短窗顶对齐、工具详情层级）；**迁移时漂移的实现**（文字尺寸、计数/排序、官方组件页面覆盖）；**真实业务接入后的新增呈现**（配置 loading、提交恢复反馈、应用级扩展卡、绝对路径来源）。将它们混在一张“修复清单”里，会掩盖究竟是原设计不适合、继承不完整，还是新增功能没有融入页面。

后续应以本轮用户当前确认作为准则，并保留原型的出处及差异理由。不能以旧记录为由自动保留本次明确不接受的效果，也不能以 DSH 为由未经确认替换 Moon 的整套产品设计。本轮只记录这些关系，没有替用户选择新方案。

## 9. 后续对照范围与未验证项

原型的 [023 Story](H:/newworkspace/example/toolwork/agenttool/redesign-2026/prototype/frontend/src/stories/pages/shadcn-home.stories.tsx:11) 已有空白、目录草稿、Skill、未选/不可用/核对目录、长目录及窄窗场景；这些可用作后续复核入口，但本轮没有运行它们。

未验：旧原型当前视觉、600px 临界实际效果、全部目录草稿与提交未知组合、真实 IME、原生文件与服务、旧全部弹窗的圆角一致性、已实施条目中哪些有可追溯的逐项用户视觉确认。文档记录与原型代码不能代替这些验证。
