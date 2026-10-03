# Moon 当前架构

## 会话控制

`backend/conversation-controls.mjs` 拥有手动压缩操作的接受、取消与结果对账。操作回执原子保存到应用数据目录的 `conversations/controls/<sessionId>.json`，只保存操作身份与结果；摘要、保留起点和完整历史仍由Pi JSONL唯一持有。控制与发送、继续、配置应用共用SessionService会话门禁，压缩开始前原子保留busy，防止Pi `compact()` 首先abort正在执行的任务。

控制结果未确认时，正式发送入口继续阻止新的运行，直到查询原操作确认Pi提交边界，避免后续自动压缩污染对账证据。完成、取消和失败回执保持终态，不会认领其他操作追加的摘要；内存任务按会话与操作双重身份管理。若Pi追加历史失败且磁盘暂不可读，只保留操作前只读快照并要求重读历史，不暴露未提交的内存摘要。取消在Pi创建摘要控制器前到达时，在正式手动压缩开始事件补发取消，仍以实际提交结果为准。

`conversation-control-contract.mjs` 是输入、结果与调用说明的权威来源，汇入现有schema与接口目录。正式页面用 `useConversationControls` 以会话及操作标识恢复结果，切换或关闭面板不取消后台控制；网络未知时查询原操作，不重复发起。`CompactDialog` 和 `CompactionRecord` 的状态由服务提供，组件库复用正式组件但不调用模型。

会话派生在独立打开的Pi SessionManager上调用官方 `createBranchedSession`，复制根到选定assistant entry的稳定前缀；不调用会替换源runtime的操作。源JSONL、active leaf和订阅保持不变。新会话复制已保存项目指令与工具选择快照，首次创建独立agent/订阅；重启可按需恢复。来源关系保存于Pi custom entry和会话摘要，草稿、待发送队列及控制请求归属Moon会话身份，不从历史复制。

派生先持久化operation ID和新Moon会话ID，再生成Pi文件、保存路径回执、提交配置和索引。结果未知只查询原operation；恢复按持久lineage身份补齐索引，不依据标题猜测，不重新生成Pi路径。`session.copyConfiguration`在配置锁下复制明确快照，不重新发现磁盘指令，也不覆盖已经存在的新会话配置。

摘要来源以实际compaction entryId关联。派生通过Pi公开custom entry在目标lineage保存已继承的手动摘要标识，只保留目标真实前缀中存在的摘要，不复制来源控制请求；继续派生保留相同来源。发布恢复按操作快照幂等补齐只读来源，已有目标运行时不通过第二个manager追加或移动叶子。旧版本已发布分支在restore阶段只读追溯lineage祖先的压缩回执并缓存来源；snapshot不读文件，不重写源或目标JSONL。

## 消息材料

`backend/materials.mjs` 统一负责材料准备、核对、恢复与预览。图片保存固定内容，普通文件保存真实绝对路径，Skill由Pi ResourceLoader发现并按本次选择固定正文、来源和相对参考目录。材料位于独立的`materials/`应用数据目录；移除草稿引用不会删除用户源文件，历史图片不依赖原工作目录仍存在。

`material-contract.mjs` 定义选择、准备、图片上载、资源目录、预览及恢复接口，目录和前端DTO从同一来源生成。单图最多8MiB，仅上载操作允许16MiB传输请求，其余请求维持1MiB；普通文件引用不会将整文件内联上传。系统多选沿用Tauri已有反向宿主能力，浏览器与原生窗口共用同一宿主。

正式输入通过`MaterialServiceContext`接入。材料控制、候选列表、缩略图和内容预览分别维护，组件目录注入隔离服务替身。草稿整体由应用持久化，材料控制器只核对恢复的引用；异步准备按会话和工作目录归属，移除或切换后的迟到结果不能重添材料。发送前及队列交付前使用公开`resolveForPrompt`核对来源及模型图片能力，传给Pi的是实际图片、文件路径说明和所选Skill正文。`moon-materials`作为Pi自定义历史元数据保存原始用户文字与材料身份，页面不显示展开后的指令正文冒充用户输入。

## 模型配置模块

