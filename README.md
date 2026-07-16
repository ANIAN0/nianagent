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

本地工作区选择、多会话目录绑定和本地 sandbox backend 尚未实现。

## 核心定位

- 同一个本地服务可以同时承载多个 Eve session。
- 每个 session 在创建时选择并绑定一个本地项目目录。
- 不同 session 可以绑定不同项目目录，并保持各自独立的工作区状态。
- 项目目录一旦绑定，在该 session 生命周期内保持不变；切换目录应创建新 session。
- Eve 逻辑工作区 `/workspace` 映射到该 session 绑定的 Windows 项目目录。
- 浏览器只连接本机 Next.js 服务，不直接访问文件系统。

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

### Sandbox

`nianagent` 使用本地专用 sandbox backend，使同一服务中的不同 session 可以映射到不同
的 Windows 项目目录。它不复用 Vercel Sandbox，也不把 Hugging Face 的 AgentFS 适配层
作为本地运行前提。

本地 backend 需要在两种执行模型中正式选定一种：

1. 直接在 Windows 宿主机的绑定目录中执行，兼容本机工具链，但隔离能力较弱。
2. 通过 Docker bind mount 将绑定目录映射到容器 `/workspace`，隔离更强，但依赖
   Docker Desktop，并需要处理 Windows 文件系统性能、权限和路径兼容。

选型确认前，不实现两套并存的降级路径。

### 鉴权

- 本地回环访问使用 Eve 的 `localDev()`。
- 本地请求不依赖 Supabase，不进行每请求 Supabase 用户校验。
- 默认只监听或只信任回环地址。
- 如果未来允许局域网或其他设备访问，必须增加独立的本地鉴权机制，不能继续只依赖
  `localDev()`。

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

`pnpm build` 会先构建两个 Eve Agent，再构建 Next.js。`pnpm start` 会同时启动 Next.js
和两个 Eve 服务（分别监听 `4274`、`4275`）。不要单独执行 `next start`，否则只有页面服务，
发送消息时代理目标不会监听。

根目录 `.env` 是模型 Provider 的唯一配置来源；`pnpm start` 会将其传给两个 Eve 进程。不要在
各 Agent 目录复制 `.env`，以免 Provider 地址和密钥出现不一致。

修改 Eve Agent 代码前，先阅读当前安装版本的 `node_modules/eve/docs/README.md`，再阅读
与本次修改相关的专题文档。
