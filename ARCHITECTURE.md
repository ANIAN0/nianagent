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

Node.js >=22.19 是桌面及开发环境的运行前提。`backend/rpc.mjs` 运行在独立 Node 子进程，同时接收原生 stdin/stdout JSON 行请求及浏览器代理的鉴权回环 HTTP 请求；SDK 不进入 WebView bundle。`src-tauri/src/models.rs` 管理进程、请求分派、超时、取消和退出清理，通过三个 Tauri 命令提供模型 RPC、取消和授权链接打开。

浏览器开发/生产预览通过 Vite `modelBackendPlugin` 同源 POST 转发到同一个 Node RPC；校验 Origin 和 Content-Type，通过实例文件连接Tauri子进程的回环HTTP端口，不创建第二个后端。浏览器不具备 Tauri 能力时仍可完整使用模型配置。单纯托管 dist 不含此本地后端。

`pnpm backend:package` 使用 pnpm deploy 生成独立的 `src-tauri/runtime/`（正式构建产物，包含生产依赖），Tauri 将其作为资源打包。当前依赖系统 Node，没有打包 Node 可执行文件；安装目标需要安装满足版本要求的 Node。

## 前端与其余功能

`src/features/models/model-service.ts` 是正式适配器。组件库继续显式注入 mock service；真实模型页不使用示例密钥、固定账号或内置假连接。已保存可用模型进入首页和对话选择器，删除模型后保留旧选择但禁止发送，不自动替换。模型配置已接入后端，消息生成、会话历史与工具执行仍是原有前端模拟，会话配置已绑定真实 Pi AgentSession；真实消息生成与工具执行尚未接入。


## 模型接口契约与目录匹配

`backend/schema.mjs` 定义字段类型、必填项和结构约束；`backend/contract.mjs` 定义操作绑定、输入输出、条件、错误和取消边界。运行时校验请求与响应，接口目录直接展示这些字段。`pnpm contract:generate` 生成前端 DTO 和逐操作类型；`pnpm contract:check` 检查漂移，构建前自动执行。并发版本、授权租约、唯一名称等依赖存储状态的约束仍在业务层执行。

发现模型按服务 ID、规范化 ID、命名空间末段及名称匹配当前安装的 Pi 目录。匹配仅补充能力，不修改连接协议或实际模型 ID。优先使用相同端点的来源；多来源仅填入一致字段，思考等级取共同支持且映射一致的部分。冲突和未知字段在界面注明，允许人工确认。Pi 目录描述不等于兼容服务承诺，实际调用仍需检查模型。

删除的取消信号贯穿派发、锁等待和事务，在临时文件写入后、原子替换前再次检查；替换提交后不回滚。初始化错误通过 RPC 返回，桥接只保留已知的安全错误分类，不向界面透传可能含敏感信息的 stderr。

## 验收修正后的恢复与选择语义

RPC 初始化失败不会终止进程或永久缓存错误；同一批请求共用初始化，后续请求可在文件修复后重新初始化。存储初始化只读取，不改写已有文档；读取检查连接、凭据与授权租约结构，旧 v1 缺失 authorizations 时只在内存补空对象，真实写事务才持久化。

DirectoryProtocol 是独立的目录协议枚举；ModelApi 仍允许 Pi 提供者使用其调用协议。模型列表由后端 Pi getSupportedThinkingLevels 计算只读 supportedThinkingLevels，前端仅做中文映射。首页与对话共用有效选择计算；不支持的旧思考等级在展示和提交时归一，无思考模型不显示强度入口。

编辑、删除模型及目录补全会使旧检查结果失效。发现与检查提供取消请求，保留草稿；写入期间禁止离开并提示原因。删除确认提供取消请求，随后重新读取目录；传输取消不承诺撤回已经提交的数据，状态读取失败必须提示重新读取。

## 统一模型服务宿主

Tauri启动时创建一个RPC子进程，并等待运行就绪握手。该进程拥有唯一ModelService，stdin RPC与回环HTTP共同调用同一dispatch；业务、取消及错误过滤不重复。`backend/runtime.mjs`管理随机端口、令牌、实例ID、源码版本和数据目录运行锁。Vite只读取runtime.json并转发，不能启动服务；无宿主、旧版本和断连均明确报错。HTTP仅绑定127.0.0.1，要求令牌并拒绝带Origin的直接请求；Vite验证同源请求。