`backend/models.mjs` 是模型配置的业务入口，负责连接/模型校验、目录发现、Pi 调用检查、配置可用性和稳定身份。自定义连接使用 `moon-<connectionId>` 注册 Pi provider；订阅连接选择 Pi 的真实 provider，每个 provider 仅允许一个订阅连接。连接名和模型显示名都不是身份。

`backend/schema.mjs` 和 `backend/contract.mjs` 汇总各功能契约及操作绑定；工作区、会话摘要和对话分别在 `workspace-contract.mjs`、`conversation-catalog-contract.mjs`、`conversation-contract.mjs` 维护结构、约束与说明。前端 DTO 由汇总契约生成，业务模块执行依赖存储状态的校验。`/api-catalog/` 直接读取该目录并调用同一个正式服务，不复制后端逻辑。

## Pi 运行时和认证

使用官方 `@earendil-works/pi-coding-agent` 1.0.0 的 `ModelRuntime`，不导入 SDK 私有文件。API key 保存经过 `runtime.login(..., "api_key", ...)`，模型检查经过 `completeSimple`；OAuth 登录、退出、token 刷新由 Pi 负责。`backend/oauth.mjs` 只桥接实际提示、设备码、URL、输入与取消，不实现第三方认证协议。

模型注册按已保存连接重建；`modelsPath:null` 禁用用户 CLI 配置发现，不读取 `~/.pi`。目录默认使用 Pi 内置元数据，不隐式访问远端 catalog。自定义服务发现使用 OpenAI 兼容或 Anthropic 的 models 接口，发现不等于推理成功，未知能力必须补全后才能保存。无凭据请求使用 Pi 所需的内部占位 key，并在正式 fetch 适配边界移除认证头。

## 数据归属与提交边界

`backend/store.mjs` 实现官方 CredentialStore 接口。连接元数据与 Pi Credential 同属 Moon 独立文件，默认 Windows 为 `%LOCALAPPDATA%/Moon/models/models.json`；开发服务与桌面进程共用该目录。后端可用 `MOON_DATA_DIR` 指定隔离目录，桌面使用系统 local data 路径。文件含敏感凭据，按当前用户目录权限保护；不是加密保险库，不进入仓库，仅在用户显式显示或复制API密钥时按连接返回前端。

写入使用跨进程文件锁、临时文件和原子替换；损坏文件不以空库覆盖。连接 revision 防止旧窗口覆盖新配置。API 密钥先在隔离的 CredentialStore 中通过 Pi 更新，再与连接一起提交。OAuth 的 provider 级授权租约、连接 revision 和凭据写入在同一数据锁下校验，删除/退出后不能写回旧授权。令牌刷新同样通过持久化 CredentialStore，避免丢失轮换后的 refresh token。

API/环境变量/无凭据切换清除原 stored key；环境变量仅在后端读取。自定义请求头只允许字面值，禁止命令、变量表达式及认证头。普通连接响应只接收空 apiKey、keySaved 与配置状态；revealKey按连接ID和revision读取已保存API密钥，禁止读取OAuth和环境变量值。运行错误不转发原始外部响应或认证头。

## 运行和传输

Node.js >=22.19 是桌面及开发环境的运行前提。`backend/rpc.mjs` 运行在独立 Node 子进程，同时接收原生 stdin/stdout JSON 行请求及浏览器代理的鉴权回环 HTTP 请求；SDK 不进入 WebView bundle。`src-tauri/src/models.rs` 管理进程、请求分派、超时、取消和退出清理，通过三个 Tauri 命令提供模型 RPC、取消和授权链接打开。

浏览器开发/生产预览通过 Vite `modelBackendPlugin` 同源 POST 转发到同一个 Node RPC；校验 Origin 和 Content-Type，通过实例文件连接 Tauri 子进程的回环 HTTP 端口，不创建第二个后端。模型、工作区、会话目录和对话共用此传输；目录选择请求由 Node 通过宿主能力通道交给 Rust，浏览器不直接调用系统对话框。单纯托管 dist 不含此本地后端。

