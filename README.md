# Moon

本地 agent 桌面应用。目前已实现使用模拟数据的首页前端，尚未接入 agent 后端。

技术栈：React + TypeScript + Vite + shadcn/ui + Tauri 2，使用 pnpm。

首页提供按目录分组的会话、搜索、工作目录选择、需求输入、模拟附件/Skill、模型与思考选项和会话配置。发送仅显示模拟提交结果；新建会话重置当前草稿；其他页面入口给出范围提示。草稿与模拟选择仅保存在内存中，刷新后重置。可从侧栏底部切换外观（也支持按 `d` 切换深浅主题）。尚未接入模型、对话存储或工具执行；无需配置 API Key、数据库或单独的后端服务。

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

## 构建与预览

```powershell
pnpm build
pnpm preview --host 127.0.0.1 --port 4173 --strictPort
```

`pnpm build` 先执行 TypeScript 项目构建检查，再生成 `dist/`。预览地址为 [http://127.0.0.1:4173](http://127.0.0.1:4173)，仅用于本地检查前端产物，不是生产服务。

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

本次 README 核对实际执行了依赖安装、前端 build/lint、Rust 格式检查，以及开发服务和生产产物预览的 HTTP 访问检查。已通过 pnpm tauri dev 编译并启动 Windows 原生窗口，验证首页显示、输入与模拟发送、模型选择、会话配置弹窗及搜索；未验证安装包构建。

## 目录与职责

```text
.
├── public/                     # 原样提供的静态资源；moon.png 是图标源文件和网页图标
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
├── index.html                 # Vite HTML 入口、页面标题和网页图标
├── components.json            # shadcn 风格、组件路径和别名配置
├── vite.config.ts             # React/Tailwind 插件及 @ → src 路径别名
├── tsconfig*.json             # TypeScript 项目及前端/构建配置检查范围
├── eslint.config.js           # ESLint 检查规则
├── .prettierrc                # Prettier 格式化配置
├── .prettierignore            # 格式化排除项
├── package.json               # 前端依赖和开发命令
├── pnpm-lock.yaml             # 前端依赖锁文件
└── pnpm-workspace.yaml        # pnpm 安装配置；当前没有子工作区包
```

从现有调用关系看，React 负责页面，Rust 负责桌面运行入口，两者通过 Tauri 的开发地址和构建产物配置连接。修改页面从 `src/App.tsx` 开始；基础控件位于 `src/components/ui/`，通用组合组件位于 `src/components/`。原生能力在 `src-tauri/src/` 实现，所需权限在 `capabilities/` 配置。首页代码位于 `src/features/home/`：home-page 负责布局，home-sidebar 负责导航，home-composer 负责输入与提交，mock-data 集中维护演示数据；拆分使首页状态和模拟数据不散落到应用入口或公共组件中。

`public/moon.png` 保留图标源文件，`src-tauri/icons/` 保存平台输出，便于用 `pnpm tauri icon public/moon.png` 重新生成。该命令也会生成移动端图标，当前仅保留桌面所需资源。

本地 `.agents/`、`AGENTS.md` 和 `.dev/` 不提交；`.dev/readme-maintainer/task.md` 是 README 维护记录。`.git/` 是版本元数据。`node_modules/` 是安装依赖，`dist/`、`src-tauri/target/`、`src-tauri/gen/schemas/` 是构建产物或生成缓存，不作为源码维护。
