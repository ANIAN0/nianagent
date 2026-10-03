# Moon

本地 agent 桌面应用。工作区、会话列表、模型与会话配置已接入本地持久化；文本多轮对话通过 Pi SDK 使用用户选择的模型，支持真实生成与工具执行。所有后端能力共用由 Tauri 启动的唯一 Node 宿主。

技术栈：React + TypeScript + Vite + shadcn/ui + Tauri 2，使用 pnpm。

首页沿用 agenttool 原型的布局与蓝色主题，提供工作目录选择、需求输入、模型与思考两级选择，以及工具和项目指令配置。桌面侧栏默认 280px，可拖动至 240–360px，收起后保留 56px 图标列；`Ctrl+B` 切换侧栏，`Ctrl+K` 搜索会话。侧栏底部可打开模型设置和切换外观（也支持按 `d` 切换深浅主题）。插件和定时任务入口尚未实现。

## 工作区与会话

1. 在首页工作目录菜单选择已有工作区，或点击“添加工作区…”直接打开 Windows 系统目录选择器。取消不添加目录；相同真实路径复用已有工作区，工作区及最后选择保存在本地。目录被移动或不可访问时保留记录并提示原因，不自动创建替代目录。
2. 在模型设置中添加可用连接，回到首页选择模型与支持的思考强度；通过“会话配置”选择 Pi 工具和项目指令范围。填写文本后发送，成功接收的消息进入正式会话。
3. 左侧按工作区分组显示真实会话，按更新时间排列，显示运行中、停止中及未读结果。搜索支持标题、完整工作目录和最近消息摘要。打开会话读取实际历史；读取失败可重试，刷新失败保留已有列表。
4. 在同一会话继续发送文本，Pi 使用已有消息和工具结果构造下一轮上下文。生成期间可提前编辑下一条消息，回复结束后发送；“停止执行”中止当前生成，保留已生成内容和已完成工具结果。已经接受并写入用户消息的失败或中断请求可用“继续上次回复”；消息未接受时保留原草稿，提示修正模型后重新发送，从侧栏打开失败会话也可恢复本窗口的文字。停止不会撤销已经完成的文件或命令操作。

消息、思考和工具调用结果由真实 Pi 事件更新，正文支持 Markdown 与代码。Pi 官方 `SessionManager` 将历史保存为 JSONL，Moon 单独保存列表摘要和未读状态；刷新或重启后仍能读取历史。应用异常退出留下的运行记录会标记中断失败，不自动重新执行请求。会话使用创建时的工作目录，切换目录需要新建会话。

查看历史通过 Pi 内存恢复，不会修复或改写文件；空文件、损坏内容或不匹配的文件头明确报错并保留原文件。合法旧格式只在开始真实发送时由 Pi 迁移。Windows 宿主会向 Pi 追加实际工作目录及工具路径说明；项目指令选择“不加载”仍保留这份运行环境说明，文件工具优先使用工作区相对路径。

输入卡上方显示当前回复、工具执行、自动重试等待或上下文压缩阶段；重试次数和等待时间来自 Pi。展开 Bash 或 PowerShell 工具结果可查看实际退出码与耗时，旧记录缺少数据时显示未提供。上下文用量注明 Pi 估算、观察时间及是否来自历史记录；压缩后尚无统计时保持未知。压缩失败单独提醒并保留已生成内容。

侧栏的“回复结束”只表示本轮生成已经结束；工具执行失败会在工具结果中保留。任务是否达成需要检查实际文件、命令结果和产物，不能用会话状态代替验收。

当前正式入口提供文本基础多轮对话，不接入附件上传、Skill 材料、消息排队或分步问答。未发送草稿和阅读位置由当前窗口维护，不承诺刷新后恢复；已发送历史和已应用配置持久化。右侧执行概览、多 agent 管理和文件差异工作区尚未实现。

