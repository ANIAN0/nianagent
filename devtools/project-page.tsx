import { useEffect, useState } from "react"
import { ChevronRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { ToolLayout } from "./tool-layout"
import { navigateTool, useToolSearch } from "./location"
import {
  codeModules,
  codeModuleFor,
  loadProject,
  componentsForFile,
  operationsForFile,
  componentHref,
  fileHref,
  apiHref,
  codeModuleHref,
} from "./content-index"
import type { ProjectFile, ProjectIndex } from "../scripts/project-index.mjs"

const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
const fileRole = (path: string) =>
  /contract|contracts/.test(path)
    ? "契约 / 类型"
    : /\.catalog\.tsx$|fixtures\//.test(path)
      ? "演示 / 场景"
      : /\.css$/.test(path)
        ? "样式"
        : /\.(json|toml|yaml|yml)$|config\./.test(path)
          ? "配置"
          : /\.(md|txt)$/.test(path)
            ? "说明"
            : /\.(tsx?|mjs|rs|js)$/.test(path)
              ? "实现"
              : "资源"
function status(file: ProjectFile) {
  if (file.gitStatus.conflicted) return "合并冲突"
  if (file.gitStatus.worktree === "D") return "工作目录已删除"
  if (file.gitStatus.index === "?") return "尚未跟踪"
  if (file.gitStatus.index !== " " || file.gitStatus.worktree !== " ")
    return "有本地变更"
  return "已跟踪"
}
export default function ProjectPage() {
  const search = useToolSearch()
  const params = new URLSearchParams(search)
  const selected = params.get("path") ?? ""
  const moduleId = params.get("module") ?? ""
  const query = params.get("q") ?? ""
  const mode = params.get("browse") === "directory" ? "directory" : "module"
  const [project, setProject] = useState<ProjectIndex>()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let disposed = false
    void loadProject()
      .then(
        (value) => {
          if (!disposed) {
            setProject(value)
            setError("")
          }
        },
        (cause: unknown) => {
          if (!disposed) setError(String(cause))
        }
      )
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [revision])
  const files = project?.files ?? []
  const needle = query.trim().toLowerCase()
  const matches = files.filter((file) =>
    `${file.path} ${file.purpose} ${codeModuleFor(file.path).title}`
      .toLowerCase()
      .includes(needle)
  )
  const file = files.find((item) => item.path === selected)
  const module = codeModules.find((item) => item.id === moduleId)
  const directories = new Set([""])
  for (const item of files)
    for (let parent = parentOf(item.path); parent; parent = parentOf(parent))
      directories.add(parent)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const update = (fields: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(search)
    Object.entries(fields).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key)
    )
    navigateTool(`/project/?${next}`, replace)
  }
  const select = (path: string) => update({ path, module: "" })
  const selectModule = (id: string) => update({ module: id, path: "" })
  const fileLink = (item: ProjectFile, full = false) => (
    <a
      href={fileHref(item.path)}
      aria-current={selected === item.path ? "page" : undefined}
      onClick={(event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) return
        event.preventDefault()
        select(item.path)
      }}
    >
      {full ? item.path : item.path.split("/").at(-1)}
    </a>
  )
  const toggle = (key: string, label: string, opened: boolean) => (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-expanded={opened}
      aria-label={`${opened ? "收起" : "展开"}${label}`}
      onClick={() =>
        setExpanded((previous) => ({ ...previous, [key]: !opened }))
      }
    >
      <ChevronRight className={opened ? "rotate-90" : undefined} />
    </Button>
  )
  const directoryTree = (directory: string, depth = 0) => (
    <div>
      {[...directories]
        .filter(
          (path) =>
            path &&
            parentOf(path) === directory &&
            (!needle ||
              matches.some((item) => item.path.startsWith(path + "/")))
        )
        .sort()
        .map((path) => {
          const opened =
            expanded[path] ??
            (!!needle || selected.startsWith(path + "/") || path === selected)
          return (
            <div key={path}>
              <div
                className="project-tree-row"
                style={{ paddingLeft: depth * 10 }}
              >
                {toggle(path, path, opened)}
                <a
                  href={fileHref(path)}
                  aria-current={selected === path ? "page" : undefined}
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey) return
                    event.preventDefault()
                    select(path)
                  }}
                >
                  {path.split("/").at(-1)}
                </a>
              </div>
              {opened && directoryTree(path, depth + 1)}
            </div>
          )
        })}
      {matches
        .filter((item) => parentOf(item.path) === directory)
        .map((item) => (
          <div
            className="project-tree-row"
            key={item.path}
            style={{ paddingLeft: depth * 10 + 26 }}
          >
            {fileLink(item)}
          </div>
        ))}
    </div>
  )
  const navigation = (
    <nav className="project-navigation" aria-label="项目结构目录">
      <div className="project-search">
        <Input
          aria-label="筛选模块或文件"
          placeholder="用途、路径或模块名"
          value={query}
          onChange={(event) => update({ q: event.target.value }, true)}
        />
        <Tabs value={mode} onValueChange={(browse) => update({ browse })}>
          <TabsList className="w-full">
            <TabsTrigger value="module">按模块</TabsTrigger>
            <TabsTrigger value="directory">按目录</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="project-tree moon-scrollbar">
        <a
          className="project-root-link"
          href="/project/"
          aria-current={!moduleId && !selected ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault()
            update({ path: "", module: "" })
          }}
        >
          项目总览
        </a>
        {mode === "directory"
          ? directoryTree("")
          : codeModules
              .filter(
                (item) =>
                  !needle ||
                  `${item.title} ${item.task}`.toLowerCase().includes(needle) ||
                  matches.some(
                    (file) => codeModuleFor(file.path).id === item.id
                  )
              )
              .map((item) => {
                const owned = matches.filter(
                  (file) => codeModuleFor(file.path).id === item.id
                )
                const opened =
                  expanded[`module:${item.id}`] ??
                  (moduleId === item.id ||
                    (!!file && codeModuleFor(file.path).id === item.id))
                return (
                  <div key={item.id}>
                    <div className="project-tree-row">
                      {toggle(`module:${item.id}`, item.title, opened)}
                      <a
                        href={codeModuleHref(item.id)}
                        aria-current={moduleId === item.id ? "page" : undefined}
                        onClick={(event) => {
                          if (event.ctrlKey || event.metaKey) return
                          event.preventDefault()
                          selectModule(item.id)
                        }}
                      >
                        {item.title}
                        <small>{owned.length}</small>
                      </a>
                    </div>
                    {opened && (
                      <div className="project-module-files">
                        {owned.map((file) => (
                          <div className="project-tree-row" key={file.path}>
                            {fileLink(file)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
        {!matches.length && !loading && <p>没有匹配文件。可清空筛选。</p>}
      </div>
    </nav>
  )
  const table = (items: ProjectFile[]) => (
    <div className="devtools-table-scroll">
      <table>
        <thead>
          <tr>
            <th>文件与角色</th>
            <th>具体用途</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.path}>
              <td>
                {fileLink(item, true)}
                <small className="project-file-meta">
                  {fileRole(item.path)} · {status(item)}
                </small>
              </td>
              <td>{item.purpose || "职责未补充"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  const related = (items: ProjectFile[]) => {
    const components = [
      ...new Map(
        items
          .flatMap((file) => componentsForFile(file.path))
          .map((entry) => [entry.id, entry])
      ).values(),
    ]
    const operations = [
      ...new Map(
        items.flatMap((file) => operationsForFile(file.path))
      ).entries(),
    ]
    return (
      <section>
        <h2>相关页面与接口</h2>
        <div className="reader-related">
          {components.map((entry) => (
            <a key={entry.id} href={componentHref(entry.id)}>
              {entry.name}
            </a>
          ))}
        </div>
        <div className="reader-related">
          {operations.map(([id, doc]) => (
            <a key={id} href={apiHref(id)}>
              {doc.definition.title} · {id}
            </a>
          ))}
        </div>
        {!components.length && !operations.length && (
          <p>当前没有明确登记的页面或接口关联。</p>
        )}
      </section>
    )
  }
  const refs = (paths: string[]) =>
    paths.length ? (
      <ul>
        {paths.map((path) => (
          <li key={path}>
            <a
              href={fileHref(path)}
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey) return
                event.preventDefault()
                select(path)
              }}
            >
              {path}
            </a>
          </li>
        ))}
      </ul>
    ) : (
      <p>
        未识别到静态引用。动态注册和跨语言使用可能未覆盖，不能据此认定文件无用。
      </p>
    )
  const directoryRule = (path: string): [string, string] =>
    project?.directories[path] ??
    (path ? directoryRule(parentOf(path)) : ["Moon", ""])
  return (
    <ToolLayout
      navigation={navigation}
      selectionKey={moduleId ? `module:${moduleId}` : selected || "overview"}
      navigationLabel="项目结构目录"
    >
      <article className="project-document">
        <div className="devtools-document-toolbar">
          <p className="reader-kicker">
            项目结构 / {module?.title || selected || "总览"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => {
              setLoading(true)
              setRevision((value) => value + 1)
            }}
          >
            <RefreshCw data-icon="inline-start" />
            刷新索引
          </Button>
        </div>
        {error && (
          <OperationFeedback
            title="文件索引读取失败"
            message={error}
            notify={false}
          />
        )}
        {!project && loading ? (
          <p role="status">正在读取项目文件…</p>
        ) : module ? (
          <>
            <header>
              <h1>{module.title}</h1>
              <p>{module.description}</p>
            </header>
            <h2>职责与边界</h2>
            <p>{module.boundary}</p>
            <p>
              入口：<a href={fileHref(module.entry)}>{module.entry}</a>
            </p>
            <h2>模块文件</h2>
            <p>逐文件用途来自同一职责登记；与按目录浏览使用相同文件记录。</p>
            {table(
              matches.filter(
                (file) => codeModuleFor(file.path).id === module.id
              )
            )}
            {related(
              files.filter((file) => codeModuleFor(file.path).id === module.id)
            )}
          </>
        ) : file ? (
          <>
            <header>
              <h1>{file.path.split("/").at(-1)}</h1>
              <p>
                <code>{file.path}</code>
              </p>
              <p>{file.purpose || "职责未补充"}</p>
            </header>
            <h2>职责与归属</h2>
            <p>{file.reason}</p>
            <div className="reader-related">
              <a href={codeModuleHref(codeModuleFor(file.path).id)}>
                {codeModuleFor(file.path).title}
              </a>
              <a href={`${fileHref(parentOf(file.path))}&browse=directory`}>
                所在目录：{parentOf(file.path) || "根目录"}
              </a>
            </div>
            <p className="reader-kicker">
              {fileRole(file.path)} · {status(file)}
            </p>
            <SourceFile key={file.path} file={file} />
            {!!file.declarations.length && (
              <section>
                <h2>可识别的导出声明</h2>
                <p className="reader-kicker">
                  从当前源文件提取名称与行号；动态导出和重导出可能未覆盖。
                </p>
                <ul>
                  {file.declarations.map((declaration) => (
                    <li key={`${declaration.name}:${declaration.line}`}>
                      <code>{declaration.name}</code> · 第 {declaration.line} 行
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <h2>被哪些位置使用</h2>
            {refs(file.usedBy)}
            {file.entries.map((value) => (
              <p key={value}>{value}</p>
            ))}
            <details>
              <summary>此文件引用的位置</summary>
              {refs(file.references)}
            </details>
            {related([file])}
          </>
        ) : selected && directories.has(selected) ? (
          <>
            <header>
              <h1>{selected}</h1>
              <p>{directoryRule(selected)[0]}</p>
            </header>
            <h2>目录职责</h2>
            <p>{directoryRule(selected)[1]}</p>
            <h2>子目录</h2>
            <div className="reader-related">
              {[...directories]
                .filter((path) => path && parentOf(path) === selected)
                .sort()
                .map((path) => (
                  <a
                    key={path}
                    href={`${fileHref(path)}&browse=directory`}
                    onClick={(event) => {
                      event.preventDefault()
                      select(path)
                    }}
                  >
                    {path.split("/").at(-1)} /
                  </a>
                ))}
            </div>
            <h2>{needle ? "匹配文件" : "直属文件"}</h2>
            {table(
              matches.filter((file) =>
                needle
                  ? file.path.startsWith(selected + "/")
                  : parentOf(file.path) === selected
              )
            )}
          </>
        ) : selected || moduleId ? (
          <>
            <h1>找不到此条目</h1>
            <p>当前索引没有 {selected || moduleId}，可能已经移动或删除。</p>
            <a href="/project/">返回项目总览</a>
          </>
        ) : (
          <>
            <header>
              <h1>理解 Moon 的项目结构</h1>
              <p>
                Moon 是本地 Agent 应用。前端组织用户操作，Node 宿主承载业务、Pi
                和持久化，Tauri 管理桌面能力；插件在明确边界扩展具体功能。
              </p>
            </header>
            <h2>从要做的事开始</h2>
            <table>
              <thead>
                <tr>
                  <th>要理解或修改什么</th>
                  <th>查看模块</th>
                </tr>
              </thead>
              <tbody>
                {codeModules.map((item) => (
                  <tr key={item.id}>
                    <td>{item.task}</td>
                    <td>
                      <a
                        href={codeModuleHref(item.id)}
                        onClick={(event) => {
                          event.preventDefault()
                          selectModule(item.id)
                        }}
                      >
                        {item.title}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h2>职责与协作</h2>
            <p>
              用户在页面操作，经功能服务进入共享
              RPC。业务注册表将操作分派给宿主模块，Pi 适配器处理 Agent
              运行，桌面命令处理窗口与系统能力。界面从结果和订阅读取事实，草稿与原操作身份保持独立。
            </p>
            <div className="reader-overview-grid">
              {codeModules.map((item) => (
                <a
                  key={item.id}
                  className="reader-overview-card"
                  href={codeModuleHref(item.id)}
                  onClick={(event) => {
                    event.preventDefault()
                    selectModule(item.id)
                  }}
                >
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                  <small>
                    {
                      files.filter(
                        (file) => codeModuleFor(file.path).id === item.id
                      ).length
                    }{" "}
                    个文件
                  </small>
                </a>
              ))}
            </div>
            <h2>根目录文件</h2>
            {table(matches.filter((file) => !parentOf(file.path)))}
          </>
        )}
        <details className="project-evidence">
          <summary>
            索引范围与维护状态 · {files.length} 个文件 /{" "}
            {project?.issues.length ?? 0} 项待核对
          </summary>
          <p>{project?.scope}</p>
          <p>
            文件路径、引用与当前状态来自实时索引，具体用途在
            project-purposes.json
            中维护；缺少说明仍列出。源码读取仅限本机开发环境。
          </p>
          {project?.issues.length ? (
            <ul>
              {project.issues.map((issue) => (
                <li key={`${issue.path}:${issue.code}`}>
                  {issue.path}：{issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <p>当前索引未报告职责登记问题。</p>
          )}
        </details>
      </article>
    </ToolLayout>
  )
}
function SourceFile({ file }: { file: ProjectFile }) {
  const [text, setText] = useState<string>()
  if (file.diskState !== "file")
    return <p>此文件当前不可读取：{file.diskState}。</p>
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open && text === undefined)
          void fetch(
            `/__devtools/source?path=${encodeURIComponent(file.path)}`
          ).then(
            async (response) => setText(await response.text()),
            () => setText("源码读取失败，请重试。")
          )
      }}
    >
      <summary>查看当前正式源码</summary>
      <pre>
        <code>{text ?? "展开后读取"}</code>
      </pre>
    </details>
  )
}