浏览器代理使用内置 `node:http` 连接回环宿主，显式总等待与原生命令一致：目录选择 610 秒，其他请求 60 秒；目录能力自身 600 秒超时先返回具体选择错误。取消或客户端断开销毁上游请求，沿宿主 HTTP 关闭信号中止同一操作；迟到目录结果不登记，已提交写入不回滚。响应超时与服务断连分开提示，不因用户仍在目录窗中选择就声称宿主已退出。

`pnpm backend:package` 使用 pnpm deploy 生成独立的 `src-tauri/runtime/`（正式构建产物，包含生产依赖），Tauri 将其作为资源打包。当前依赖系统 Node，没有打包 Node 可执行文件；安装目标需要安装满足版本要求的 Node。

## 前端状态与展示边界

`src/features/models/model-service.ts` 提供共用 `modelCall` 传输，功能适配器分别位于 models、workspaces、session 和 conversation。`App.tsx` 组合工作区、模型目录、会话摘要及当前对话；`use-live-conversation.ts` 分开保存服务器快照与编辑草稿，轮询不能用服务器数据覆盖用户输入。当前会话正文成功显示后，才以已展示的摘要 revision 标记已读，旧读取不能清掉较新的完成结果。读取错误与发送/停止错误分别维护。

已保存可用模型进入首页和对话选择器；删除模型后保留旧选择但禁止发送，不自动替换。模型能力只由后端 Pi 目录提供，前端统一计算展示和提交的有效思考等级。正式入口提供文本多轮、真实思考/工具结果、停止及继续回复，尚未接入附件、排队、分步问答。组件库显式注入 mock service；`use-conversations.ts`、`mock-conversations.ts` 及 fixtures 只驱动独立展示，不写正式数据或发起模型推理。


## 模型接口契约与目录匹配

`backend/schema.mjs` 汇总字段类型、必填项和结构约束；`backend/contract.mjs` 汇总操作绑定、输入输出、条件、错误和取消边界。运行时校验请求与响应，接口目录直接展示这些字段。`pnpm contract:generate` 生成前端 DTO 和逐操作类型；`pnpm contract:check` 检查漂移，构建前自动执行。并发版本、授权租约、唯一名称等依赖存储状态的约束仍在业务层执行。

发现模型按服务 ID、规范化 ID、命名空间末段及名称匹配当前安装的 Pi 目录。匹配仅补充能力，不修改连接协议或实际模型 ID。优先使用相同端点的来源；多来源仅填入一致字段，思考等级取共同支持且映射一致的部分。冲突和未知字段在界面注明，允许人工确认。Pi 目录描述不等于兼容服务承诺，实际调用仍需检查模型。

删除的取消信号贯穿派发、锁等待和事务，在临时文件写入后、原子替换前再次检查；替换提交后不回滚。初始化错误通过 RPC 返回，桥接只保留已知的安全错误分类，不向界面透传可能含敏感信息的 stderr。

## 验收修正后的恢复与选择语义

RPC 初始化失败不会终止进程或永久缓存错误；同一批请求共用初始化，后续请求可在文件修复后重新初始化。模型凭据存储初始化只读取，不改写已有文档；读取检查连接、凭据与授权租约结构，旧 v1 缺失 authorizations 时只在内存补空对象，真实写事务才持久化。

DirectoryProtocol 是独立的目录协议枚举；ModelApi 仍允许 Pi 提供者使用其调用协议。模型列表由后端 Pi getSupportedThinkingLevels 计算只读 supportedThinkingLevels，前端仅做中文映射。首页与对话共用有效选择计算；不支持的旧思考等级在展示和提交时归一，无思考模型不显示强度入口。

编辑、删除模型及目录补全会使旧检查结果失效。发现与检查提供取消请求，保留草稿；写入期间禁止离开并提示原因。删除确认提供取消请求，随后重新读取目录；传输取消不承诺撤回已经提交的数据，状态读取失败必须提示重新读取。

## 统一后端宿主

