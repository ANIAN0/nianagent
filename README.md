# Moon

本地 agent 桌面应用。对话生成与历史仍使用模拟数据；模型配置和会话工具/指令配置已通过唯一 Node 宿主接入 Pi SDK，支持本地持久化。

技术栈：React + TypeScript + Vite + shadcn/ui + Tauri 2，使用 pnpm。

首页沿用 agenttool 原型的布局与蓝色主题，提供按目录分组的会话、弹窗搜索、工作目录选择、需求输入、模拟附件/Skill、模型与思考两级选择，以及工具和项目指令配置。桌面侧栏默认 280px，可拖动至 240–360px，收起后保留 56px 图标列；`Ctrl+B` 切换侧栏，`Ctrl+K` 搜索会话。首页发送会进入新对话；历史记录与搜索可打开已有会话。对话支持模拟流式回复、Markdown/代码、思考与工具详情、附件预览、停止与重试、消息排队、分步问答及阅读位置恢复。新建会话返回首页；插件和定时任务入口仍给出范围提示；侧栏底部“设置”打开模型连接工作区。各会话草稿、队列与消息仅保存在内存中，刷新后重置。可从侧栏底部切换外观（也支持按 `d` 切换深浅主题）。模型与会话配置通过本地服务保存；会话生成、对话存储和工具执行仍是模拟。

## 对话体验

现有历史会话分别提供完整场景：

- “梳理首页的交互细节”：多轮审查、表格、嵌套任务清单与执行过程。
- “检查项目目录结构”：代码、diff、多文件调用及说明与工具交替出现。
- “整理开发环境”：失败详情、中断回复与保留的队列，支持继续处理。
- “整理本周的工作笔记”：单选、多选、自由输入三步问答。
- “阅读资料与摘要”：本地标识图片、长文件名、材料预览与摘要。

首页或对话发送后会逐字显示模拟回复；生成期间空草稿显示停止，输入新内容后显示排队。队列可编辑、移除或立即发送，正常生成结束后按逐条或全部模式投递。需求包含“确认”或“问我”时会进入示例问答；“模拟失败”或“模拟超时”触发可重试的失败示例。停止后队列仍可逐项发送。

上下文用量及压缩是前端模拟；附件只记录名称，预览示例内容，不读取文件。模拟消息和队列刷新后重置；已应用的会话工具/指令配置由后端持久化。右侧执行概览、多 agent 管理和文件差异工作区尚未实现。

## 模型设置

侧栏底部“本地用户 → 设置”进入正式模型配置。连接支持搜索、分页、添加、编辑和删除；配置保存在本机，刷新和重启后保留。每次保存检查 revision，旧窗口不能覆盖更新。删除连接同步移除其模型和凭据；已有会话不会自动切换到其他模型。

API 连接支持保存密钥、后端环境变量及无凭据。密钥默认遮蔽，可通过输入框右侧按钮显示、隐藏和复制；清除密钥后连接仍可保存，但会标记不可用。环境变量变更后需要重启后端进程。自定义请求头仅接受字面值，不支持命令、变量表达式及认证头。Windows 默认文件为 `%LOCALAPPDATA%/Moon/models/models.json`，含敏感信息，仅供当前用户本地使用，不是加密保险库。

“测试连接”读取 OpenAI 兼容或 Anthropic 模型目录，不保存候选，也不等于推理成功。未知上下文、输出和思考能力显示待补全；补全后才能保存。模型行的“检查”经 Pi 发起真实短推理，可能产生费用。发现与检查可取消并保留草稿，修改模型配置后旧检查结果失效。首页与会话的思考等级来自 Pi 能力；不支持思考的模型不显示强度入口。订阅连接从 Pi 支持的提供者中选择，授权窗口显示 Pi 实际 URL、设备码和输入步骤；退出、取消及 token 刷新沿用 Pi 机制。

组件库仍使用明确的服务替身和演示数据，不写正式配置。真实第三方授权需要用户账号，真实在线推理需要有效凭据；本地兼容服务不强制要求密钥。

## 会话配置