stdin关闭会中止请求、关闭HTTP并删除本实例运行文件和锁；Rust退出先关闭stdin等待清理，超时再终止。源码版本检查要求后端更新后重启。目录锁与实例信息仅为运行数据，不改变连接文件。开发态可用MOON_DATA_DIR隔离桌面测试；浏览器代理通过MOON_RUNTIME_FILE指向该实例，生产桌面仍使用系统目录。


## 会话配置模块

`backend/sessions.mjs` 由现有 ModelService 持有并复用唯一 Tauri Node 宿主，通过同一契约派发 sessionCatalog、sessionRead、sessionApply，不新建服务或进程。`SessionService` 只依赖模型模块公开的 runtime() 创建无网络 ModelRuntime；可在尚无模型和密钥时配置工具与指令，不发起推理。实际聊天以后必须另行绑定用户选择的模型、思考等级与调用边界，不把无模型配置会话当成可直接生成的会话。

Pi 拥有工具注册、活动工具集与系统提示构造。目录来自 getAllTools；选择经过业务校验后调用 setActiveToolsByName，再读取 getActiveToolNames 确认。只接入 Pi 内置工具，关闭扩展、Skill、主题与提示模板自动加载，内存 SettingsManager 不读取用户 Pi settings 或安装资源包。工具注册不等于执行环境可用：Bash/PowerShell 使用 Pi 公开解析器，grep/find 检查 Pi 缓存二进制与 PATH；缺依赖标记不可用且拒绝选中，不触发 SDK 自动下载。默认活动集过滤不可用项，读取已保存配置保留 toolIds/revision，未知或依赖失效项通过 unavailableToolIds 明确返回，真实 Pi 活动集只启用可用项；用户可取消失效项后应用恢复。保存用户选择仍严格拒绝不可用项，不静默更换。具体文件权限只在未来实际执行时判断。未知工具和重复项拒绝保存，不依赖 SDK 的静默忽略。

指令使用 Pi loadProjectContextFiles 的文件优先级、全局以及从根到工作目录的发现规则。个人指令目录是模型数据目录下 agent（如 `%LOCALAPPDATA%/Moon/models/agent`），与 CLI ~/.pi 分离。all 保留全部，directory 排除个人指令，none 不注入项目指令而保留 Pi 系统提示。显式清空 loader 的 systemPromptOverride/appendSystemPromptOverride，避免 .pi/SYSTEM.md 等隐式覆盖逃逸指令范围与快照。每次应用读取实际指令并保存正文快照；普通读取恢复该快照，不因磁盘文件改变悄悄改变已生效配置。再次应用才更新文件内容。空 cwd 的目录查询显式返回宿主 process.cwd() 解析后的真实路径，仅供初始目录选择，不把虚构路径映射为真实路径；保存始终要求绝对存在目录，已保存会话不可换目录。

数据保存在模型数据目录下 `session-config/sessions.json`，独立于模型凭据。revision 防止并发覆盖；跨进程锁内校验版本、创建候选 Pi 会话、原子提交工具和指令。Pi SessionManager 与 SettingsManager 均使用内存模式，避免 SDK 在事务外写盘。rename 为提交边界，提交前取消销毁候选并保留旧值；提交后取消不回滚，调用方重新读取确认。保存失败保留原会话。恢复构建并保留真实 Pi 配置会话，通过版本比较防止异步恢复覆盖新提交，再返回实际工具集，不扩展到消息历史持久化。正在执行的会话不允许更改配置；当前尚无真实生成入口。

`/api-catalog/` 按契约的模块字段分组展示模型配置和会话配置，统一类型生成及真实传输。会话配置内容与工作目录可能含本地项目数据，沿用本机宿主鉴权，不向外部发送。

当前 Pi 对象是配置专用会话，尚无消息历史；应用时构建候选后替换不会丢失正式聊天内容。后续真实聊天接入必须在同一个业务会话上更新工具/资源并维护历史，不能继续用本次配置专用重建方式替换包含消息的会话。


## 桌面窗口生命周期

`window_lifecycle.rs` 管理任务栏窗口、托盘及关闭隐藏。官方 single-instance 插件在 setup 创建后端前执行，重复启动恢复已有宿主。关闭只隐藏 WebView，不改变草稿或服务状态；主动退出经 RunEvent 调用 ModelBackend.shutdown，停止标志阻止请求重建子进程，随后关闭 stdin 等待清理，超时终止子进程。Windows GUI 子系统覆盖 debug/release；setup 内部捕获启动错误、释放服务，再通过原生错误框报告。
