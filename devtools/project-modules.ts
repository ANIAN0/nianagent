/** Code responsibilities are explicit; directory and module views resolve the same file records. */
export const codeModules = [
  {
    id: "conversation",
    title: "会话与 Agent 执行",
    task: "发送消息、阅读进展、停止或恢复回复",
    description:
      "界面持有会话草稿与阅读位置，宿主持有历史和运行事实。发送与下一稿分开，结果未知沿原请求核对；Pi 适配层负责模型与工具执行。",
    boundary: "页面不直接读写会话文件，不用预览状态代替宿主结果。",
    prefixes: [
      "src/features/conversation/",
      "backend/conversation",
      "backend/conversations.mjs",
      "backend/pi-session-adapter.mjs",
      "backend/pi-history.mjs",
      "backend/pi-resource-scope.mjs",
      "backend/live-projection-cache.mjs",
      "backend/command-receipt.mjs",
      "backend/queue-",
    ],
    entry: "src/features/conversation/live-conversation-view.tsx",
  },
  {
    id: "home",
    title: "工作台与工作区",
    task: "从工作目录开始一次新会话，浏览已有会话",
    description:
      "工作台组合导航、工作区选择、会话列表和首条输入。工作区登记负责目录身份与可用性，首条消息交付后进入会话所有者。",
    boundary: "导航选择不负责推理执行；工作区登记不扫描项目内容。",
    prefixes: [
      "src/features/home/",
      "src/features/workspaces/",
      "backend/workspace",
    ],
    entry: "src/features/home/app-shell.tsx",
  },
  {
    id: "composer",
    title: "输入、材料与草稿",
    task: "复用正文输入、文件图片选择与草稿恢复",
    description:
      "首页与会话共享输入语义、候选菜单与材料展示。材料准备和上传通过独立服务完成；草稿所有权与发送身份由各页面明确持有。",
    boundary: "材料就绪不代表消息已发送，输入组件不直接执行 Agent。",
    prefixes: [
      "src/components/composer/",
      "src/lib/composer/",
      "src/features/materials/",
      "backend/material",
    ],
    entry: "src/components/composer/prompt-input.tsx",
  },
  {
    id: "models",
    title: "模型与凭据",
    task: "配置连接、选择模型、处理授权与模型检查",
    description:
      "管理连接配置、模型目录、推理参数和订阅授权。界面通过正式契约保存配置，宿主保护凭据并提供模型能力事实。",
    boundary: "模型目录发现、凭据保存与实际会话执行是独立操作。",
    prefixes: [
      "src/features/models/",
      "backend/model",
      "backend/oauth",
      "backend/store.mjs",
      "backend/authorization-identity.mjs",
    ],
    entry: "src/features/models/model-settings-page.tsx",
  },
  {
    id: "session",
    title: "会话配置与 MCP",
    task: "查看工具和项目指令，连接 MCP 服务",
    description:
      "配置工具选择、项目指令、权限和 MCP 连接。显式测试更新工具目录，配置写入沿原操作回执确认后生效。",
    boundary: "连接测试不等于调用业务工具；候选配置不冒充当前已应用配置。",
    prefixes: [
      "src/features/session/",
      "src/features/mcp/",
      "backend/sessions.mjs",
      "backend/session-core.mjs",
      "backend/mcp",
      "backend/permission",
    ],
    entry: "src/features/session/session-service.ts",
  },
  {
    id: "plugins",
    title: "插件与扩展",
    task: "管理插件启停，装配网页贡献与 Pi 扩展",
    description:
      "核心管理插件发现、配置和公共容器；插件按 host、pi、web 入口提供具体能力。正式开发规范说明允许的入口与生命周期。",
    boundary: "运行适配与网页布局分开，规范与当前实现状态分别表达。",
    prefixes: [
      "src/features/plugins/",
      "src/features/extensions/",
      "backend/plugins/",
      "backend/plugin",
      "backend/activity-log",
      "backend/extension",
      "backend/extensions",
      "backend/workbench-pi.test.mjs",
    ],
    entry: "src/features/plugins/plugin-settings.tsx",
  },
  {
    id: "startup",
    title: "启动、设置与桌面",
    task: "首次启动、数据迁移、应用设置和更新",
    description:
      "启动阶段确认宿主与数据目录，再挂载工作台。桌面层持有进程、窗口、系统选择器和迁移更新；设置界面只协调各功能入口和离开守卫。",
    boundary: "网页预览不证明 Tauri 原生行为完成，开发期间只运行 dev。",
    prefixes: [
      "src/features/startup/",
      "src/features/settings/",
      "src-tauri/",
      "public/startup",
      "backend/startup",
      "backend/boot",
      "backend/desktop-",
      "backend/migration-",
    ],
    entry: "src/features/settings/settings-page.tsx",
  },
  {
    id: "ui",
    title: "共享界面基础",
    task: "复用基础组件、主题、反馈与通用行为",
    description:
      "共享视觉变体、弹层、表单和操作反馈在同一正式组件中维护。功能组件直接组合这些能力，按受影响使用方核对变化。",
    boundary: "业务状态留在所属功能；公共设计规则来自本地 DESIGN.md。",
    prefixes: ["src/components/", "src/lib/utils", "src/index.css"],
    entry: "src/components/ui/button.tsx",
  },
  {
    id: "transport",
    title: "通信、存储与操作恢复",
    task: "追踪前后端调用、持久化和未知结果恢复",
    description:
      "前端服务使用共享 RPC 操作类型，传输层连接本机或远程宿主（含 Tauri 目录/文件反向 RPC 桥）。宿主统一注册业务服务；原操作恢复、维护冻结与存储能力为各功能提供边界。",
    boundary: "传输不重写业务契约，未知写入结果不自动重放。",
    prefixes: ["src/lib/", "src/contracts/", "backend/"],
    entry: "backend/service-registry.mjs",
  },
  {
    id: "app",
    title: "应用装配与入口",
    task: "挂载根组件、组合全局 Provider 与协调页面入口",
    description:
      "前端唯一组合根，负责挂载 React 根、错误边界与启动入口分发，并将各业务功能、插件与基础能力装配在一起。",
    boundary: "只做组合装配与入口分发，不作为其他业务或基础模块的被依赖方。",
    prefixes: [
      "src/App.tsx",
      "src/app-entry.tsx",
      "src/app-providers.tsx",
      "src/app-root.tsx",
      "src/main.tsx",
      "src/use-app-navigation.ts",
    ],
    entry: "src/app-root.tsx",
  },
  {
    id: "toolchain",
    title: "构建与工具链",
    task: "检查、生成契约和构建应用",
    description:
      "脚本负责正式契约生成、静态检查、构建与发行。根配置保留各工具可发现的标准位置。",
    boundary:
      "开发工具不作为业务状态所有者；构建产物和内部记录不进入源码资料。",
    prefixes: [""],
    entry: "package.json",
  },
] as const
export type CodeModule = (typeof codeModules)[number]
export function codeModuleFor(path: string): CodeModule {
  return codeModules
    .flatMap((module) => module.prefixes.map((prefix) => ({ module, prefix })))
    .filter(({ prefix }) => path.startsWith(prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]!.module
}