首页与会话输入区的“会话配置”共用同一弹窗：工具来自 Pi 实际注册目录，缺少本地运行依赖的工具说明原因并禁止选择，不自动下载依赖。项目指令支持全局与目录、仅目录、不加载三档；可查看文件路径及正文。全局指令位于 `%LOCALAPPDATA%/Moon/models/agent/`，目录指令按 Pi 的祖先目录与文件优先规则发现。

打开弹窗建立候选；取消、关闭或 Esc 不保存，应用成功后才更新生效值。读取失败可重读，应用失败保留候选，旧版本不能覆盖其他窗口的更新。已应用指令保存快照；弹窗展示本次磁盘候选，并提示与已保存快照的差异；文件变化后需明确点击应用才更新。

配置按稳定会话 ID 保存在 `%LOCALAPPDATA%/Moon/models/session-config/sessions.json`，真实 Pi AgentSession 的活动工具与指令来源用于核对生效状态。首页选项随该工作目录的待发送草稿恢复，新建对话沿用该配置 ID。配置操作不发起推理；当前聊天回复、工具执行动画及消息历史仍是模拟，不能作为真实模型执行的证明。实际目录不存在时明确报错，不创建示例目录。

## Pi SDK

已安装官方 `@earendil-works/pi-coding-agent` 1.0.0，SDK 包含在该包中。按[官方 SDK 文档](https://pi.dev/docs/latest/sdk)使用 Node.js/Bun 进程内集成；本项目使用 pnpm，安装命令为：

```powershell
pnpm add --save-exact --ignore-scripts --registry=https://registry.npmjs.org @earendil-works/pi-coding-agent@1.0.0
```

该版本要求 Node.js >=22.19.0。版本与依赖树由 `package.json` 和 `pnpm-lock.yaml` 固定，后续正常执行 `pnpm install` 即可恢复。[官方安装说明](https://pi.dev/docs/latest/quickstart)支持忽略依赖生命周期脚本。本次命令临时指定官方 npm registry，不修改全局镜像配置。

SDK 在 `backend/` 的 Node 子进程中运行，由 Tauri 唯一启动，通过 JSON 行 RPC 与桌面通信，同时提供带令牌的回环 HTTP 供开发浏览器代理连接；两者使用同一个 ModelService 与其 SessionService 实例。Windows/macOS/Linux 桌面运行均需在 PATH 中提供 Node.js >=22.19。当前未把 Node 可执行文件打包进安装程序。模块边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 环境与安装

以下命令均在仓库根目录执行，即包含 `package.json` 和 `src-tauri/` 的目录。

- Node.js：Vite 要求 `^20.19.0 || >=22.12.0`；本机使用 24.16.0。
- pnpm：本机使用 11.24.0，项目依赖由 `pnpm-lock.yaml` 锁定。
- 桌面开发另需 Rust stable（`Cargo.toml` 声明最低 1.90；当前锁定依赖已在 1.99.0 验证）。
- Windows 桌面开发需 Visual Studio C++ 构建工具、Windows SDK 和 WebView2 Runtime。其他平台及详细安装步骤见 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)。

检查工具并安装前端依赖：

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
```

仓库没有 `.env.example`，当前也没有必填环境变量或额外初始化步骤。首次运行 Cargo 时会自动下载 Rust 依赖，需联网。

## 开发启动

### 桌面应用

```powershell
pnpm tauri dev
```

此命令自动启动 Vite，再编译 Rust 并打开标题为 `moon` 的窗口，无需另开终端运行 `pnpm dev`。窗口显示“开始一项工作”和输入卡即为预期首页。首次原生编译可能较慢。

桌面开发固定使用 `http://localhost:5173`，Vite 绑定 `127.0.0.1:5173` 并启用严格端口检查。端口被占用时启动会失败，应先退出占用该端口的开发实例。关闭窗口会隐藏到托盘；退出应用使用托盘“退出 Moon”。结束整次开发（包括 Vite）使用原开发终端的 `Ctrl+C`。

### 仅调试前端

```powershell
pnpm dev --host 127.0.0.1 --port 5173 --strictPort
```

浏览器打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)，应看到同一首页。浏览器模式不提供 Tauri 原生能力。简写 `pnpm dev` 也可启动，但端口占用时可能自动选择其他端口，以终端输出为准。