Tauri 启动时创建一个 RPC 子进程，并等待运行就绪握手。该进程中的 ModelService 装配模型、工作区、会话配置、共享 ConversationStore、摘要目录及 ConversationService；stdin RPC 与回环 HTTP 共同调用同一 dispatch，不重复创建业务实例。`backend/runtime.mjs` 管理随机端口、令牌、实例 ID、源码版本和数据目录运行锁。Vite 只读取 runtime.json 并转发，不能启动服务；无宿主、旧版本和断连均明确报错。HTTP 仅绑定 127.0.0.1，要求令牌并拒绝带 Origin 的直接请求；Vite 验证同源请求。

stdin关闭会中止请求、关闭HTTP并删除本实例运行文件和锁；Rust退出先关闭stdin等待清理，超时再终止。源码版本检查要求后端更新后重启。目录锁与实例信息仅为运行数据，不改变连接文件。开发态可用MOON_DATA_DIR隔离桌面测试；浏览器代理通过MOON_RUNTIME_FILE指向该实例，生产桌面仍使用系统目录。


## 会话配置模块

`backend/sessions.mjs` 由 ModelService 持有，通过同一契约派发 sessionCatalog、sessionRead、sessionApply。可在尚无模型和密钥时读取工具目录、配置工具与指令，不发起推理。对话服务开始生成前另行验证用户所选连接、模型和思考等级，并将正式 Pi AgentSession 注册到同一个 SessionService；配置专用会话不能直接作为生成会话。

Pi 拥有工具注册、活动工具集与系统提示构造。内置目录来自 getAllTools，MCP 目录使用与配置指纹匹配的真实验证结果；选择经过业务校验后设置活动工具，实际 MCP 权限另经精确 exposure 与公共 tool_call 门卫约束。内置工具目录来自 Pi；MCP 工具来自正式服务验证目录，由宿主显式 factory 注册，磁盘扩展、主题与提示模板不自动加载，内存 SettingsManager 不读取用户 Pi settings 或安装资源包。工具注册不等于执行环境可用：Bash/PowerShell 使用 Pi 公开解析器，grep/find 检查 Pi 缓存二进制与 PATH；缺依赖标记不可用且拒绝选中，不触发 SDK 自动下载。默认活动集过滤不可用项，读取已保存配置保留 toolIds/revision，未知或依赖失效项通过 unavailableToolIds 明确返回，真实 Pi 活动集只启用可用项；用户可取消失效项后应用恢复。保存用户选择仍严格拒绝不可用项，不静默更换。具体文件权限在工具实际执行时判断。未知工具和重复项拒绝保存，不依赖 SDK 的静默忽略。

指令使用 Pi loadProjectContextFiles 的文件优先级、全局以及从根到工作目录的发现规则。个人指令目录是模型数据目录下 agent（如 `%LOCALAPPDATA%/Moon/models/agent`），与 CLI ~/.pi 分离。all 保留全部，directory 排除个人指令，none 不注入项目指令而保留 Pi 系统提示。loader 显式提供空 systemPrompt 并清空 systemPromptOverride，关闭 .pi/SYSTEM.md 的发现与覆盖；appendSystemPrompt 只注入 Moon 宿主运行环境说明，不发现或拼入 APPEND_SYSTEM.md。说明来自真实平台、原生 cwd 与 Pi 公开 shell 解析器，指导文件工具优先使用相对路径；Windows Bash 的 /tmp 等挂载路径必须经实际 cygpath 转换，禁止猜盘符。宿主说明是工具运行事实，与个人/目录指令分离，none 及已有会话 reload 都保留；项目文本不能替换 loader 的系统提示。每次应用读取实际指令并保存正文快照；普通读取恢复该快照，不因磁盘文件改变悄悄改变已生效配置。再次应用才更新文件内容。空 cwd 的目录查询显式返回宿主 process.cwd() 解析后的真实路径，仅供初始目录选择，不把虚构路径映射为真实路径；保存始终要求绝对存在目录，已保存会话不可换目录。

配置数据保存在模型数据目录下 `session-config/sessions.json`，独立于模型凭据和消息历史。revision 防止并发覆盖；锁内校验版本、建立临时候选并以 rename 原子提交。候选使用内存 SessionManager 和 SettingsManager，验证工具与指令本身不写聊天历史。提交前取消保留旧值；提交后取消不回滚，调用方重新读取确认。