`/ui-catalog/` 保留模拟流式、队列、问答、附件等独立展示，使用演示数据和服务替身，不向真实模型发起请求。展示状态不代表这些能力已接入正式入口。

## 模型设置

侧栏底部“本地用户 → 设置”进入正式模型配置。连接支持搜索、分页、添加、编辑和删除；配置保存在本机，刷新和重启后保留。每次保存检查 revision，旧窗口不能覆盖更新。删除连接同步移除其模型和凭据；已有会话不会自动切换到其他模型。

API 连接支持保存密钥、后端环境变量及无凭据。密钥默认遮蔽，可通过输入框右侧按钮显示、隐藏和复制；清除密钥后连接仍可保存，但会标记不可用。环境变量变更后需要重启后端进程。自定义请求头仅接受字面值，不支持命令、变量表达式及认证头。Windows 默认文件为 `%LOCALAPPDATA%/Moon/models/models.json`，含敏感信息，仅供当前用户本地使用，不是加密保险库。

“测试连接”读取 OpenAI 兼容或 Anthropic 模型目录，不保存候选，也不等于推理成功。未知上下文、输出和思考能力显示待补全；补全后才能保存。模型行的“检查”经 Pi 发起真实短推理，可能产生费用。发现与检查可取消并保留草稿，修改模型配置后旧检查结果失效。首页与会话的思考等级来自 Pi 能力；不支持思考的模型不显示强度入口。订阅连接从 Pi 支持的提供者中选择，授权窗口显示 Pi 实际 URL、设备码和输入步骤；退出、取消及 token 刷新沿用 Pi 机制。

组件库仍使用明确的服务替身和演示数据，不写正式配置。真实第三方授权需要用户账号，真实在线推理需要有效凭据；本地兼容服务不强制要求密钥。

## 会话配置

首页与会话输入区的“会话配置”共用同一弹窗：工具来自 Pi 实际注册目录，缺少本地运行依赖的工具说明原因并禁止选择，不自动下载依赖。项目指令支持全局与目录、仅目录、不加载三档；可查看文件路径及正文。全局指令位于 `%LOCALAPPDATA%/Moon/models/agent/`，目录指令按 Pi 的祖先目录与文件优先规则发现。

打开弹窗建立候选；取消、关闭或 Esc 不保存，应用成功后才更新生效值。应用期间保持保存画面，鼠标导航与Ctrl+K/Ctrl+B等待保存结果；成功关闭后入口显示“配置已应用”，失败保留候选和具体错误。读取失败可重读，旧版本不能覆盖其他窗口的更新。已应用指令保存快照；弹窗展示本次磁盘候选，并提示与已保存快照的差异；文件变化后需明确点击应用才更新。

配置按稳定会话 ID 保存在 `%LOCALAPPDATA%/Moon/models/session-config/sessions.json`，真实 Pi AgentSession 的活动工具与指令来源用于核对生效状态。首页选项随该工作目录的待发送草稿恢复，新建对话沿用该配置 ID。配置操作本身不发起推理；发送消息后由 Pi 使用所选模型和已启用工具执行。已有对话更新配置时保留原 AgentSession 和 JSONL 历史；生成或停止期间禁止修改配置。实际目录不存在时明确报错，不创建示例目录。

## MCP 服务

“设置 → MCP 服务”可添加本地 stdio 程序或 Streamable HTTP 服务。可执行文件与参数分开填写，参数每行一项；请求头和环境变量直接展示，支持 `${ENV_NAME}` 从 Moon 宿主环境读取。连接测试就在参数之后，真实发现工具后保存，再到首页或会话的“会话配置”中选择工具。默认按需组合调用，亦可选择搜索后调用、直接提供或隐藏；未选择的工具不能通过其他入口调用。

