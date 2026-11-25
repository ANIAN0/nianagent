import { execFileSync } from "node:child_process"
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs"
import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { Worker, isMainThread, parentPort } from "node:worker_threads"

export const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
)
const registryFile = resolve(projectRoot, "devtools/project-purposes.json")
/** Explicit directory ownership, also used to check newly introduced directories. */
export const directoryRules = {
  "": [
    "Moon 本地 Agent 应用",
    "根目录只保留运行入口、工具配置和正式使用说明。",
  ],
  ".github": [
    "共享检查与发行流程",
    "自动化流程与运行源码分开，检查使用同一项目命令。",
  ],
  apps: [
    "独立工作台应用",
    "工作台页面、同源 HTTP 入口与服务器适配集中在 apps/workbench。",
  ],
  src: [
    "正式网页应用",
    "React 只持有界面状态，通过共享 RPC 调用本机或远程宿主。",
  ],
  "src/components": [
    "跨功能共享组件",
    "共同外观与交互集中维护；功能专属状态留在 features。",
  ],
  "src/components/ui": [
    "shadcn 基础组件与相邻演示",
    "正式调用和组件目录复用同一变体。",
  ],
  "src/components/composer": [
    "首页与会话共享输入组合",
    "正文、材料与工具栏按同一输入语义组合。",
  ],
  "src/components/feedback": [
    "操作反馈与状态呈现",
    "提示只承载结果，恢复行为由原业务所有者提供。",
  ],
  "src/contracts": [
    "生成的共享调用类型",
    "从业务/桌面契约生成，禁止手工维护第二套字段。",
  ],
  "src/features": [
    "按用户功能组织页面与状态",
    "一个功能的页面、服务和草稿归在同一边界。",
  ],
  "src/lib": ["跨功能的协议和状态协调", "业务专属实现不放入通用工具。"],
  backend: [
    "Node 本机业务服务与契约",
    "Pi SDK、持久化和业务执行留在宿主，不进入正式网页包。",
  ],
  "backend/plugins": [
    "应用插件的 host / pi / web 贡献",
    "同一能力跨端聚合，运行环境按 manifest 入口区分；共享契约不激活插件。",
  ],
  "backend/extensions": [
    "Pi 扩展适配",
    "沿用 Pi 扩展边界，与应用插件的生命周期分开。",
  ],
  "src-tauri": [
    "桌面程序与原生配置",
    "桌面拥有进程、系统选择器、数据迁移和更新。",
  ],
  "src-tauri/src": [
    "Rust 桌面能力",
    "原生命令由 lib.rs 显式注册，DTO 从桌面契约生成。",
  ],
  "src-tauri/icons": [
    "桌面图标",
    "产品图标由 Tauri 配置引用，不属于临时构建产物。",
  ],
  "src-tauri/capabilities": [
    "桌面权限声明",
    "原生权限与网页业务权限分别管理。",
  ],
  scripts: [
    "开发检查、生成和构建工具",
    "服务于现有命令与 CI，可保留登记用途的正式回归源码；过程脚本与运行产物放在 .dev。",
  ],
  "scripts/release-verifier": [
    "发行签名校验程序",
    "静态校验安装包签名和版本，开发运行不安装产品。",
  ],
  public: ["网页静态资源与最早启动表面", "静态入口不依赖 React 装载成功。"],
  "public/fonts": ["本地字体和许可证", "正式字体资源无需外部 CDN。"],
  patches: [
    "按版本维护第三方依赖补丁",
    "由 pnpm-workspace.yaml 绑定并随依赖一起验证。",
  ],
  devtools: [
    "文件职责与模块边界登记",
    "project-purposes.json 与 project-modules.ts 服务治理脚本，不承载产品页面。",
  ],
  docs: [
    "正式使用与协议说明文档",
    "插件规范等版本管理的正文；只维护说明，不承载可执行源码。",
  ],
  ".github/workflows": [
    "CI检查与Windows发行流程",
    "检查复用本地命令；发行需单独的明确触发。",
  ],
  "src/components/operations": [
    "原操作核对与结果恢复组件",
    "复用同一操作身份和恢复反馈，不让每个页面另造核对流程。",
  ],
  "src/features/home": [
    "工作台导航与新会话起点",
    "工作区、模型和输入组合属于启动一次会话的连续任务。",
  ],
  "src/features/conversation": [
    "真实会话页面与所有者状态",
    "读取、执行、下一稿、回执和阅读位置分别维护，页面负责组合。",
  ],
  "src/features/conversation/composer": [
    "会话输入、队列和上下文入口",
    "运行中消息与空闲输入共享正式输入卡，保留下一稿归属。",
  ],
  "src/features/conversation/controls": [
    "会话命令与分支操作",
    "命令、压缩、重试和分支沿原操作身份呈现。",
  ],
  "src/features/conversation/messages": [
    "会话正文、工具和历史投影",
    "按真实轮次和执行步骤展示，长结果局部阅读。",
  ],
  "src/features/conversation/permissions": [
    "工具权限与逐次审批",
    "会话权限候选与实际待审批调用分开表达。",
  ],
  "src/features/extensions": [
    "Pi扩展的配置与页面贡献",
    "Pi扩展来源管理与应用插件的启停生命周期分开。",
  ],
  "src/features/materials": [
    "消息材料选择、预览及重试来源",
    "准备材料不等于发送或采用；草稿材料与原上传身份保持对应。",
  ],
  "src/features/mcp": [
    "MCP配置与工具目录验证",
    "配置编辑、显式测试与工具目录状态按同一服务管理。",
  ],
  "src/features/models": [
    "模型连接、目录、选择与授权",
    "连接密钥、模型参数和授权操作有独立编辑及回执边界。",
  ],
  "src/features/plugins": [
    "应用插件设置与网页贡献装配",
    "公共宿主只管理声明入口、启停和配置，不解释插件业务载荷。",
  ],
  "src/features/session": [
    "会话工具与项目指令配置",
    "候选配置在应用成功后生效，与模型对话执行分开。",
  ],
  "src/features/settings": [
    "应用设置导航、存储、更新与开发入口",
    "共用设置壳和离开守卫，各分区持有自己的业务状态。",
  ],
  "src/features/startup": [
    "首次启动与正常启动恢复页面",
    "宿主和profile确认完成后再挂载工作台，错误保留恢复入口。",
  ],
  "src/features/workspaces": [
    "本地工作区登记与选择",
    "记住选择和目录可用性，不承担扫描工作区内容。",
  ],
  "src/lib/composer": [
    "跨页面输入草稿与材料归属工具",
    "首页和会话共用输入语义，业务提交仍由各所有者负责。",
  ],
  "src/lib/maintenance": [
    "前端维护冻结与保存协调",
    "数据迁移/更新前汇总实际保存和释放结果。",
  ],
  "src/lib/navigation": [
    "页面离开前的未保存保护",
    "各编辑器注册守卫，外壳只协调离开动作。",
  ],
  "src/lib/operations": [
    "原写入、回执和恢复草稿协调",
    "结果未知继续核对原身份，不创建无依据的重发。",
  ],
  "src/lib/rpc": [
    "本机与远程共享RPC调用边界",
    "正式调用只选择传输，操作名和载荷沿同一业务契约。",
  ],
  "backend/extensions/modules/example-note": [
    "内置便笺扩展的Pi入口",
    "在Pi扩展边界注册便笺能力，与网页贡献配合。",
  ],
  "backend/plugins/file-workbench": [
    "文件工作栏的宿主、Pi与网页贡献",
    "文件预览、Git差异和选区引用共享只读宿主及材料边界。",
  ],
  "backend/plugins/selection-translate": [
    "全局划词翻译插件",
    "插件启停绑定桌面宿主内的快捷键和译文窗口。",
  ],
  "backend/plugins/screen-pin": [
    "Windows 全局截图与置顶贴图",
    "插件管理快捷键和桌面窗口生命周期。",
  ],
  "backend/plugins/opencli": [
    "OpenCLI安装管理和显式浏览器绑定",
    "官方软件与后台由插件拥有，可信共享契约不激活连接。",
  ],
  "backend/plugins/memos": [
    "Memos 直连插件的宿主、Pi 与网页贡献",
    "直连自托管 Memos HTTP API，分离公开配置与实例凭据，提供读写分离工具。",
  ],
  "backend/plugins/keydex": [
    "Keydex 直连插件的宿主、Pi 与网页贡献",
    "自动发现并直连本机 Keydex agent-server HTTP 接口，提供读写分离的 PM、知识库、协作与通知工具。",
  ],
  "backend/plugins/filebrowser": [
    "FileBrowser直连插件的宿主、Pi与网页贡献",
    "兼容已归档的 FileBrowser 既有实例，通过 HTTP 提供读写分离工具并在文件完整下载后提交。",
  ],
  "backend/plugins/remote-access": [
    "evework连接、远程目录和文件上传",
    "连接身份、客户端归属和上传材料保持在同一插件边界。",
  ],
  "backend/plugins/remote-access/noise": [
    "远程Noise通道及消息分帧",
    "加密握手与业务RPC调度分开，网页和宿主复用协议。",
  ],
  "public/fonts/source-han-sans": [
    "思源黑体变量字体及正式许可证",
    "产品正常显示不依赖外部字体服务。",
  ],
  "src-tauri/nsis": [
    "Windows安装器脚本",
    "只有明确发行构建使用，不用于日常dev部署。",
  ],
  "scripts/release-verifier/src": [
    "发行签名校验入口",
    "使用Rust验证已生成的安装包与产品版本。",
  ],
}