已有正式对话通过共享会话互斥锁与配置更新串行协调；运行或停止期间拒绝修改配置。对空闲的持久化 AgentSession，应用时更新资源快照、调用 Pi reload 并设置活动工具，保留同一个会话对象、SessionManager 及历史；提交失败恢复旧资源与工具。配置专用对象可以替换，含正式历史的对象不采用销毁重建策略。

`/api-catalog/` 按模块展示模型、工作区、会话摘要、会话配置和对话契约，统一类型生成及真实传输。配置读取与应用只在本机进行；开始对话后，所选项目指令、用户消息和工具结果按 Pi 的上下文机制发送给用户选择的模型服务。

## MCP 服务模块

`backend/mcp.mjs` 管理 Moon 个人服务配置和协议验证；`mcp-contract.mjs` 是 MCP DTO、RPC 注册和接口文档的权威来源，前端通过现有 `modelCall` 使用同一宿主。数据位于 `agent/mcp.json`，保持 Pi 的 `mcpServers` 格式，额外 `moonRevisions` 提供乐观版本，`moonDiscovery` 保存与配置指纹匹配的真实验证目录和时间。读取不会启动服务；损坏文件不覆盖，写入使用文件锁和原子替换，提交前取消不写入。环境和请求头只展开 `${ENV_NAME}`，不执行命令表达式。

验证使用官方 `@earendil-works/pi-mcp` 的 `McpClient` 与 stdio/Streamable HTTP 原生传输执行 initialize/tools/list，结束或取消等待关闭本次客户端及子进程，不执行业务工具。草稿测试不创建服务条目，保存时携带对应目录；已保存配置的匹配验证更新目录元数据。缓存是最近验证事实，和正式会话的当前连接状态分开展示。

正式 SessionService 通过公开 MCP、codemode、tool-search factories 和 `bindExtensions` 接入；目录查询、配置候选与只读历史不建立 MCP 连接。每个会话独立连接、资源与配置快照，仅连接本会话已选择工具的服务。服务默认 hidden，精确 toolExposure 只开放所选原始工具名；统一 `tool_call` 门卫同时约束直接调用、搜索及 codemode 内调用，不以活动工具集合代替权限。新工具默认不可调用，撤回工具由 Pi 标为 hidden。发现入口由宿主激活，不额外授予文件或命令工具。

保存服务配置不更换运行会话的连接；下一次空闲发送前 `refreshForRunExclusive` 或明确应用会话配置时，用原 SessionManager/AgentSession reload 最新快照并保持历史。选择失效工具时要求用户取消选择，不静默替换。runtime 持有官方传输的生命周期；dispose 关闭传输并拒绝迟到启动，宿主关闭等待清理。OAuth 账号管理未纳入本模块，原生扩展使用隔离内存认证状态，不读取其他 Pi CLI 的凭据；HTTP 凭据可通过请求头和环境引用配置，缺少授权明确显示 needs-auth。

直接 MCP 调用沿正式 Pi 历史展示来源。codemode 子调用使用 Pi `toolResult.nestedCalls` 的权威身份、输入、状态与耗时；成功结果正文未包含在该记录，因此公开 `tool_result` 钩子仅把缺少的展示正文写入 `moon-mcp-result` custom entry，绑定 enclosing assistant entryId/content index。每次历史投影建立一次结果索引，provider 重复 toolCallId 不覆盖旧发生，不另建消息或工具历史数据库。

设置页新增 MCP 分区。`McpSettings` 管理对象与请求，`McpServerList` 比较状态，`McpServerEditor` 管理候选与离开保护，`McpTransportFields`、`McpVariableFields`、`McpTestResult` 分别负责参数和验证目录，均有相邻正式组件展示定义。接口目录按正式注册加入 MCP 分组，并隐藏响应中的字面环境/请求头值。

## 工作区模块

`backend/workspaces.mjs` 持有 `workspaces.json`，负责路径规范化、稳定 ID、重复目录合并、最近选择和可访问状态。Windows 目录身份不区分大小写，以真实路径比较；目录失效保留原记录与原因，选择或发送前重新校验。文件锁与原子替换保护修改，取消在提交前检查，损坏文件不以空列表替代。