配置保存在 `%LOCALAPPDATA%/Moon/models/agent/mcp.json`，包含敏感环境及请求头，请仅放在个人目录。最近验证目录与时间随对应配置保存，测试结束即关闭测试连接；目录页把这个结果和真实会话的当前连接分开展示。保存、启停或删除在当前轮结束后的下一次发送或应用配置时生效。正在执行的工作不被隐藏重载打断。服务缺少授权时展示原因，本阶段可填写请求头或环境凭据，不提供 MCP OAuth 账号管理。

MCP 会话沿用 Pi 原生扩展；直接及 codemode 内部调用显示实际工具来源、输入、结果和状态，重启可恢复。工具成功不等于任务验收成功；停止或删除服务不会撤销已经完成的外部操作。组件库的 MCP 设置、列表、编辑、连接字段、变量字段和测试结果使用服务替身；浏览演示不启动生产服务器。接口目录新增“MCP 服务”分组，四个操作为 `mcpList`、`mcpSave`、`mcpRemove`、`mcpTest`，均通过正式宿主调用。

## Pi SDK

已安装官方 `@earendil-works/pi-coding-agent` 1.0.0，SDK 包含在该包中。按[官方 SDK 文档](https://pi.dev/docs/latest/sdk)使用 Node.js/Bun 进程内集成；本项目使用 pnpm，安装命令为：

```powershell
pnpm add --save-exact --ignore-scripts --registry=https://registry.npmjs.org @earendil-works/pi-coding-agent@1.0.0
```

该版本要求 Node.js >=22.19.0。版本与依赖树由 `package.json` 和 `pnpm-lock.yaml` 固定，后续正常执行 `pnpm install` 即可恢复。[官方安装说明](https://pi.dev/docs/latest/quickstart)支持忽略依赖生命周期脚本。本次命令临时指定官方 npm registry，不修改全局镜像配置。

SDK 在 `backend/` 的 Node 子进程中运行，由 Tauri 唯一启动，通过 JSON 行 RPC 与桌面通信，同时提供带令牌的回环 HTTP 供开发浏览器代理连接；两种传输共用模型、工作区、会话配置、会话摘要和对话服务实例。桌面运行需在 PATH 中提供 Node.js >=22.19。当前未把 Node 可执行文件打包进安装程序。模块边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。

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

桌面启动握手只等待本地传输就绪；Pi 依赖在首次读取业务数据时加载，期间页面显示读取中。依赖慢加载不会因超过 30 秒而关闭桌面；若业务请求超时或初始化失败，可在页面重新读取，仍共用同一个宿主。

桌面开发固定使用 `http://localhost:5173`，Vite 绑定 `127.0.0.1:5173` 并启用严格端口检查。端口被占用时启动会失败，应先退出占用该端口的开发实例。关闭窗口会隐藏到托盘；退出应用使用托盘“退出 Moon”。结束整次开发（包括 Vite）使用原开发终端的 `Ctrl+C`。

### 仅调试前端

```powershell
pnpm dev --host 127.0.0.1 --port 5173 --strictPort
```

浏览器打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)，使用同一前端页面。真实功能需要已有 Moon 桌面宿主；浏览器本身不启动后端。“添加工作区”通过同一个宿主打开系统目录选择器，不使用网页输入目录弹窗。仅浏览组件库时无需后端。简写 `pnpm dev` 也可启动，但端口占用时可能自动选择其他端口，以终端输出为准。

### 接口目录

同一个 `pnpm dev` 服务提供 [接口目录](http://127.0.0.1:5173/api-catalog/)。目录按模型、工作区、会话列表、会话配置和对话模块展示正式 RPC 契约、字段约束、影响及例子。左侧搜索和定位，默认阅读当前接口文档；“打开调试面板”才加载参数编辑和响应查看，宽屏并列、窄屏纵向排列。窄屏通过导航按钮选择接口；模块标题打开对应架构章节。浏览文档或打开调试不会调用服务，执行按钮才发起真实调用。每个接口保留本页的参数草稿和结果；收起调试、切换或取消后，迟到响应不会覆盖新调用。JSON 与正式契约不符时禁用执行，Ctrl / ⌘ + Enter 可执行合法请求。目录外观仅保存在内存中。模型检查和对话会发起实际推理；对话可以执行已启用工具，保存、删除和授权会改变本地数据。原生窗口使用 Tauri 命令，浏览器通过 Vite 同源代理连接已运行的 Moon 宿主；Vite 不创建后端。

`pnpm test:backend` 运行正式回归测试，临时目录与本地协议服务在结束后清理。`pnpm backend:package` 用 pnpm deploy 生成独立后端生产依赖目录；`pnpm desktop:build` 发布构建会自动执行，使用生产配置携带后端资源。`src-tauri/runtime/` 为忽略的构建产物，不手工编辑。

### 组件库

运行同一个 `pnpm dev` 后，打开 [组件库](http://127.0.0.1:5173/ui-catalog/)；无需启动第二个服务。若 Vite 自动更换端口，使用终端显示的端口。

- 左侧按页面、复合组件和基础组件分组，可搜索中文名、源码组件名或状态。每个组件包含概览和独立状态画布。
- 概览列出职责、所有真实状态及预期行为，一次只运行展开的示例，预览随中栏宽度和内容高度调整；示例可重置，画布用于完整尺寸交互。右侧提供参数、事件、正式源码，以及从真实导入关系生成的可跳转组成和使用方。
- 根目录 [DESIGN.md](DESIGN.md) 维护生效的设计 token、主题映射、组件边界和视觉依据；组件库顶栏也可下载。
- 中间 iframe 直接渲染正式组件，可调整实际视口尺寸、切换主题、重置或独立打开。切换状态、主题或重置会重新创建预览；窄屏切换面板保留预览。
- 可直接访问 [首页预览](http://127.0.0.1:5173/ui-catalog/preview.html?component=home-page&state=default)。选择状态后的组件库 URL 可刷新或分享，保存组件、状态、查看方式、主题与画布宽高。尺寸输入在 Enter 或失焦时应用，非法值提示范围并保留原视口；Escape 恢复当前尺寸。
- 展示数据与提交替身位于 `ui-catalog/fixtures/`，预览主题仅存于内存，演示不会改变正式首页的数据或已保存的外观。

新增展示时，在正式组件旁添加一份 `*.catalog.tsx`，填写状态和文档并直接导入正式组件；Vite 的 `scripts/ui-catalog-plugin.ts` 从相邻定义静态提取文档与正式 JSX 导入关系，无需手工登记目录；元数据使用静态字面量或可解析的本地常量，交互代码放在 render。目录壳只读轻量索引，iframe 按需加载当前定义，源码展开才读取对应 raw 文件。目录控件及接口目录组件也在同一组件库中展示。

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

`pnpm build` 先检查契约生成结果及 TypeScript 项目，再由 `scripts/build-frontend.mjs` 使用 Vite 官方 API 分别构建主应用和开发目录，合并到 `dist/`。两图隔离可避免组件展示的动态入口把主应用共享代码拆成大量小文件；目录仍按需加载真实组件。构建自动生成分图及合并 manifest，支持 `pnpm build --manifest`。预览地址为 [http://127.0.0.1:4173](http://127.0.0.1:4173)，仅用于本地检查前端产物，不是生产服务；调用真实功能仍需已运行的 Moon 宿主。

组件库、iframe 和接口目录随同一次 `pnpm build` 发布，分别访问 [组件库](http://127.0.0.1:4173/ui-catalog/)、[预览入口](http://127.0.0.1:4173/ui-catalog/preview.html) 和 [接口目录](http://127.0.0.1:4173/api-catalog/)。它们共用 Vite 配置工厂、类型检查和最终 `dist/`；主应用资源在 `assets/`，目录资源在 `assets/catalogs/`，公共字体只复制一次。第二图保留主应用产物，同路径异内容会中止构建；重复构建先清掉旧产物。开发仍使用一个 `pnpm dev` 服务。

桌面发布构建：

```powershell
pnpm desktop:build
```

Tauri 会先运行 `pnpm build`，再构建原生程序与平台安装包，默认输出在 `src-tauri/target/release/` 和其中的 `bundle/`。当前应用标识为 `local.moon.desktop`，没有配置发布签名；安装包构建尚未验证。

## 检查

```powershell
pnpm build
pnpm lint
node --test scripts/tests/*.test.mjs ui-catalog/tests/*.test.mjs
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

后端自动化回归运行 `pnpm test:backend`。`pnpm typecheck` 虽然存在，但根 tsconfig 主要通过 references 引用子项目，完整 TypeScript 检查应使用 `pnpm build`。

`pnpm format` 会直接改写 TypeScript/TSX 文件，需要格式化时再执行。

原生首页此前已通过 `pnpm tauri dev` 验证；安装包构建尚未验证。前端改动在实现完成后统一检查正式页面、组件库和生产预览。

## 目录与职责

```text
.
├── public/                     # 原样提供的静态资源；moon.svg 是原创品牌源图；fonts/ 保存本地思源黑体
├── src/                        # React 前端
│   ├── main.tsx                # 挂载 React，装配主题 Provider，加载全局样式
│   ├── App.tsx                 # 首页/对话/模型设置导航，组合会话状态与页面
│   ├── index.css               # Tailwind 入口、主题变量与全局样式
│   ├── components/            # 可复用界面组件；包含主题 Provider
│   │   └── ui/                # shadcn 官方 CLI 生成的基础组件
│   ├── features/home/         # 共享应用布局、侧栏、会话搜索与首页输入卡
│   ├── features/workspaces/   # 工作区服务适配、目录列表与选择状态
│   ├── features/models/       # 模型连接目录、连接/模型草稿、授权流程、正式服务适配与组件库替身
│   ├── features/session/      # 会话配置服务适配、稳定草稿标识与组件库注入边界
│   ├── features/conversation/ # 真实对话/列表服务和状态、页面/阅读/导航；模拟驱动仅供展示
│   │   ├── messages/          # 用户/Agent消息、Markdown、附件、执行过程和工具详情
│   │   └── composer/          # 对话输入、发送/停止和上下文用量；队列/问答保留为展示组件
│   └── lib/                   # 共享工具，目前通过 utils.ts 导出 cn
├── backend/                    # 模型/工作区/会话目录/Pi对话/配置、CredentialStore 与唯一 Node 宿主
│   └── tests/                 # 正式后端回归与隔离协议测试
├── scripts/                    # 契约生成、后端打包、Vite目录索引插件及目录架构回归
├── api-catalog/                # 引导/页面、按需契约读取、请求生命周期与模块化UI
│   └── components/             # 导航、契约、字段、请求、结果、架构与复制控件；含相邻展示
├── src-tauri/                  # Tauri 原生端及打包配置
│   ├── src/                   # main.rs 调用 lib.rs；window_lifecycle.rs 管理托盘和窗口
│   ├── capabilities/          # 窗口可用的原生权限，目前只有 core:default
│   ├── icons/                 # Tauri CLI 生成的桌面平台图标
│   ├── Cargo.toml             # Rust 依赖、crate 信息和最低 Rust 版本
│   ├── Cargo.lock             # Rust 依赖锁文件
│   ├── build.rs               # 调用 Tauri 构建辅助逻辑
│   └── tauri.conf.json        # 应用标识、窗口、开发地址和打包设置
├── ui-catalog/                 # 引导/页面、URL控制、布局/导航/文档控件、懒加载与iframe
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

React 负责页面和编辑草稿，Rust 负责桌面入口、系统目录选择与 Node 宿主生命周期。修改页面从 `src/App.tsx` 开始；首页代码在 `src/features/home/`，工作区数据访问在 `features/workspaces/`。正式对话通过 `features/conversation/use-live-conversation.ts` 管理服务快照与独立草稿，`conversation-catalog-service.ts` 管理会话列表及已读同步。`use-conversations.ts` 和 `mock-conversations.ts` 仅供组件库演示；消息组件本身通过参数接收数据，不直接调用后端。滚动使用官方 MessageScroller，Markdown 使用 react-markdown 与 remark-gfm，不启用原始 HTML。

后端按数据所有权分工：`workspaces.mjs` 管理目录记录和选择，`conversation-store.mjs` 保存列表摘要，`conversations.mjs` 驱动 Pi 并读取官方 JSONL 正文，`sessions.mjs` 管理工具及指令配置。它们共用一个宿主和同一份会话标识，摘要服务不另存消息副本。默认数据目录 `%LOCALAPPDATA%/Moon/models/` 中，`workspaces.json` 保存工作区，`conversations/index.json` 保存摘要，`conversations/pi/` 保存 Pi JSONL；这些文件不在仓库内。

`public/moon.svg` 是 Moon 原创品牌源图：主题蓝底板和白色实心月牙。`src-tauri/icons/` 保存通过官方 `pnpm tauri icon public/moon.svg` 生成的桌面资源；网页、标题栏、任务栏与托盘共用这一标识。应用内操作图标继续使用 Lucide。当前仅保留桌面所需输出。

本地 `.agents/`、`AGENTS.md` 和 `.dev/` 不提交；本轮跟踪保存在 `.dev/backend-implement/task.md` 与 `.dev/needskill/task.md`。`.git/` 是版本元数据。`node_modules/` 是安装依赖，`dist/`、`src-tauri/target/`、`src-tauri/gen/schemas/` 是构建产物或生成缓存，不作为源码维护。

## 字体资源

全站统一使用本地思源黑体（Source Han Sans SC），通过 `src/index.css` 的 `@font-face` 加载，首页、组件库和预览入口共用同一文件。字体不依赖在线 CDN 或本机安装；正文与代码展示都使用该字体。

- 文件：`public/fonts/source-han-sans/SourceHanSansSC-VF.woff2`（14,129,688 字节）。
- 来源：[Adobe Source Han Sans 2.005](https://github.com/adobe-fonts/source-han-sans/releases/tag/2.005R)，仓库提交 `a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2` 的 `Variable/WOFF2/TTF/SourceHanSansSC-VF.ttf.woff2`，仅重命名，未裁剪或修改字体。
- SHA-256：`cfec773cdc2ea964de8713471c6fd20774bc40617f5567f92efeeccaca6604b0`。
- 许可证：同目录 `LICENSE.txt`（SIL Open Font License 1.1）。更新时同时核对来源、字重轴、许可证与校验值。

接口字段修改后执行 `pnpm contract:generate` 同步前端类型；`pnpm contract:check` 检查契约漂移（构建前也会检查）。接口字段、约束与取消规则可在 `/api-catalog/` 查看。

### 统一运行实例

桌面是全部后端功能的唯一宿主。主窗口显示和最小化时出现在任务栏；关闭按钮隐藏到系统托盘，左击托盘图标或菜单“打开 Moon”恢复同一窗口，菜单“退出 Moon”才停止桌面和后端。重复启动恢复已有实例，不启动第二个后端。Windows 开发版和发布版均不创建额外控制台；在终端主动运行开发命令时，原终端仍属于开发工具。先运行 `pnpm tauri dev`，浏览器访问同一个 5173 服务即可复用；单独运行 `pnpm dev` 只提供前端与代理，无桌面宿主时提示先启动 Moon。服务在数据目录发布 `runtime.json`（仅本机，含临时令牌），退出清理；目录运行锁拒绝第二个后端实例。修改 backend 源码后必须重启 Moon，接口会检测版本不一致并明确提示。窗口重新聚焦会重新读取连接，保留输入草稿。

自定义请求头始终展开。已保存API密钥的显示/复制通过只读 `revealKey` 获取，列表不返回原文；不提供OAuth令牌和环境变量原文查看。
