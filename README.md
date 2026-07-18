# nianagent

`nianagent` 是面向 Windows 本地运行的 Eve + Next.js Agent 应用。

它的目标不是复刻 Vercel 或 Hugging Face 的部署环境，而是在用户自己的 Windows
机器上提供一个长期运行的本地服务，让不同会话分别操作用户选择的本地项目目录。

## 当前状态

当前应用包含两个通过 Eve 多 Agent 机制独立运行的 Agent：

- 知识库管理员：`agents/knowledge-base/`
- 工作助手：`agents/work-assistant/`

Next.js 将它们分别挂载到 `/eve/agents/knowledge-base/eve/v1/*` 和
`/eve/agents/work-assistant/eve/v1/*`。两者有各自的 Agent 配置、指令、频道和会话，互不
作为子 Agent 调用。

本地多目录会话 binding（Turso）、host-workspace 工具边界、聊天刷新恢复与 Workflow 调试页已接入（见下文）。

## 核心定位

- 同一个本地服务可以同时承载多个 Eve session。
- 每个 session 在创建前选择并绑定一个或多个本地项目目录（不可重叠/父子）。
- 不同 session 可以绑定不同目录集合，并保持各自独立的工作区状态。
- 目录一旦绑定，在该 session 生命周期内不可变；切换目录须「新会话」。
- 工具使用逻辑路径 `/workspace/<alias>/...`，由 host-workspace backend 映射到绑定根。
- 浏览器只连接本机 Next.js；capability 仅存于当前标签 `sessionStorage`；库中仅存 digest。
- Workflow 调试经 Agent-owned bridge（`getWorld()` 同一 World），Next 仅同源代理。

```text
Windows 本地服务
├─ session A → H:\project-a
├─ session B → D:\workspace\project-b
└─ session C → H:\project-c
```

## 运行时边界

### 本地目录

目录选择属于 session 创建流程，而不是每个请求或每个 turn 都重新传递的参数。服务端
必须解析并校验目录的规范绝对路径，并保证一个 session 只能访问自己绑定的项目目录。

具体的目录选择协议和 sandbox backend 仍需单独设计；不得把浏览器提交的任意路径未经
校验地交给文件或命令执行工具。

### Sandbox 与工具边界

`nianagent` 使用 **host-workspace** 自定义 `SandboxBackend`：

- **双轨路径**：工具 path / powershell cwd 用逻辑路径 `/workspace/<alias>/...`（realpath/reparse containment）；会话 system 注入 **A1**（alias + displayPath，不含 canonical）；审批卡展示与执行同源的 **宿主 cwd**。
- 逻辑路径 **不是** 磁盘挂载；powershell 的 `command` 为 Windows 语义，禁止在 command 内写 `/workspace/...`。
- 默认 `bash` 禁用；`write_file`、`edit_file`（Claude Code 风格精确替换）与 `powershell` 需 durable approval；审批须可见宿主 cwd。
- PowerShell 固定为 `pwsh`（PowerShell 7），无 PS 5.1 / Git Bash 回退；
- **不是** OS 级沙箱：经批准的命令仍以当前 Windows 用户权限运行。

进程重启后 sandbox 重连仅依赖 `captureState.metadata.workspaceId` 从 Turso 重载 roots。

### 鉴权与 binding

- 本地回环访问使用 Eve 的 `localDev()` + 工作区 capability 请求头
  `x-nianagent-workspace-capability`。
- Turso 库：`nianagent/.workflow-data/nianagent.db`（Next 唯一 writer；Agent 只读）。
- 默认脚本显式绑定 **127.0.0.1**（`eve --host 127.0.0.1`、`next -H 127.0.0.1`）。
- 如果未来允许局域网访问，必须增加独立鉴权，不能只依赖 `localDev()`。

### Workflow 调试

- 页面：`/workflow-debug`（完整 Runs / Hooks / 工作流图 / run detail / trace / stream / 控制，zh-CN）。
- Next 代理：`/api/workflow-debug/<agent>/rpc|stream/*` → `127.0.0.1:4274|4275`。
- Agent bridge 仅通过 **当前已安装 Eve** 的 vendored runtime `getWorld()` 取同一 World。
- **禁止** `createWorld` / `createLocalWorld` / `getWorldFromEnv` / 第二 `@workflow/core` world。
- **禁止** 把 Eve 精确版本写死为 pin；升级 Eve 后须做能力/路径预检与同 World 重验（见下）。

