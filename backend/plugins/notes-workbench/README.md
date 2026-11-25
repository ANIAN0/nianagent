# 笔记工作台（notes-workbench）

用户与多个 Agent 围绕文档、白板和 UI 产物协作审阅的本机工作台。Agent 通过 MCP
发布内容，用户在界面阅读、划选评论、比较版本、继续讨论。

## 服务可用条件

- 可以从 Moon 插件页打开，也可从仓库根目录运行 `pnpm --filter @moon/workbench dev` 单独启动。
  使用 `MOON_NOTES_DATA_DIR` 指向已有插件数据目录。Moon 会复用端口和两个模块目录匹配的工作台。
- 管理端 `http://127.0.0.1:<port>/`（默认 19830），允许本机程序直接访问。
- MCP 服务（mcp-service 插件，默认 19826）需在 Moon 插件页启用，并在「Agent 专属
  凭据」区为每个 Agent 登记专属凭据；工具选择需包含 notes-workbench 的共享工具。
- 数据根为插件数据目录：`v2/`（SQLite + 封存产物）。

## 入口

- **工作台界面**：插件页直接打开；左侧项目 → 目录 → 草稿导航，支持搜索与类型
  筛选（文档/白板/界面），草稿可改名、移动、归档恢复。
- **MCP 工具面**：list_projects/create_project/update_project；
  list_directories/create_directory/update_directory；list_drafts/create_draft/update_draft；
  stage_package/publish_version；list_versions/read_version/read_asset/list_targets/compare_versions；
  create_thread/add_reply/set_thread_status/list_threads/read_thread/open_version。
  发布、元数据和讨论写操作要求客户端生成 requestKey（幂等；同键异输入明确拒绝）。
  stage_package 接收 sourceDir/kind，返回封存 artifactId；随后发布绑定该 artifactId。
- **固定版本深链**：发布/打开返回 openUrl（`#v2?draft=&version=&compare=`），不携带
  任何长期凭据。

## 内容类型

| 类型     | 包要求                                                           | 评论定位                                      |
| -------- | ---------------------------------------------------------------- | --------------------------------------------- |
| markdown | 恰一个根级 `.md` 正文 + 随包图片                                 | 块引用 + 引文（服务端唯一解析；emoji 按码点） |
| board    | 恰一个根级 `.canvas`（JSON Canvas 子集：text/group 节点 + edge） | 对象 id（服务端校验存在）                     |
| ui       | 恰一个根级 `preview.json` 路由清单（`/` 必须声明）+ 自包含页面   | 页面 + 元素描述 + 视口（桥采集）              |

发布内容为封存快照：删除 Agent 源目录不影响已发布版本的阅读与资源。

## 版本与讨论

- 首次发布生成 V1，此后每次发布绑定 baseSequence（过期明确冲突）；重放同 requestKey
  返回原结果，不重复发布。
- 线程固定创建时版本；新版本不自动解决意见，历史意见保留原归属；用户可解决任何线
  程，Agent 只能处理自己发起的线程。
- 审阅修订号（reviewRevision）单调递增，仅表示有新讨论活动，用于「有更新」提示；
  用户主动刷新读取新意见，避免覆盖当前阅读、选区与输入。

## 开发与复验

在仓库根目录运行 `pnpm tauri dev`，宿主通过本机 HTTP 连接 Next.js 工作台。设置 `MOON_WORKBENCH_DEV=1` 可指定使用 Next.js 开发服务。
正式回归源码位于对应领域的 `.test.mjs`，运行数据只写入独立临时目录并自行清理。
固定规模样本生成规则位于 `scripts/workbench/test-fixtures/scale.mjs`，只接受调用者提供的空隔离目录，
不得将真实数据目录作为验收夹具。