export function directoryRule(path) {
  let directory = path
  while (!Object.hasOwn(directoryRules, directory)) {
    const parent = directory.includes("/")
      ? directory.slice(0, directory.lastIndexOf("/"))
      : ""
    if (parent === directory) break
    directory = parent
  }
  return {
    scope: directory,
    responsibility: directoryRules[directory]?.[0],
    reason: directoryRules[directory]?.[1],
  }
}
export function prohibitedReason(path, purpose = "") {
  if (
    /(^|\/)(?:\.dev|node_modules|target|dist|dist-ssr|coverage|\.cache|__pycache__|\.pytest_cache|playwright-report|test-results)(\/|$)/i.test(
      path
    )
  )
    return "过程、依赖、缓存或构建产物禁止进入 Git"
  if (
    /(^|\/)(?:tests?|__tests__|e2e|__snapshots__)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.snap$/i.test(
      path
    )
  )
    if (
      !/^(?:backend|scripts)\/.*\.test\.mjs$/.test(path) ||
      !purpose.startsWith("正式回归：")
    )
      return "仅允许明确登记用途的正式回归源码；临时测试与测试产物放在 .dev"
  if (
    /(?:\.log|\.tmp|\.temp|\.bak|\.tsbuildinfo|\.pyc)$|(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/i.test(
      path
    )
  )
    return "临时文件或机器产物禁止进入 Git"
  if (/^(?:AGENTS|DESIGN|ARCHITECTURE)\.md$|^\.agents\//.test(path))
    return "本地规则和开发规范应保留在已忽略位置"
  if (
    /\.(?:md|html|txt)$/i.test(path) &&
    /(?:^|\/)(?:task|plan|review|report|acceptance|implementation|verification|design-proposal)(?:[-_.]|$)/i.test(
      path
    )
  )
    return "开发过程材料应保留在 .dev"
  return null
}
function inspectFile(path) {
  const absolute = resolve(projectRoot, path)
  if (!absolute.startsWith(projectRoot + sep)) return "non-regular"
  try {
    for (
      let current = absolute;
      current !== projectRoot;
      current = dirname(current)
    ) {
      if (lstatSync(current).isSymbolicLink()) return "non-regular"
    }
    if (!lstatSync(absolute).isFile()) return "non-regular"
    accessSync(absolute, constants.R_OK)
    return "file"
  } catch (error) {
    return error.code === "ENOENT" || error.code === "ENOTDIR"
      ? "missing"
      : "unreadable"
  }
}
function git(args) {
  return execFileSync("git", ["--no-optional-locks", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  })
}
/** Fixed-root, read-only collection. An empty index and a failed Git command are different results. */
export function collectProject() {
  const root = git(["rev-parse", "--show-toplevel"]).trim()
  if (resolve(root).toLowerCase() !== projectRoot.toLowerCase())
    throw new Error("Git 根目录与 Moon 仓库不一致。")
  const tracked = [
    ...new Set(
      git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean)
    ),
  ].sort()
  // -z preserves spaces and Unicode paths, and emits rename source as a second record.
  const records = git([
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]).split("\0")
  const statuses = new Map()
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const index = record[0]
    const worktree = record[1]
    const conflicted = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(
      index + worktree
    )
    statuses.set(record.slice(3), { index, worktree, conflicted })
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C")
      i++
  }
  const stagedDeletions = [...statuses]
    .filter(([path, status]) => status.index === "D" && !tracked.includes(path))
    .map(([path]) => path)
  const registered = JSON.parse(readFileSync(registryFile, "utf8"))
  const set = new Set(tracked)
  const files = tracked.map((path) => ({
    path,
    purpose: registered[path] ?? "",
    diskState: inspectFile(path),
    gitStatus: statuses.get(path) ?? {
      index: " ",
      worktree: " ",
      conflicted: false,
    },
    references: [],
    usedBy: [],
    entries: [],
    declarations: [],
    ...directoryRule(
      path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
    ),
  }))
  const byPath = new Map(files.map((file) => [file.path, file]))
  const resolveReference = (owner, reference) => {
    const base = reference.startsWith("@/")
      ? "src/" + reference.slice(2)
      : reference.startsWith("/")
        ? reference.slice(1)
        : reference.startsWith(".")
          ? resolve(dirname(resolve(projectRoot, owner)), reference)
              .slice(projectRoot.length + 1)
              .split(sep)
              .join("/")
          : reference
    const candidates = [
      base,
      ...[
        ".ts",
        ".tsx",
        ".mjs",
        ".js",
        ".json",
        ".css",
        "/index.ts",
        "/index.tsx",
      ].map((suffix) => base + suffix),
    ]
    if (/\.js$/.test(base))
      candidates.push(base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx")
    if (reference.startsWith("/")) candidates.push(`public/${base}`)
    if (
      !reference.startsWith("@/") &&
      !reference.startsWith("/") &&
      !reference.startsWith(".")
    )
      candidates.push(
        `${owner.includes("/") ? owner.slice(0, owner.lastIndexOf("/")) + "/" : ""}${reference}`
      )
    return candidates.find((candidate) => set.has(candidate))
  }
  for (const file of files) {
    // A purpose registration documents existence; it cannot prove runtime use.
    if (file.path === "devtools/project-purposes.json") continue
    if (
      file.diskState !== "file" ||
      !/\.(?:tsx?|[cm]?js|html|css|rs|json|toml|ya?ml)$/.test(file.path)
    )
      continue
    let source
    try {
      source = readFileSync(resolve(projectRoot, file.path), "utf8")
    } catch (error) {
      file.diskState =
        error.code === "ENOENT" || error.code === "ENOTDIR"
          ? "missing"
          : "unreadable"
      continue
    }
    const found = new Set()
    if (/\.(?:tsx?|mjs|js)$/.test(file.path)) {
      for (const match of source.matchAll(
        /^export\s+(?:declare\s+)?(?:async\s+)?(?:default\s+)?(?:function|class|const|let|type|interface)\s+([A-Za-z_$][\w$]*)/gm
      ))
        file.declarations.push({
          name: match[1],
          line: source.slice(0, match.index).split("\n").length,
        })
    }
    for (const match of source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(?|(?:src|href)\s*=\s*|\burl\(\s*|new URL\s*\(\s*)["']([^"']+)["']/g
    )) {
      const target = resolveReference(file.path, match[1].split("?")[0])
      if (target && target !== file.path) found.add(target)
    }
    if (file.path.endsWith(".json")) {
      for (const match of source.matchAll(/["']((?:\.{1,2}\/)[^"'\n]+)["']/g)) {
        const target = resolveReference(file.path, match[1])
        if (target && target !== file.path) found.add(target)
      }
      if (file.path.endsWith("/manifest.json")) {
        const manifest = JSON.parse(source)
        for (const entry of Object.values(manifest.entries ?? {})) {
          if (typeof entry !== "string") continue
          const target = resolveReference(
            file.path,
            entry.startsWith(".") ? entry : `./${entry}`
          )
          if (target && target !== file.path) found.add(target)
        }
      }
    }
    for (const match of source.matchAll(/\bmod\s+(\w+)\s*;/g)) {
      const target = resolveReference(file.path, `./${match[1]}.rs`)
      if (target) found.add(target)
    }
    // Configuration and generated handler registrations use literal paths.
    if (/\.(?:json|html)$|^vite\.config\.ts$/.test(file.path))
      for (const match of source.matchAll(
        /["']((?:src|backend|scripts|public|devtools|icons|capabilities)\/[^"'\n*]+)["']/g
      )) {
        const target = resolveReference(file.path, match[1])
        if (target && target !== file.path) found.add(target)
      }
    file.references = [...found]
    for (const path of found) byPath.get(path).usedBy.push(file.path)
    if (/\/manifest\.json$/.test(file.path))
      file.entries.push("由应用插件 manifest 发现")
    if (
      /^(?:index\.html|src-tauri\/src\/(?:main|lib)\.rs|backend\/rpc\.mjs)$/.test(
        file.path
      )
    )
      file.entries.push("正式运行或开发入口")
    if (
      /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig.*\.json|vite\.config\.ts|eslint\.config\.js|components\.json|\.github\/|\.git|\.prettier|src-tauri\/(?:Cargo|tauri|build)|scripts\/release-verifier\/Cargo)/.test(
        file.path
      )
    )
      file.entries.push("工具链 / 配置入口")
    if (/^public\//.test(file.path))
      file.entries.push("由网页静态资源目录提供；具体资源引用可能由运行时产生")
  }
  const issues = []
  for (const file of files) {
    if (file.gitStatus.conflicted) {
      issues.push({
        path: file.path,
        code: "git-conflict",
        message: "Git 存在尚未解决的合并冲突",
      })
      continue
    }
    if (file.gitStatus.worktree === "D") {
      // Validate the working tree without requiring a staging side effect.
      // Git-confirmed deletion still needs its documentation and callers removed.
      if (Object.hasOwn(registered, file.path))
        issues.push({
          path: file.path,
          code: "stale",
          message: "文件已删除，请同步移除用途登记",
        })
      if (file.usedBy.length)
        issues.push({
          path: file.path,
          code: "referenced-deleted",
          message: `已删除文件仍被引用：${file.usedBy.join("、")}`,
        })
      continue
    }
    const forbidden = prohibitedReason(file.path, file.purpose)
    if (forbidden)
      issues.push({ path: file.path, code: "prohibited", message: forbidden })
    if (file.diskState !== "file")
      issues.push({
        path: file.path,
        code: file.diskState,
        message: {
          missing: "工作目录中未找到文件；本次 Git 状态未确认为删除",
          unreadable: "文件无法读取，请核对读取权限和文件状态",
          "non-regular": "路径不是可安全读取的普通文件（包括符号链接）",
        }[file.diskState],
      })
    if (!file.purpose.trim())
      issues.push({
        path: file.path,
        code: "undocumented",
        message: "缺少具体用途登记",
      })
    const top = file.path.includes("/") ? file.path.split("/")[0] : ""
    if (!Object.hasOwn(directoryRules, top))
      issues.push({
        path: file.path,
        code: "directory",
        message: "新增顶层目录未声明职责与允许内容",
      })
  }
  const pendingRegistrations = []
  for (const path of Object.keys(registered))
    if (!set.has(path)) {
      if (existsSync(resolve(projectRoot, path)))
        pendingRegistrations.push(path)
      else
        issues.push({
          path,
          code: "stale",
          message: "用途登记已无对应文件；删除或重命名时同步维护登记",
        })
    }
  return {
    root: "Moon",
    files,
    issues,
    pendingRegistrations,
    stagedDeletions,
    directories: directoryRules,
    scope:
      "Git 跟踪及未忽略的工作目录文件；内容及可识别引用读取当前工作目录。依赖、构建产物及 .dev 内部材料不进入资料。TS/JS 字面量导入、HTML 资源、Rust mod 和配置路径仅提供静态线索，动态注册、宏及跨语言引用可能未覆盖。",
    readAt: new Date().toISOString(),
  }
}
/** Keep filesystem collection off Vite's event loop; each explicit read has one short-lived worker. */
export function collectProjectAsync() {
  return new Promise((accept, reject) => {
    const worker = new Worker(resolve(projectRoot, "scripts/project-index.mjs"))
    let settled = false
    worker.once("message", (result) => {
      settled = true
      accept(result)
    })
    worker.once("error", (error) => {
      settled = true
      reject(error)
    })
    worker.once("exit", (code) => {
      if (!settled) reject(new Error(`项目索引收集未完成（退出码 ${code}）。`))
    })
  })
}
if (!isMainThread) parentPort.postMessage(collectProject())
else if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = collectProject()
  for (const issue of result.issues)
    console.error(`${issue.path}: ${issue.message}`)
  if (result.issues.length) process.exitCode = 1
  else
    console.log(
      `文件治理通过：${result.files.length} 个 Git 跟踪文件；${result.pendingRegistrations.length} 项登记等待 Git 跟踪。`
    )
}