### Eve 升级与同 World 重验

1. 保持 manifest 中 `eve` 的 **semver 范围**（如 `^0.24.4`），不要精确 pin。
2. 升级后启动 Agent，确认 bridge 预检通过：可解析 eve 安装、runtime 可导入、`getWorld` 可用且 World 已就绪。
3. 若 Eve 迁移了 vendored 路径，先更新 `workflow-debug-world.ts` 解析逻辑再预检。
4. 对真实 run 做只读 `fetchRun` + 至少一次受控写（如 cancel/health），确认状态落在该 Agent 的 `.eve/.workflow-data`。
5. 预检失败时 fail-closed，**绝不**降级创建 World。

## 与其他 Eve 应用的关系

| 应用 | 运行环境 | 独有职责 |
| --- | --- | --- |
| `nianagent` | Windows 本地 | 多 session 绑定不同本地项目目录、本地执行与本地鉴权 |
| `tool` | Vercel | Vercel Sandbox、Supabase 鉴权和云端 Web 应用能力 |
| `evework` | Hugging Face Space | AgentFS、容器部署、服务鉴权和 HF 持久化适配 |

三者可以共享与宿主无关的 instructions、skills、tools、connections 和 hooks；各自的
`agent.ts`、`sandbox.ts`、channel 鉴权、Workflow 配置及部署入口保持独立。

## 开发

### 模型配置

模型白名单统一维护在 `packages/agent-core/config/models.json`。每个条目包含页面使用的 `id`、`label`，
OpenAI-compatible 服务使用的 `providerModelId`、上下文窗口大小，以及允许使用该模型的
Agent。`defaultModelId` 指定所有 Agent 共用的默认模型。

`@nianagent/agent-core` 是 Next.js 与两个独立 Eve Agent 的共享 workspace 包。Agent 只通过
包名导入共享运行时代码，使 Eve 开发模式能把该依赖完整纳入不可变源码快照；禁止从 Agent
根目录使用相对路径越界导入仓库根源码。

Provider 地址和密钥通过服务端环境变量配置：

```powershell
OPENAI_BASE_URL=https://<provider-endpoint>/v1
OPENAI_API_KEY=<provider-api-key>
```

页面只会收到模型的 `id` 和 `label`。用户可以在同一会话中切换模型，选择会从下一次发送
开始生效；服务端会再次按 Agent 白名单校验，浏览器不能提交任意 Provider 模型。

安装依赖并启动本地开发服务：

```powershell
pnpm install
pnpm dev
```

生产式本地运行使用根级命令构建并启动完整应用：

```powershell
pnpm build
pnpm start
```

`pnpm build` 会先构建两个 Eve Agent，再构建 Next.js。`pnpm start` 由 `withEve` 在
Next.js 进程内启动并代理两个 Eve production sidecar（均绑定 `127.0.0.1`，端口 `4274` /
`4275`；页面使用 Next 默认端口）。不要另行执行 `eve start`，否则会与 `withEve` 为同一
Agent 启动的 sidecar 争用端口。

根目录 `.env` 是 Provider 与 `NIANAGENT_WORKFLOW_DEBUG_SECRET` 等配置的唯一来源；
`pnpm start` 的 Next.js 进程及其启动的 Eve sidecar 共用该环境。参见 `.env.example`。不要在
各 Agent 目录复制 `.env`。

**运行前提：**

- 本机安装 **PowerShell 7**（`pwsh` 在 PATH 中）；缺失时 powershell 工具会给出可行动错误，不会回退。
- Windows 上需有 Turso native binding `@tursodatabase/database-win32-x64-msvc@0.4.4`（已作 optionalDependency）。

修改 Eve Agent 代码前，先阅读当前安装版本的 `node_modules/eve/docs/README.md`，再阅读
与本次修改相关的专题文档。