首页的“添加工作区”调用 workspaceChoose。`backend/native-directory.mjs` 使用同一 stdin/stdout 通道的宿主能力请求，由 Rust 打开 Windows 原生目录选择器；不启动 shell、不创建新后端，也不让用户在网页弹窗填写路径。浏览器走已有回环代理到同一个宿主；无桌面宿主时明确失败。取消目录选择返回 null，不保存或改变选择。

## 会话目录与 Pi 多轮对话

`backend/conversation-store.mjs` 是共享会话摘要存储，文件为 `conversations/index.json`。ConversationService 更新真实状态、模型选择、最近消息及未读结果，`conversation-catalog.mjs` 提供列表、过滤、摘要读取和标记已读。标记已读只在已展示 revision 仍匹配时修改 unread，不覆盖并发结束状态，也不改变时间排序；重复调用不重复写入。启动时仅恢复遗留 running/stopping 为中断失败，不自动重新发送请求。摘要 DTO 不暴露 Pi 文件路径和内部请求去重字段。

`backend/conversations.mjs` 负责模型绑定、执行生命周期和前端快照。正式历史由 Pi 官方 SessionManager 在 `conversations/pi/` 写入 JSONL，Moon 不维护另一份消息数据库。恢复正文先读取并验证非空行 JSON、合法文件头、支持的版本和 cwd，再通过公开 parseSessionEntries 与 SessionManager.inMemory 恢复官方分支与内存迁移，不调用会修复空文件、追加换行或迁移磁盘的 open。截断和损坏历史明确拒绝且字节不变；合法 v1/v2、空行、未知类型对象条目及未带末尾换行保持兼容。读取不要求模型连接或工作目录仍存在，也不发起推理。开始新回复时才重新校验历史并交由公开 SessionManager.open 恢复持久管理器，沿同一 leaf 接续，格式迁移及换行修复由 Pi 负责；继续发送才检查工作区、模型、思考等级和工具配置。工作区与 cwd 创建后不可改变。

发送使用客户端稳定请求 ID 和内容指纹，原子记录接受边界，并在 Pi 会话中保存请求记录，重试传输不会重复推理。前端成功清空输入前，后端确认 Pi 已接受用户消息；等待模型和工具完成不是发送应答的前提。接受后离开页面或取消读取不停止已开始工作；显式停止绑定当前 runId，并等待 Pi abort 保留实际结果。失败或中断且本轮 inputAccepted、有用户历史时，“继续上次回复”在原上下文中发送 Pi 自定义续接消息，不重新执行原始用户消息。未接受的预检失败须保留草稿重新发送，旧轮用户历史不能绕过本轮接受校验。

Pi 负责模型流、思考、工具调用、上下文及历史格式；Moon 将事件投影为可轮询快照，提供正文、思考、工具输入输出和真实状态。SDK 的事件与 agent 消息保持原始诊断供其原生重试、额度错误和上下文溢出分类；Moon 不修改共享 errorMessage。公开 SessionManager.appendMessage 在落盘边界复制含诊断的 assistant 消息，仅副本采用安全错误说明，保留官方消息历史且不保存外部响应中的原始诊断。DTO 与运行状态分别在展示边界脱敏，不引入自定义恢复分类器。输入草稿与服务快照分离，轮询失败保留已展示历史。正式入口当前只接文本基础多轮，不启用排队、附件或分步问答；组件库中的相关演示不进入生产执行链路。

快照的 `phase` 表示本轮回复生命周期，`completed` 不证明用户任务通过验收。可选 `runtime` 来自 Pi 1.0.0 的实际事件：回复与工具执行、`compaction_start/end`、`auto_retry_start/end` 及压缩摘要的 `summarization_retry_*`。重试次数、等待截止时间和安全原因由这些事件提供，不推测；停止、终态及宿主重启清除实时阶段。多个工具同时执行时，仍有工具运行就保留工具阶段。工具执行成功只说明该工具完成。

