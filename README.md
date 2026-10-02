# Moon

本地 agent 桌面应用。目前已实现使用模拟数据的首页前端，尚未接入 agent 后端。

技术栈：React + TypeScript + Vite + shadcn/ui + Tauri 2，使用 pnpm。

首页沿用 agenttool 原型的布局与蓝色主题，提供按目录分组的会话、弹窗搜索、工作目录选择、需求输入、模拟附件/Skill、模型与思考两级选择，以及工具和项目指令配置。桌面侧栏默认 280px，可拖动至 240–360px，收起后保留 56px 图标列；`Ctrl+B` 切换侧栏，`Ctrl+K` 搜索会话。发送仅显示模拟提交结果；新建会话重置当前草稿；其他页面入口给出范围提示。草稿与模拟选择仅保存在内存中，刷新后重置。可从侧栏底部切换外观（也支持按 `d` 切换深浅主题）。尚未接入模型、对话存储或工具执行；无需配置 API Key、数据库或单独的后端服务。

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

桌面开发固定使用 `http://localhost:5173`，Vite 绑定 `127.0.0.1:5173` 并启用严格端口检查。端口被占用时启动会失败，应先退出占用该端口的开发实例。退出本次开发使用终端的 `Ctrl+C`。

### 仅调试前端

```powershell
pnpm dev --host 127.0.0.1 --port 5173 --strictPort
```

浏览器打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)，应看到同一首页。浏览器模式不提供 Tauri 原生能力。简写 `pnpm dev` 也可启动，但端口占用时可能自动选择其他端口，以终端输出为准。

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

- `HomeComposer` 持有唯一草稿和提交校验，组合 `WorkspacePicker`、`PromptInput`、`SelectedMaterials` 和 `ComposerToolbar`；工具栏再组合 `MaterialPicker`、`ModelPicker`、`SessionConfig` 与 `SendControl`。选择值通过参数传入，变更通过回调返回；`ModelPicker` 组合模型选项与 `ThinkingPicker`，统一两级选择入口。`SessionConfig` 组合 `ToolPicker` 和 `InstructionScopePicker`，内部暂存候选值，只有“应用”才更新草稿，“取消”丢弃本轮修改。
- `HomeSidebar` 组合 `PrimaryNavigation`、`ConversationHistory` 和 `UserMenu`；`ConversationHistory` 管理组折叠，并复用受控的 `ConversationGroup`，分组调用 `ConversationItem`；`SelectedMaterials` 则调用独立的 `MaterialChip`。外观仍由 `ThemeProvider` 管理。
- `HomePage` 负责桌面/移动布局、导航显隐与宽度、新建重置和页面提示；`ConversationSearch` 负责搜索弹窗及查询。基础控件沿用 `src/components/ui/` 的 shadcn 实现。

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
pnpm tauri build
```

Tauri 会先运行 `pnpm build`，再构建原生程序与平台安装包，默认输出在 `src-tauri/target/release/` 和其中的 `bundle/`。当前应用标识为 `local.moon.desktop`，没有配置发布签名；安装包构建尚未验证。

## 检查

```powershell
pnpm build
pnpm lint
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

目前没有自动化测试套件或 `test` 脚本。`pnpm typecheck` 虽然存在，但根 tsconfig 主要通过 references 引用子项目，完整 TypeScript 检查应使用 `pnpm build`。

`pnpm format` 会直接改写 TypeScript/TSX 文件，需要格式化时再执行。

原生首页此前已通过 `pnpm tauri dev` 验证；安装包构建尚未验证。前端改动在实现完成后统一检查正式页面、组件库和生产预览。

## 目录与职责

```text
.
├── public/                     # 原样提供的静态资源；moon.svg 是 Lucide 图标源文件；fonts/ 保存本地思源黑体
├── src/                        # React 前端
│   ├── main.tsx                # 挂载 React，装配主题 Provider，加载全局样式
│   ├── App.tsx                 # 应用入口，挂载首页
│   ├── index.css               # Tailwind 入口、主题变量与全局样式
│   ├── components/            # 可复用界面组件；包含主题 Provider
│   │   └── ui/                # shadcn 官方 CLI 生成的基础组件
│   ├── features/home/         # 首页布局、侧栏、输入卡和独立模拟数据
│   └── lib/                   # 共享工具，目前通过 utils.ts 导出 cn
├── src-tauri/                  # Tauri 原生端及打包配置
│   ├── src/                   # main.rs 调用 lib.rs；lib.rs 装配 Tauri 和开发日志
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
└── pnpm-workspace.yaml        # pnpm 安装配置；当前没有子工作区包
```

从现有调用关系看，React 负责页面，Rust 负责桌面运行入口，两者通过 Tauri 的开发地址和构建产物配置连接。修改页面从 `src/App.tsx` 开始；基础控件位于 `src/components/ui/`，通用组合组件位于 `src/components/`。原生能力在 `src-tauri/src/` 实现，所需权限在 `capabilities/` 配置。首页代码位于 `src/features/home/`：home-page 负责布局，home-sidebar 负责导航，home-composer 负责输入与提交，mock-data 集中维护演示数据；拆分使首页状态和模拟数据不散落到应用入口或公共组件中。

`public/moon.svg` 从 `lucide-react` 的 Moon 导出，`src-tauri/icons/` 保存平台输出，便于用 `pnpm tauri icon public/moon.svg` 重新生成。图标许可见 `public/lucide-LICENSE.txt`。该命令也会生成移动端图标，当前仅保留桌面所需资源。

本地 `.agents/`、`AGENTS.md` 和 `.dev/` 不提交；`.dev/readme-maintainer/task.md` 是 README 维护记录。`.git/` 是版本元数据。`node_modules/` 是安装依赖，`dist/`、`src-tauri/target/`、`src-tauri/gen/schemas/` 是构建产物或生成缓存，不作为源码维护。

## 字体资源

全站统一使用本地思源黑体（Source Han Sans SC），通过 `src/index.css` 的 `@font-face` 加载，首页、组件库和预览入口共用同一文件。字体不依赖在线 CDN 或本机安装；正文与代码展示都使用该字体。

- 文件：`public/fonts/source-han-sans/SourceHanSansSC-VF.woff2`（14,129,688 字节）。
- 来源：[Adobe Source Han Sans 2.005](https://github.com/adobe-fonts/source-han-sans/releases/tag/2.005R)，仓库提交 `a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2` 的 `Variable/WOFF2/TTF/SourceHanSansSC-VF.ttf.woff2`，仅重命名，未裁剪或修改字体。
- SHA-256：`cfec773cdc2ea964de8713471c6fd20774bc40617f5567f92efeeccaca6604b0`。
- 许可证：同目录 `LICENSE.txt`（SIL Open Font License 1.1）。更新时同时核对来源、字重轴、许可证与校验值。
