import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import {
  basename,
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
} from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import {
  packagedWorkbenchEntry,
  packagedWorkbenchPath,
  workbenchAppPath,
} from "../backend/workbench-paths.mjs"
import {
  nodeVersion,
  packagingEnvironment,
  projectRoot,
} from "./release-settings.mjs"

const inventoryName = "moon-runtime-resources.json"
const pathKey = (path) => resolve(path).toLowerCase()
const inside = (root, path) => {
  const local = relative(root, path)
  return (
    local === "" ||
    (!isAbsolute(local) &&
      local !== ".." &&
      !local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  )
}

// 普通资源清单覆盖 SDK 的数据、WASM 和许可；不能只靠入口导入判断包是否完整。
async function ordinaryFiles(directory) {
  const root = resolve(directory)
  const files = new Map()
  async function visit(path) {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !inside(root, path))
      throw new Error("运行资源不能包含链接或越过资源目录")
    if (entry.isDirectory()) {
      if (pathKey(await realpath(path)) !== pathKey(path))
        throw new Error("拒绝通过 reparse 目录读取运行资源")
      for (const name of (await readdir(path)).sort())
        await visit(resolve(path, name))
    } else if (entry.isFile())
      files.set(relative(root, path).replaceAll("\\", "/"), entry.size)
    else throw new Error("运行资源只能包含普通文件和目录")
  }
  await visit(root)
  return files
}

function safeRelativePath(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.includes(":") ||
    Array.from(name).some((character) => character.codePointAt(0) < 32) ||
    /^[\\/]/.test(name)
  )
    throw new Error("运行资源路径不安全")
  const parts = name.replaceAll("\\", "/").split("/")
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)
    )
  )
    throw new Error("运行资源路径不安全")
  return parts.join("/")
}

export async function writeRuntimeInventory(directory) {
  const files = await ordinaryFiles(directory)
  files.delete(inventoryName)
  for (const name of files.keys()) safeRelativePath(name)
  await writeFile(
    resolve(directory, inventoryName),
    `${JSON.stringify({ format: 1, nodeVersion, platform: "win32", architecture: "x64", files: Object.fromEntries(files) }, null, 2)}\n`
  )
}

async function verifyInventory(directory, files) {
  const inventory = JSON.parse(
    await readFile(resolve(directory, inventoryName), "utf8")
  )
  if (
    inventory.format !== 1 ||
    inventory.nodeVersion !== nodeVersion ||
    inventory.platform !== "win32" ||
    inventory.architecture !== "x64" ||
    !inventory.files ||
    Array.isArray(inventory.files)
  )
    throw new Error("缺少匹配本次 Windows x64 的正式运行资源清单")
  const expected = new Map()
  for (const [name, size] of Object.entries(inventory.files)) {
    const local = safeRelativePath(name)
    if (
      local !== name ||
      name === inventoryName ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      expected.has(name.toLowerCase())
    )
      throw new Error("运行资源清单内容不合法")
    expected.set(name.toLowerCase(), size)
    if (files.get(name) !== size)
      throw new Error(`安装包运行资源缺失或大小不符：${name}`)
  }
  if (files.size !== expected.size + 1)
    throw new Error("安装包运行资源与正式清单不一致")
}