非取消的压缩失败单独形成可选 `notice`，与回复 `error/phase` 分开。阈值压缩失败不强制判定已经完成的回复失败；上下文溢出恢复是否失败仍依据 Pi 本轮最终结果。安全提醒写入 `moon-run-result` 并可在重启后恢复，新回复清除旧提醒；终态清除实时阶段不抹掉这条用户需要知道的结果。

Pi 内置 bash/powershell 共用 shell 实现；Moon 将执行结束事件中的 `structuredContent.exit_code/wall_time_seconds` 投影为可选 `exitCode/durationMs`。Pi 正式工具消息未保留这些字段，因此通过官方 `appendCustomEntry` 写入 `moon-shell-result`，实时与重启后的 JSONL 历史共用同一恢复入口。工具发生身份采用官方 assistant entry.id 与 content index，provider 的 toolCallId 仍保持原值；同一运行或不同运行中复用 ID 不覆盖先前结果。新 shell marker 保存 callEntryId/callIndex，旧 marker 依据其在官方 branch 中的写入位置关联对应 assistant 工具批次；toolResult 按该批次内尚未匹配的对应调用逐项关联。进度以发生身份维护，历史元数据直接由 branch 派生，不维护第二份历史库。退出码 0 与未提供明确区分，不解析输出文字伪造元数据；非零退出码表示命令失败，不覆盖实际输出。

主动停止以 Moon 的请求与运行结果标记为依据。Pi 即使将取消编码为末尾回复的 `stopReason=error`，该运行仍投影为中断；早先真实失败保持不变。停止时记录实际运行的调用发生，通过 `moon-run-result.stoppedToolCalls` 的 entryId/index 精确恢复；stoppedToolIds 保留旧格式兼容。旧标记按该轮最新对应发生恢复，不把同 ID 的早期工具一起取消；实际成功和非零退出结果优先于取消标记。只将没有真实退出码的取消错误显示为已停止，不把退出码非零的命令失败改成取消。重启后的历史使用各轮标记，不依赖当前会话状态推断。

工具状态仅来自实际 toolResult、当前 run 所属 call 的 toolProgress，以及实际停止的工具标记；partial assistant 中出现但没有开始执行的调用显示 not-run。旧工具缺结果不会因后来会话进入 running/stopping 而被标成正在执行或停止，历史与当前执行明确区分。

`getContextUsage()` 是 Pi 基于会话投影及模型报告的上下文估算。Moon 标注来源、估算性质和读取时点，不声称是精确计费或完整请求。压缩后 Pi 返回未知 tokens 时，用 `contextState` 表示等待下一次回复；未提供统计不显示虚构的 0%。每轮结束把统计写入官方 JSONL 的 `moon-context-usage` custom entry；重启只读恢复并标记 `restored`、保留原统计时点，不依赖存活的模型连接。旧历史未记录统计时明确未知，后续真实回复才更新。


## 桌面窗口生命周期

`window_lifecycle.rs` 管理任务栏窗口、托盘及关闭隐藏。官方 single-instance 插件在 setup 创建后端前执行，重复启动恢复已有宿主。关闭只隐藏 WebView，不改变草稿或服务状态；主动退出经 RunEvent 调用 ModelBackend.shutdown，停止标志阻止请求重建子进程，随后关闭 stdin 等待清理，超时终止子进程。Windows GUI 子系统覆盖 debug/release；setup 内部捕获启动错误、释放服务，再通过原生错误框报告。

## 持久化确认与传输边界

### 待处理消息与草稿

`ConversationQueue` 独立保存每个会话的可编辑待处理消息及请求回执。Moon 在 Pi 接收前持有内容，`turn_end` 将补充交给公开 `steer`，`agent_before_settle` 将后续消息交给公开 `followUp`；逐条和全部模式保留独立用户消息及材料归属。编辑、删除、模式切换通过同一会话锁和 revision 校验。进入交付后禁止修改，不访问 Pi 私有队列。失败、停止和重新打开会话暂停队列，明确继续才恢复；Pi JSONL 中的请求标记与真实用户项是跨进程交付对账依据。

