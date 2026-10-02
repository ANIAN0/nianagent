# Moon 当前架构

## 模型配置模块

`backend/models.mjs` 是模型配置的业务入口，负责连接/模型校验、目录发现、Pi 调用检查、配置可用性和稳定身份。自定义连接使用 `moon-<connectionId>` 注册 Pi provider；订阅连接选择 Pi 的真实 provider，每个 provider 仅允许一个订阅连接。连接名和模型显示名都不是身份。

`backend/schema.mjs` 是字段结构与静态约束来源，`backend/contract.mjs` 定义操作、说明及派发绑定。前端 DTO 由契约生成；`backend/models.mjs` 执行依赖业务状态的校验。`/api-catalog/` 直接读取该目录并调用同一个正式服务，不复制后端逻辑。

## Pi 运行时和认证

使用官方 `@earendil-works/pi-coding-agent` 1.0.0 的 `ModelRuntime`，不导入 SDK 私有文件。API key 保存经过 `runtime.login(..., "api_key", ...)`，模型检查经过 `completeSimple`；OAuth 登录、退出、token 刷新由 Pi 负责。`backend/oauth.mjs` 只桥接实际提示、设备码、URL、输入与取消，不实现第三方认证协议。

模型注册按已保存连接重建；`modelsPath:null` 禁用用户 CLI 配置发现，不读取 `~/.pi`。目录默认使用 Pi 内置元数据，不隐式访问远端 catalog。自定义服务发现使用 OpenAI 兼容或 Anthropic 的 models 接口，发现不等于推理成功，未知能力必须补全后才能保存。无凭据请求使用 Pi 所需的内部占位 key，并在正式 fetch 适配边界移除认证头。

## 数据归属与提交边界

`backend/store.mjs` 实现官方 CredentialStore 接口。连接元数据与 Pi Credential 同属 Moon 独立文件，默认 Windows 为 `%LOCALAPPDATA%/Moon/models/models.json`；开发服务与桌面进程共用该目录。后端可用 `MOON_DATA_DIR` 指定隔离目录，桌面使用系统 local data 路径。文件含敏感凭据，按当前用户目录权限保护；不是加密保险库，不进入仓库，仅在用户显式显示或复制API密钥时按连接返回前端。

写入使用跨进程文件锁、临时文件和原子替换；损坏文件不以空库覆盖。连接 revision 防止旧窗口覆盖新配置。API 密钥先在隔离的 CredentialStore 中通过 Pi 更新，再与连接一起提交。OAuth 的 provider 级授权租约、连接 revision 和凭据写入在同一数据锁下校验，删除/退出后不能写回旧授权。令牌刷新同样通过持久化 CredentialStore，避免丢失轮换后的 refresh token。

API/环境变量/无凭据切换清除原 stored key；环境变量仅在后端读取。自定义请求头只允许字面值，禁止命令、变量表达式及认证头。普通连接响应只接收空 apiKey、keySaved 与配置状态；revealKey按连接ID和revision读取已保存API密钥，禁止读取OAuth和环境变量值。运行错误不转发原始外部响应或认证头。

## 运行和传输

Node.js >=22.19 是桌面及开发环境的运行前提。`backend/rpc.mjs` 运行在独立 Node 子进程，只使用 stdin/stdout JSON 行协议；SDK 不进入 WebView bundle。`src-tauri/src/models.rs` 管理进程、请求分派、超时、取消和退出清理，通过三个 Tauri 命令提供模型 RPC、取消和授权链接打开。

浏览器开发/生产预览通过 Vite `modelBackendPlugin` 同源 POST 转发到同一个 Node RPC；校验 Origin 和 Content-Type，不单独暴露后端端口。浏览器不具备 Tauri 能力时仍可完整使用模型配置。单纯托管 dist 不含此本地后端。

`pnpm backend:package` 使用 pnpm deploy 生成独立的 `src-tauri/runtime/`（正式构建产物，包含生产依赖），Tauri 将其作为资源打包。当前依赖系统 Node，没有打包 Node 可执行文件；安装目标需要安装满足版本要求的 Node。

## 前端与其余功能

`src/features/models/model-service.ts` 是正式适配器。组件库继续显式注入 mock service；真实模型页不使用示例密钥、固定账号或内置假连接。已保存可用模型进入首页和对话选择器，删除模型后保留旧选择但禁止发送，不自动替换。模型配置已接入后端，消息生成、会话历史与工具执行仍是原有前端模拟，本次没有接入真实 agent 会话。


## 模型接口契约与目录匹配

`backend/schema.mjs` 定义字段类型、必填项和结构约束；`backend/contract.mjs` 定义操作绑定、输入输出、条件、错误和取消边界。运行时校验请求与响应，接口目录直接展示这些字段。`pnpm contract:generate` 生成前端 DTO 和逐操作类型；`pnpm contract:check` 检查漂移，构建前自动执行。并发版本、授权租约、唯一名称等依赖存储状态的约束仍在业务层执行。

发现模型按服务 ID、规范化 ID、命名空间末段及名称匹配当前安装的 Pi 目录。匹配仅补充能力，不修改连接协议或实际模型 ID。优先使用相同端点的来源；多来源仅填入一致字段，思考等级取共同支持且映射一致的部分。冲突和未知字段在界面注明，允许人工确认。Pi 目录描述不等于兼容服务承诺，实际调用仍需检查模型。

删除的取消信号贯穿派发、锁等待和事务，在临时文件写入后、原子替换前再次检查；替换提交后不回滚。初始化错误通过 RPC 返回，桥接只保留已知的安全错误分类，不向界面透传可能含敏感信息的 stderr。

## 验收修正后的恢复与选择语义

RPC 初始化失败不会终止进程或永久缓存错误；同一批请求共用初始化，后续请求可在文件修复后重新初始化。存储初始化只读取，不改写已有文档；读取检查连接、凭据与授权租约结构，旧 v1 缺失 authorizations 时只在内存补空对象，真实写事务才持久化。

DirectoryProtocol 是独立的目录协议枚举；ModelApi 仍允许 Pi 提供者使用其调用协议。模型列表由后端 Pi getSupportedThinkingLevels 计算只读 supportedThinkingLevels，前端仅做中文映射。首页与对话共用有效选择计算；不支持的旧思考等级在展示和提交时归一，无思考模型不显示强度入口。

编辑、删除模型及目录补全会使旧检查结果失效。发现与检查提供取消请求，保留草稿；写入期间禁止离开并提示原因。删除确认提供取消请求，随后重新读取目录；传输取消不承诺撤回已经提交的数据，状态读取失败必须提示重新读取。