### 接口目录

同一个 `pnpm dev` 服务提供 [接口目录](http://127.0.0.1:5173/api-catalog/)。目录从正式 RPC 契约读取操作、参数、影响和例子，可执行真实调用；模型检查可能产生费用，保存、删除和授权会改变本地配置。原生窗口内使用 Tauri 命令，浏览器通过 Vite 同源代理连接已运行的 Moon 模型服务；Vite 不再创建后端。浏览器真实模型功能要求桌面应用运行，组件库模拟展示不依赖后端。

`pnpm test:backend` 运行正式回归测试，临时目录与本地协议服务在结束后清理。`pnpm backend:package` 用 pnpm deploy 生成独立后端生产依赖目录；`pnpm desktop:build` 发布构建会自动执行，使用生产配置携带后端资源。`src-tauri/runtime/` 为忽略的构建产物，不手工编辑。

### 组件库

运行同一个 `pnpm dev` 后，打开 [组件库](http://127.0.0.1:5173/ui-catalog/)；无需启动第二个服务。若 Vite 自动更换端口，使用终端显示的端口。

- 左侧按页面、复合组件和基础组件分组，可搜索中文名、源码组件名或状态。每个组件包含概览和独立状态画布。
- 概览将职责、所有真实状态及预期行为放在一起，预览随中栏宽度和内容高度调整，每个示例可单独重置；画布用于完整尺寸交互。右侧提供参数、事件、正式源码，以及从真实导入关系生成的可跳转组成和使用方。
- 根目录 [DESIGN.md](DESIGN.md) 维护生效的设计 token、主题映射、组件边界和视觉依据；组件库顶栏也可下载。
- 中间 iframe 直接渲染正式组件，可调整实际视口尺寸、切换主题、重置或独立打开。切换状态、主题或重置会重新创建预览；窄屏切换面板保留预览。
- 可直接访问 [首页预览](http://127.0.0.1:5173/ui-catalog/preview.html?component=home-page&state=default)。选择状态后的组件库 URL 也可刷新或分享。
- 展示数据与提交替身位于 `ui-catalog/fixtures/`，预览主题仅存于内存，演示不会改变正式首页的数据或已保存的外观。

新增展示时，在正式组件旁添加一份 `*.catalog.tsx`，填写状态和文档并直接导入正式组件；`ui-catalog/catalog.ts` 自动发现，无需手工登记目录。

首页组件按职责分层，功能组件及相邻展示定义都放在 `src/features/home/`：

- `HomeComposer` 持有唯一草稿和提交校验，组合 `WorkspacePicker`、`PromptInput`、`SelectedMaterials` 和 `ComposerToolbar`；工具栏再组合 `MaterialPicker`、`ModelPicker`、`SessionConfig` 与 `SendControl`。选择值通过参数传入，变更通过回调返回；`ModelPicker` 按连接分组，组合 `PickerOption` 与 `ThinkingPicker`，统一两级选择入口；方向键仅浏览，Enter/空格确认。空目录可进入设置，读取失败可直接重试。`SessionConfig` 组合 `ToolPicker` 和 `InstructionScopePicker`，内部暂存候选值，只有“应用”才更新草稿，“取消”丢弃本轮修改。
- `HomeSidebar` 组合 `PrimaryNavigation`、`ConversationHistory` 和 `UserMenu`；`ConversationHistory` 管理组折叠，并复用受控的 `ConversationGroup`，分组调用 `ConversationItem`；`SelectedMaterials` 则调用独立的 `MaterialChip`。外观仍由 `ThemeProvider` 管理。
- `AppShell` 负责共享桌面/移动布局、导航显隐与宽度、搜索和页面提示，`HomePage` 组合首页供独立展示；`ConversationSearch` 负责搜索弹窗及查询。基础控件沿用 `src/components/ui/` 的 shadcn 实现。

维护展示时，从页面沿组成关系逐层核对功能组件及基础控件，包括间接使用的 Input、Textarea、Label、Separator；同一控件族的子组件在该族展示中组合验证，不复制正式实现。

## 构建与预览

```powershell
pnpm build
pnpm preview --host 127.0.0.1 --port 4173 --strictPort
```

`pnpm build` 先执行 TypeScript 项目构建检查，再生成 `dist/`。预览地址为 [http://127.0.0.1:4173](http://127.0.0.1:4173)，仅用于本地检查前端产物，不是生产服务。

组件库及 iframe 预览随同一构建发布，分别访问 [组件库](http://127.0.0.1:4173/ui-catalog/) 和 [预览入口](http://127.0.0.1:4173/ui-catalog/preview.html)。它们共用现有 Vite 配置、类型检查和 `dist/` 输出目录。

桌面发布构建：

```powershell
pnpm desktop:build
```

Tauri 会先运行 `pnpm build`，再构建原生程序与平台安装包，默认输出在 `src-tauri/target/release/` 和其中的 `bundle/`。当前应用标识为 `local.moon.desktop`，没有配置发布签名；安装包构建尚未验证。

## 检查

```powershell
pnpm build
pnpm lint
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

后端自动化回归运行 `pnpm test:backend`。`pnpm typecheck` 虽然存在，但根 tsconfig 主要通过 references 引用子项目，完整 TypeScript 检查应使用 `pnpm build`。

`pnpm format` 会直接改写 TypeScript/TSX 文件，需要格式化时再执行。

原生首页此前已通过 `pnpm tauri dev` 验证；安装包构建尚未验证。前端改动在实现完成后统一检查正式页面、组件库和生产预览。

## 目录与职责

```text
.
├── public/                     # 原样提供的静态资源；moon.svg 是 Lucide 图标源文件；fonts/ 保存本地思源黑体
├── src/                        # React 前端
│   ├── main.tsx                # 挂载 React，装配主题 Provider，加载全局样式
│   ├── App.tsx                 # 首页/对话/模型设置导航，组合会话状态与页面
│   ├── index.css               # Tailwind 入口、主题变量与全局样式
│   ├── components/            # 可复用界面组件；包含主题 Provider
│   │   └── ui/                # shadcn 官方 CLI 生成的基础组件
│   ├── features/home/         # 共享应用布局、侧栏、首页输入卡和模拟选项
│   ├── features/models/       # 模型连接目录、连接/模型草稿、授权流程、正式服务适配与组件库替身
│   ├── features/session/      # 会话配置服务适配、稳定草稿标识与组件库注入边界
│   ├── features/conversation/ # 会话状态、模拟流式数据、页面/阅读/导航
│   │   ├── messages/          # 用户/Agent消息、Markdown、附件、执行过程和工具详情
│   │   └── composer/          # 对话输入、发送/停止、队列、问答和上下文用量
│   └── lib/                   # 共享工具，目前通过 utils.ts 导出 cn
├── backend/                    # Pi模型/会话配置、CredentialStore、授权任务和唯一Node宿主
├── api-catalog/                # 同一服务下的真实接口目录与调用面板
├── src-tauri/                  # Tauri 原生端及打包配置
│   ├── src/                   # main.rs 调用 lib.rs；window_lifecycle.rs 管理托盘和窗口
│   ├── capabilities/          # 窗口可用的原生权限，目前只有 core:default
│   ├── icons/                 # Tauri CLI 生成的桌面平台图标
│   ├── Cargo.toml             # Rust 依赖、crate 信息和最低 Rust 版本
│   ├── Cargo.lock             # Rust 依赖锁文件
│   ├── build.rs               # 调用 Tauri 构建辅助逻辑
│   └── tauri.conf.json        # 应用标识、窗口、开发地址和打包设置
├── ui-catalog/                 # 同一服务下的组件库与 iframe 页面、自动发现和文档联动
│   └── fixtures/              # 独立的展示数据与服务替身
├── index.html                 # Vite HTML 入口、页面标题和网页图标
├── DESIGN.md                   # 生效设计 token、组件规则与源码映射
├── components.json            # shadcn 风格、组件路径和别名配置
├── vite.config.ts             # React/Tailwind、路径别名及首页/组件库/预览的构建入口
├── tsconfig*.json             # TypeScript 项目及前端/构建配置检查范围
├── eslint.config.js           # ESLint 检查规则
├── .prettierrc                # Prettier 格式化配置
├── .prettierignore            # 格式化排除项
├── package.json               # 前端依赖和开发命令
├── pnpm-lock.yaml             # 前端依赖锁文件
└── pnpm-workspace.yaml        # pnpm 安装配置；包含 backend 工作区包
```

从现有调用关系看，React 负责页面，Rust 负责桌面运行入口，两者通过 Tauri 的开发地址和构建产物配置连接。修改页面从 `src/App.tsx` 开始；基础控件位于 `src/components/ui/`，通用组合组件位于 `src/components/`。原生能力在 `src-tauri/src/` 实现，所需权限在 `capabilities/` 配置。首页代码位于 `src/features/home/`：app-shell 负责共享布局，home-sidebar 负责导航，home-composer 负责输入与提交，mock-data 集中维护演示数据。会话状态集中在 `use-conversations.ts`，模拟历史和回复位于 `mock-conversations.ts`；展示组件通过参数接收消息和草稿，不访问后端。消息滚动使用官方 MessageScroller，Markdown 使用 react-markdown 与 remark-gfm，不启用原始 HTML。

`public/moon.svg` 是 Moon 原创品牌源图：主题蓝底板和白色实心月牙。`src-tauri/icons/` 保存通过官方 `pnpm tauri icon public/moon.svg` 生成的桌面资源；网页、标题栏、任务栏与托盘共用这一标识。应用内操作图标继续使用 Lucide。当前仅保留桌面所需输出。

本地 `.agents/`、`AGENTS.md` 和 `.dev/` 不提交；本轮跟踪保存在 `.dev/backend-implement/task.md` 与 `.dev/needskill/task.md`。`.git/` 是版本元数据。`node_modules/` 是安装依赖，`dist/`、`src-tauri/target/`、`src-tauri/gen/schemas/` 是构建产物或生成缓存，不作为源码维护。

## 字体资源

全站统一使用本地思源黑体（Source Han Sans SC），通过 `src/index.css` 的 `@font-face` 加载，首页、组件库和预览入口共用同一文件。字体不依赖在线 CDN 或本机安装；正文与代码展示都使用该字体。

- 文件：`public/fonts/source-han-sans/SourceHanSansSC-VF.woff2`（14,129,688 字节）。
- 来源：[Adobe Source Han Sans 2.005](https://github.com/adobe-fonts/source-han-sans/releases/tag/2.005R)，仓库提交 `a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2` 的 `Variable/WOFF2/TTF/SourceHanSansSC-VF.ttf.woff2`，仅重命名，未裁剪或修改字体。
- SHA-256：`cfec773cdc2ea964de8713471c6fd20774bc40617f5567f92efeeccaca6604b0`。
- 许可证：同目录 `LICENSE.txt`（SIL Open Font License 1.1）。更新时同时核对来源、字重轴、许可证与校验值。

模型接口字段修改后执行 `pnpm contract:generate` 同步前端类型；`pnpm contract:check` 检查契约漂移（构建前也会检查）。接口字段、约束与取消规则可在 `/api-catalog/` 查看。

### 统一运行实例

桌面是模型服务的唯一宿主。主窗口显示和最小化时出现在任务栏；关闭按钮隐藏到系统托盘，左击托盘图标或菜单“打开 Moon”恢复同一窗口，菜单“退出 Moon”才停止桌面和后端。重复启动恢复已有实例，不启动第二个后端。Windows 开发版和发布版均不创建额外控制台；在终端主动运行开发命令时，原终端仍属于开发工具。先运行 `pnpm tauri dev`，浏览器访问同一个5173服务即可复用；单独运行 `pnpm dev` 只提供前端与代理，无桌面宿主时显示“请先启动 Moon”。服务在数据目录发布 `runtime.json`（仅本机，含临时令牌），退出清理；目录运行锁拒绝第二个模型服务。修改backend源码后必须重启Moon，接口会检测版本不一致并明确提示。窗口重新聚焦会重新读取连接，保留输入草稿。

自定义请求头始终展开。已保存API密钥的显示/复制通过只读 `revealKey` 获取，列表不返回原文；不提供OAuth令牌和环境变量原文查看。