会话草稿和未确认请求由前端独立存储，不被服务快照替换。发送确认只清除与原提交相同的草稿；继续上一回复不清除新草稿。传输结果未知时保留原请求 ID 和原输入，核对动作使用相同输入重试，不能将已编辑的新内容偷偷替换进去。桌面桥接明确标记后端拒绝，区别网络中断等未知结果。浏览器存储只保留材料引用，不保存图片正文或缩略图。

`inputAccepted` 由 Pi 公开的 `appendMessage` / `appendCustomMessageEntry` 成功返回确认；`message_end` 发生在保存之前，不能用来确认接受。JSONL 写入失败后禁止继续向同一内存树追加，释放活动 AgentSession，并从原文件验证恢复；截断文件保留并明确报错，不自动修复。未保存输入留在前端草稿，恢复后以新请求标识重发。

两个 HTTP 入口共用 `http-body.mjs`，按原始字节限制 1 MiB，收集完整字节后统一 UTF-8 解码，中文与 emoji 跨网络数据块仍完整。

Node 启动先建立轻量传输与运行锁，`$runtime` 只确认该唯一宿主已经可通信。Pi 及业务模块在首个业务请求时动态加载，同批请求共用初始化；失败释放候选服务并允许后续请求重新初始化。慢依赖加载不占用原生 30 秒启动握手期限，页面沿用读取中、错误和重试状态；退出过程中不允许迟到创建业务服务。


## 组件与接口目录

两项目录和正式应用共用 Vite 开发服务与最终 `dist/`，保持独立 HTML 入口；不新增后端、复制业务 DTO 或安装演示依赖。`main.tsx` 只装配主题与样式，Page/App 组合页面，控制器管理 URL 或请求生命周期，具体控件和相邻 `*.catalog.tsx` 定义归属各目录。

`scripts/build-frontend.mjs` 使用官方配置加载与 build API，顺序生成主应用和目录两张独立构建图；共享配置工厂每次创建新插件。组件展示的动态入口因此不参与主应用分块，避免共享构建图把产品代码拆碎。第一图清理旧产物并复制 public，第二图保留输出、使用 `assets/catalogs/` 且不重复复制公共资源；生成阶段校验同路径内容一致。两图保留标准 manifest，合并 manifest 对冲突键和依赖引用一起重命名，四个 HTML 地址不变。任一阶段失败都中止命令，Tauri 继续沿用 `pnpm build` 与同一 `frontendDist`；目录与主应用的少量运行库分图生成，换取每入口明确的加载边界。

`scripts/ui-catalog-plugin.ts` 在 Vite 中静态读取相邻展示定义，提取文档元数据而不执行 render，再从正式 JSX 导入及本地导出关系生成组成索引。主目录使用文档索引；iframe 只使用 ID/路径索引并动态导入所选定义。`source-loader.ts` 自身和对应 raw 文件在用户展开源码时才导入。概览一次只运行一个示例，独立画布保持实际视口尺寸；状态、查看方式、主题和宽高归 URL，面板切换与搜索是页面呈现状态。新增定义仍自动发现，无法静态解析的文档会定位到源码报错，避免静默遗漏。

`scripts/api-catalog-plugin.ts` 从正式 operations 生成导航索引；详细文档按接口生成，仅携带该接口定义与请求/返回所引用的 schema 闭包，不另写契约。阅读时只导入当前文档，打开调试才载入正式运行时校验模块和编辑/响应组件；字段表、移动导航与外观菜单分别按需加载。架构视图和正文在打开模块说明时导入，正文仍是原 ARCHITECTURE.md；调用适配器仅在执行时加载。接口字段表遍历正式 schema 的引用、数组和联合类型，并停止递归环。

`api-catalog/request-controller.ts` 按操作持有内存草稿和响应，全页最多一个显式调用。执行前经过 JSON 解析与正式 validateRequest；取消先解除当前请求身份，再中止传输，迟到成功或错误无法写回。导航和浏览器返回取消等待但保留各操作草稿；已提交的数据或已开始的任务不承诺回滚。忙时禁止修改当前调用参数，响应清空不清输入。密钥响应在目录展示边界遮蔽，调试内容不写本地持久存储。