async function packageGraph(directory) {
  const packages = new Map()
  async function add(path) {
    const manifest = JSON.parse(
      await readFile(resolve(path, "package.json"), "utf8")
    )
    if (
      typeof manifest.name !== "string" ||
      typeof manifest.version !== "string"
    )
      throw new Error("运行依赖缺少包名或版本")
    const entry = { directory: path, manifest }
    packages.set(pathKey(path), entry)
    await modules(resolve(path, "node_modules"))
    return entry
  }
  async function modules(path) {
    const names = await readdir(path).catch((error) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    for (const name of names.sort()) {
      if (name.startsWith(".")) continue
      if (name.startsWith("@")) {
        for (const member of (await readdir(resolve(path, name))).sort())
          await add(resolve(path, name, member))
      } else await add(resolve(path, name))
    }
  }
  const root = await add(directory)
  function find(parent, name) {
    if (
      !/^(?:@[^/\\:]+\/)?[^/\\:]+$/.test(name) ||
      name === "." ||
      name === ".."
    )
      throw new Error("运行依赖名称不合法")
    if (parent.manifest.name === name && parent.manifest.exports) return parent
    for (
      let cursor = parent.directory;
      inside(directory, cursor);
      cursor = dirname(cursor)
    ) {
      if (basename(cursor) !== "node_modules") {
        const found = packages.get(
          pathKey(resolve(cursor, "node_modules", name))
        )
        if (found) return found
      }
      if (pathKey(cursor) === pathKey(directory)) break
    }
    return null
  }
  return { root, packages, find }
}

function platformMatches(list, actual) {
  if (!Array.isArray(list)) return true
  const positive = list.filter((value) => !value.startsWith("!"))
  return (
    !list.includes(`!${actual}`) &&
    (!positive.length || positive.includes(actual) || positive.includes("any"))
  )
}

// 验收脚本自身无 npm 依赖，草稿恢复无需安装仓库 node_modules。
// 范围/锁解析复用待验 Pi 正式依赖，先验证其固定版本及普通包内路径。
async function runtimeParser(graph, name, version) {
  const coding = graph.find(graph.root, "@earendil-works/pi-coding-agent")
  const dependency = coding && graph.find(coding, name)
  if (
    !dependency ||
    coding.manifest.dependencies?.[name] !== version ||
    dependency.manifest.name !== name ||
    dependency.manifest.version !== version
  )
    throw new Error(`运行依赖缺少锁定的 ${name}`)
  const entry = resolve(
    dependency.directory,
    dependency.manifest.main ?? "index.js"
  )
  if (!inside(dependency.directory, entry) || !(await lstat(entry)).isFile())
    throw new Error("运行依赖入口不能越界")
  return (await import(pathToFileURL(entry).href)).default
}

export async function verifyRuntimeDependencies(directory) {
  const root = resolve(directory)
  const files = await ordinaryFiles(root)
  const graph = await packageGraph(root)
  const semver = await runtimeParser(graph, "semver", "7.8.5")
  const yaml = await runtimeParser(graph, "yaml", "2.9.0")
  const lock = yaml.parse(
    await readFile(resolve(root, "pnpm-lock.yaml"), "utf8")
  )
  if (!lock.packages || !lock.importers?.["."])
    throw new Error("运行依赖缺少独立部署锁")
  const lockedTarget = (entry) =>
    Boolean(
      lock.packages[`${entry.manifest.name}@${entry.manifest.version}`] ||
      Object.values(lock.packages).some(
        (item) =>
          item.name === entry.manifest.name &&
          item.version === entry.manifest.version
      )
    )
  let edges = 0
  for (const parent of graph.packages.values()) {
    if (
      !semver.valid(parent.manifest.version) ||
      (parent !== graph.root && !lockedTarget(parent))
    )
      throw new Error("实际运行依赖版本未绑定独立部署锁")
    const dependencies = new Map()
    for (const [name, range] of Object.entries(
      parent.manifest.dependencies ?? {}
    ))
      dependencies.set(name, { range, optional: false })
    for (const [name, range] of Object.entries(
      parent.manifest.optionalDependencies ?? {}
    ))
      dependencies.set(name, { range, optional: true })
    const constraints = [...dependencies].concat(
      Object.entries(parent.manifest.peerDependencies ?? {}).map(
        ([name, range]) => [
          name,
          {
            range,
            optional:
              parent.manifest.peerDependenciesMeta?.[name]?.optional === true,
          },
        ]
      )
    )
    for (const [name, { range: declared, optional }] of constraints) {
      const target = graph.find(parent, name)
      if (!target) {
        if (optional) continue
        throw new Error(`运行依赖缺少必需包：${name}`)
      }
      if (
        !platformMatches(target.manifest.os, "win32") ||
        !platformMatches(target.manifest.cpu, "x64")
      )
        throw new Error(`运行依赖目标平台不符：${name}`)
      let range = declared
      let actualName = name
      if (typeof range !== "string") throw new Error("运行依赖版本声明不合法")
      if (range.startsWith("npm:")) {
        const alias = /^npm:(@[^/]+\/[^@]+|[^@/]+)@(.+)$/.exec(range)
        if (!alias) throw new Error("运行依赖 alias 未绑定真实包")
        ;[, actualName, range] = alias
      }
      // pnpm deploy 将根声明改成含 peer context 的锁 locator，不能把 context 当 SemVer。
      const rootBinding =
        parent === graph.root &&
        lock.importers["."].dependencies?.[name]?.version === declared
      if (
        !semver.validRange(range) &&
        rootBinding &&
        semver.valid(range.split("(")[0])
      )
        range = range.split("(")[0]
      if (/^(file|link|workspace):/.test(range)) {
        const bindings = Object.entries(lock.packages).filter(
          ([key, item]) =>
            (key === range || key === `${actualName}@${range}`) &&
            item.name === target.manifest.name &&
            item.version === target.manifest.version
        )
        if (bindings.length !== 1)
          throw new Error("路径依赖无法绑定部署锁中的实际包与版本")
      } else if (
        target.manifest.name !== actualName ||
        !semver.validRange(range) ||
        !semver.satisfies(target.manifest.version, range)
      )
        throw new Error(`运行依赖实际版本不满足声明：${name}`)
      edges++
    }
  }
  return { files, graph, packages: graph.packages.size - 1, edges }
}

function loaderEnvironment(temporary) {
  const environment = packagingEnvironment()
  for (const name of [
    "NODE_OPTIONS",
    "NODE_PATH",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "OPENCLI_DAEMON_PORT",
  ])
    delete environment[name]
  const home = resolve(temporary, "home")
  const drive = parse(home).root
  return {
    ...environment,
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: drive.replace(/[\\/]+$/, ""),
    HOMEPATH: home.slice(drive.length - 1),
    APPDATA: resolve(home, "AppData/Roaming"),
    LOCALAPPDATA: resolve(home, "AppData/Local"),
    XDG_CONFIG_HOME: resolve(home, ".config"),
    XDG_DATA_HOME: resolve(home, ".local/share"),
    XDG_CACHE_HOME: resolve(home, ".cache"),
    PI_CODING_AGENT_DIR: resolve(temporary, "agent"),
    MOON_DATA_DIR: resolve(temporary, "data"),
    TEMP: temporary,
    TMP: temporary,
  }
}

async function ownedTemporary(prefix, action) {
  const parent = resolve(projectRoot, ".dev/packaging")
  for (const path of [resolve(projectRoot, ".dev"), parent]) {
    await mkdir(path, { recursive: true })
    if (
      (await lstat(path)).isSymbolicLink() ||
      pathKey(await realpath(path)) !== pathKey(path)
    )
      throw new Error("拒绝通过链接创建打包临时目录")
  }
  const directory = await mkdtemp(resolve(parent, prefix))
  let result
  let failure
  try {
    result = await action(directory)
  } catch (error) {
    failure = error
  }
  try {
    if (
      dirname(directory) !== parent ||
      !basename(directory).startsWith(prefix)
    )
      throw new Error("拒绝清理越界的打包目录")
    await ordinaryFiles(directory)
    await rm(directory, { recursive: true })
  } catch (error) {
    if (failure)
      throw new AggregateError(
        [failure, error],
        "运行资源验收失败且自有临时目录未能清理",
        { cause: error }
      )
    throw error
  }
  if (failure) throw failure
  return result
}

export async function verifyRuntimeResources(directory) {
  const root = resolve(directory)
  const { files, graph, packages, edges } =
    await verifyRuntimeDependencies(root)
  await verifyInventory(root, files)
  const workbench = `${packagedWorkbenchPath}/${workbenchAppPath}`
  for (const name of [
    "NODE-LICENSE.txt",
    "rpc.mjs",
    "services.mjs",
    "runtime.mjs",
    "migration-worker.mjs",
    "migration-launcher.mjs",
    packagedWorkbenchEntry,
    `${workbench}/.next/BUILD_ID`,
    `${workbench}/.next/server/app/notes/page.js`,
    `${workbench}/.next/server/app/skills/page.js`,
    `${workbench}/node_modules/next/package.json`,
    "plugins/file-workbench/manifest.json",
    "plugins/memos/manifest.json",
    "plugins/keydex/manifest.json",
    "plugins/filebrowser/manifest.json",
    "plugins/opencli/manifest.json",
    "plugins/selection-translate/manifest.json",
    "plugins/remote-access/manifest.json",
    "plugins/mcp-service/manifest.json",
    "plugins/agents-md/manifest.json",
    "plugins/logs/manifest.json",
    "plugins/notes-workbench/manifest.json",
    "plugins/notes-workbench/tool-catalog.mjs",
    "plugins/skill-workbench/manifest.json",
    "plugins/skill-workbench/tool-catalog.mjs",
  ])
    if (!files.has(name)) throw new Error(`安装包缺少正式运行入口：${name}`)
  if (
    ![...files.keys()].some((name) =>
      name.startsWith(`${workbench}/.next/static/`)
    )
  )
    throw new Error("安装包缺少工作台静态资源")
  const pluginEntries = []
  for (const name of [...files.keys()].filter((name) =>
    /^plugins\/[a-z][a-z0-9-]{0,63}\/manifest\.json$/.test(name)
  )) {
    const pluginDirectory = dirname(resolve(root, name))
    const manifest = JSON.parse(await readFile(resolve(root, name), "utf8"))
    if (manifest.id !== basename(pluginDirectory) || !manifest.entries)
      throw new Error(`安装包插件清单无效：${name}`)
    for (const [kind, exported] of [
      ["app", "activate"],
      ["pi", "default"],
    ]) {
      const entry = manifest.entries[kind]
      if (entry === undefined) continue
      if (
        typeof entry !== "string" ||
        isAbsolute(entry) ||
        entry.split(/[\\/]/).includes("..") ||
        !entry.endsWith(".mjs")
      )
        throw new Error(`安装包插件服务器入口无效：${name}`)
      const target = resolve(pluginDirectory, entry)
      const local = relative(root, target).replaceAll("\\", "/")
      if (!inside(pluginDirectory, target) || !files.has(local))
        throw new Error(`安装包缺少插件服务器入口：${local}`)
      pluginEntries.push({ path: target, exported })
    }
  }
  await ownedTemporary("runtime-loader-", async (temporary) => {
    const environment = loaderEnvironment(temporary)
    await mkdir(environment.USERPROFILE)
    const executable = resolve(root, "node.exe")
    const version = spawnSync(
      executable,
      [
        "-e",
        "process.stdout.write(JSON.stringify({version:process.versions.node,platform:process.platform,architecture:process.arch,home:require('node:os').homedir()}))",
      ],
      { cwd: root, encoding: "utf8", env: environment, timeout: 15000 }
    )
    if (version.status !== 0) throw new Error("安装包内 Node 无法执行")
    const actual = JSON.parse(version.stdout)
    if (
      actual.version !== nodeVersion ||
      actual.platform !== "win32" ||
      actual.architecture !== "x64" ||
      typeof actual.home !== "string" ||
      pathKey(actual.home) !== pathKey(environment.USERPROFILE)
    )
      throw new Error("安装包内 Node 版本、架构或用户目录隔离不符")
    const script = `
      import { realpath } from 'node:fs/promises';
      import { relative, isAbsolute } from 'node:path';
      import { fileURLToPath, pathToFileURL } from 'node:url';
      const root = ${JSON.stringify(root)};
      try {
        for (const name of ${JSON.stringify(Object.keys(graph.root.manifest.dependencies ?? {}))}) {
          const target = await realpath(fileURLToPath(import.meta.resolve(name)));
          const local = relative(root, target);
          if (isAbsolute(local) || local === '..' || local.startsWith('..\\\\')) throw new Error('outside');
          await import(name);
        }
        for (const name of ['services.mjs', 'runtime.mjs']) await import(pathToFileURL(root + '/' + name).href);
        for (const entry of ${JSON.stringify(pluginEntries)}) {
          const module = await import(pathToFileURL(entry.path).href);
          if (typeof module[entry.exported] !== 'function') throw new Error('plugin_entry_contract');
        }
        const launcher = await import(pathToFileURL(root + '/migration-launcher.mjs').href);
        const worker = await launcher.loadMigrationWorker();
        if (typeof worker.runMigrationAction !== 'function' || typeof worker.inspectMigrationMetadata !== 'function') throw new Error('worker_contract');
      } catch { process.exitCode = 1; }
    `
    const loaded = spawnSync(
      executable,
      ["--input-type=module", "-e", script],
      { cwd: root, encoding: "utf8", env: environment, timeout: 60000 }
    )
    if (loaded.status !== 0)
      throw new Error(
        "安装包内 SDK、服务、插件或迁移入口无法从实际运行资源完整加载"
      )
  })
  console.info(
    `正式运行资源完整：${files.size} 个文件，${packages} 个依赖包，${edges} 条版本约束，包内 Node/SDK/worker及${pluginEntries.length}个插件服务器入口加载通过`
  )
}

async function sevenZip() {
  const executable =
    process.env.MOON_PACKAGING_7ZIP ??
    resolve(process.env.ProgramFiles ?? "C:/Program Files", "7-Zip/7z.exe")
  if (
    !isAbsolute(executable) ||
    basename(executable).toLowerCase() !== "7z.exe" ||
    !(await lstat(executable)).isFile()
  )
    throw new Error(
      "正式安装包验收需要完整 7-Zip CLI；请提供自有目录内的 MOON_PACKAGING_7ZIP"
    )
  const probe = spawnSync(executable, ["i"], {
    encoding: "utf8",
    env: packagingEnvironment(),
    timeout: 15000,
  })
  if (probe.status !== 0 || !/\bNsis\b/i.test(probe.stdout))
    throw new Error("7-Zip CLI 不支持真实 NSIS 归档解码")
  return executable
}

export async function verifyRuntimePackage(installer) {
  const archive = resolve(installer)
  if (!(await lstat(archive)).isFile() || !(await stat(archive)).size)
    throw new Error("缺少真实 NSIS 安装包")
  const executable = await sevenZip()
  const listing = spawnSync(
    executable,
    ["l", "-slt", "-ba", "-sccUTF-8", archive],
    {
      encoding: "utf8",
      env: packagingEnvironment(),
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
    }
  )
  if (listing.status !== 0) throw new Error("无法列出实际 NSIS 资源")
  const names = new Set()
  const blocks = listing.stdout
    .split(/\r?\n\r?\n/)
    .filter((block) => block.trim().length > 0)
  if (!blocks.length) throw new Error("NSIS 归档没有资源清单")
  const properties = new Set([
    "Path",
    "Size",
    "Packed Size",
    "Modified",
    "Created",
    "Accessed",
    "Attributes",
    "Method",
    "Solid",
    "Offset",
    "Folder",
    "CRC",
    "Encrypted",
  ])
  for (const block of blocks) {
    const keys = new Set()
    for (const line of block.split(/\r?\n/).filter(Boolean)) {
      const separator = line.indexOf(" = ")
      const key = line.slice(0, separator)
      // 技术文本不允许额外行/重复字段，避免文件名中的换行伪装成另一条路径。
      if (separator < 0 || !properties.has(key) || keys.has(key))
        throw new Error("NSIS 资源清单包含无法安全解析的字段或链接")
      keys.add(key)
    }
    if (!keys.has("Path"))
      throw new Error("NSIS 非空资源记录必须包含唯一完整路径")
    const name = /^Path = (.*)$/m.exec(block)?.[1]?.replace(/\r$/, "")
    const safe = safeRelativePath(name)
    if (
      names.has(safe.toLowerCase()) ||
      /^(?:Symbolic Link|Hard Link|Reparse[^=]*) = /m.test(block) ||
      /^Attributes = .*l/im.test(block)
    )
      throw new Error("NSIS 归档包含冲突路径或链接")
    names.add(safe.toLowerCase())
  }
  await ownedTemporary("nsis-resources-", async (directory) => {
    // 仅解码 installer 的归档数据，不执行安装器、hook 或注册表操作。
    const extracted = spawnSync(
      executable,
      ["x", "-y", "-sccUTF-8", `-o${directory}`, archive],
      {
        encoding: "utf8",
        env: packagingEnvironment(),
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      }
    )
    if (extracted.status !== 0) throw new Error("NSIS 资源静态提取失败")
    const files = await ordinaryFiles(directory)
    // 资源 map 唯一固定入口是 runtime/；SDK 示例中的同名目录不是应用入口。
    if (!files.has("runtime/package.json"))
      throw new Error("NSIS 归档缺少固定正式 runtime 目录")
    await verifyRuntimeResources(resolve(directory, "runtime"))
  })
  console.info("实际 NSIS 静态解包及全部正式运行依赖验收通过（未执行安装器）")
}
