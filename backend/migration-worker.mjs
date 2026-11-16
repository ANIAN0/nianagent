import { randomUUID } from "node:crypto"
import {
  lstat,
  readdir,
  readFile,
  mkdir,
  open,
  rename,
  rmdir,
  stat,
  statfs,
} from "node:fs/promises"
import { createReadStream } from "node:fs"
import {
  join,
  dirname,
  relative,
  resolve,
  isAbsolute,
  basename,
} from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir, homedir } from "node:os"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import lockfile from "proper-lockfile"
import { ConversationStore } from "./conversation-store.mjs"
import { validateOfflineStorage } from "./storage-offline.mjs"
import { withAcquiredLock } from "./atomic-file.mjs"
/** 只有本模块固定说明可公开；JSON/FS/SDK异常绝不按文本语言猜测安全性。 */
export class MigrationError extends Error {
  constructor(message, publicCode = "dataInvalid") {
    super(message)
    this.name = "MoonMigrationError"
    this.code = "migration_validation"
    this.publicCode = publicCode
  }
}
const exec = promisify(execFile)
const within = (root, path) => {
  const part = relative(resolve(root), resolve(path))
  return part !== "" && !part.startsWith("..") && !isAbsolute(part)
}
const equal = (a, b) =>
  process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b)
async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
}
async function noLinks(path) {
  let current = resolve(path)
  while (true) {
    if (await exists(current)) {
      const info = await lstat(current)
      if (info.isSymbolicLink())
        throw new MigrationError("路径包含链接或junction，未开始迁移。")
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}
const uuidPattern =
  "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
function atomicTemporary(relativePath) {
  const path = relativePath.replaceAll("\\", "/")
  if (new RegExp(`^runtime\\.json\\.${uuidPattern}\\.tmp$`, "i").test(path))
    return true
  const name = basename(path).match(
    new RegExp(`^\\.(.+)-${uuidPattern}\\.tmp$`, "i")
  )?.[1]
  if (!name) return false
  const target = join(dirname(path), name).replaceAll("\\", "/")
  return (
    [
      "models.json",
      "workspaces.json",
      "agent/mcp.json",
      "session-config/sessions.json",
      "plugins/configuration.json",
      "extensions/configuration.json",
      "conversations/index.json",
    ].includes(target) ||
    new RegExp(`^materials/(?:[a-f0-9]{64}|${uuidPattern})\\.json$`, "i").test(
      target
    ) ||
    new RegExp(
      `^materials/uploads/${uuidPattern}/(?:owner|reservation-isolated)\\.json$`,
      "i"
    ).test(target) ||
    /^(?:conversation-permissions|conversation-commands|conversations\/(?:controls|queue|request-receipts))\/[a-zA-Z0-9_/-]+\.json$/.test(
      target
    ) ||
    /^conversations\/(?:operation-receipts|retired-items|retired-requests)\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\.json$/.test(
      target
    ) ||
    /^(?:models\.json\.receipts|agent\/mcp\.json\.receipts|extensions\/configuration\.json\.receipts)\/[A-Za-z0-9_-]{1,128}\.json$/.test(
      target
    ) ||
    /^plugins\/remote-access\/connection\.json$/.test(target)
  )
}
const excluded = (name, relativePath) =>
  [
    ".moon-data.lock",
    ".moon-migration.json",
    "runtime.json",
    "runtime.json.lock",
    "conversations.lock",
    "session-config.lock",
    "extensions.lock",
    "agent.lock",
    "workspaces.json.lock",
  ].includes(relativePath) ||
  (new RegExp(`^\\.moon-write-${uuidPattern}\\.tmp$`, "i").test(name) &&
    [".", "maintenance", "updates"].includes(
      dirname(relativePath).replaceAll("\\", "/")
    )) ||
  atomicTemporary(relativePath) ||
  relativePath === "tmp"
async function files(root, destinationPrefix = "", full = false) {
  if (!(await exists(root))) return []
  const result = []
  async function walk(directory, prefix) {
    await noLinks(directory)
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name)
      const path = join(prefix, entry.name)
      if (!full && excluded(entry.name, path)) continue
      const info = await lstat(source)
      if (info.isSymbolicLink())
        throw new MigrationError("Moon数据包含链接或junction，原目录保留。")
      if (info.isDirectory()) await walk(source, path)
      else if (info.isFile())
        result.push({
          source,
          relative: join(destinationPrefix, path),
          bytes: info.size,
        })
      else throw new MigrationError("数据目录包含不支持的文件类型。")
    }
  }
  await walk(root, "")
  return result
}
async function parse(file) {
  return JSON.parse(await readFile(file, "utf8"))
}
function visit(value, action) {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const item of value) visit(item, action)
    return
  }
  action(value)
  for (const item of Object.values(value)) visit(item, action)
}
// 单行上限使异常历史可诊断；普通二进制始终流式复制，不进入Node Buffer。
const maximumJsonBytes = 64 * 1024 * 1024
async function* jsonLines(file) {
  let pending = ""
  for await (const chunk of createReadStream(file, { encoding: "utf8" })) {
    pending += chunk
    let newline
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, "")
      pending = pending.slice(newline + 1)
      if (Buffer.byteLength(line) > maximumJsonBytes)
        throw new MigrationError("会话历史单条记录过大，原数据保留。")
      if (line.trim()) yield JSON.parse(line)
    }
    if (Buffer.byteLength(pending) > maximumJsonBytes)
      throw new MigrationError("会话历史单条记录过大，原数据保留。")
  }
  if (pending.trim()) yield JSON.parse(pending)
}
async function readDeclaredJson(path) {
  if ((await stat(path)).size > maximumJsonBytes)
    throw new MigrationError("结构化数据文件过大，原数据保留，请先排查该记录。")
  return parse(path)
}
async function assertReadable(path) {
  const file = await open(path, "r")
  try {
    if (!(await file.stat()).isFile())
      throw new MigrationError("迁移引用不是普通文件。")
    await file.read(Buffer.alloc(1), 0, 1, 0)
  } finally {
    await file.close()
  }
}
async function outputReferences(entries, record) {
  const imported = new Map()
  for (const file of entries.filter(
    (entry) =>
      entry.relative.startsWith(join("conversations", "pi")) &&
      entry.relative.endsWith(".jsonl")
  )) {
    for await (const entry of jsonLines(file.source)) {
      if (entry.type !== "message" || entry.message?.role !== "toolResult")
        continue
      visit(entry.message.details, (object) => {
        if (
          typeof object.fullOutputPath === "string" &&
          isAbsolute(object.fullOutputPath)
        )
          imported.set(object.fullOutputPath, null)
      })
    }
  }
  for (const source of imported.keys()) {
    await noLinks(source)
    if (!(await exists(source))) {
      imported.delete(source)
      continue
    }
    // 只接受正式历史明确引用的Pi输出，绝不扫描系统Temp。新根的历史tmp同样必须保留。
    let destination
    if (
      within(join(record.sourceDirectory, "tmp"), source) &&
      /^pi-.*\.log$/.test(basename(source))
    )
      destination = relative(record.sourceDirectory, source)
    else if (within(join(record.sourceDirectory, "tool-output"), source))
      destination = relative(record.sourceDirectory, source)
    else if (
      record.legacy &&
      within(record.legacyTempDirectory || tmpdir(), source) &&
      /^pi-.*\.log$/.test(basename(source))
    )
      destination = join("tool-output", basename(source))
    else {
      imported.delete(source)
      continue
    }
    const info = await lstat(source)
    if (!info.isFile()) throw new MigrationError("历史工具输出不是普通文件。")
    imported.set(source, destination)
    if (!entries.some((entry) => equal(entry.source, source)))
      entries.push({ source, relative: destination, bytes: info.size })
  }
  return imported
}
async function validateMigrationTarget(record) {
  const source = resolve(record.sourceDirectory)
  const target = resolve(record.targetDirectory)
  if (
    !isAbsolute(record.targetDirectory) ||
    equal(source, target) ||
    within(source, target) ||
    within(target, source) ||
    [record.legacyTempDirectory, tmpdir()]
      .filter(Boolean)
      .some((root) => equal(root, target) || within(root, target)) ||
    dirname(target) === target ||
    [
      homedir(),
      process.env.APPDATA,
      process.env.LOCALAPPDATA,
      process.env.PUBLIC,
    ]
      .filter(Boolean)
      .some((root) => equal(root, target) || within(target, root)) ||
    equal(target, record.installDirectory) ||
    equal(target, join(record.installDirectory, "runtime")) ||
    within(join(record.installDirectory, "runtime"), target) ||
    within(target, record.installDirectory) ||
    [record.legacyProfileDirectory, record.controlDirectory]
      .filter(Boolean)
      .some(
        (root) =>
          equal(root, target) || within(root, target) || within(target, root)
      )
  )
    throw new MigrationError(
      "目标必须是独立的新空数据目录，不能与旧数据、旧profile、控制目录或runtime嵌套。",
      "targetInvalid"
    )
  if (record.kind !== "initialize") await noLinks(source)
  await noLinks(target)
  if (!(await exists(dirname(target))))
    throw new MigrationError(
      "目标父目录不存在，请先选择存在的可写位置。",
      "targetInvalid"
    )
  if (await exists(target)) {
    if (!(await lstat(target)).isDirectory())
      throw new MigrationError("目标不是目录。", "targetInvalid")
    if ((await readdir(target)).length) {
      let sameOperation = false
      try {
        const marker = await parse(join(target, ".moon-migration.json"))
        sameOperation =
          marker.operationId === record.operationId &&
          marker.dataSetId === record.dataSetId &&
          (record.kind !== "initialize" || marker.kind === "initialize")
      } catch {
        /* 非同次操作不能接管。 */
      }
      if (!sameOperation)
        throw new MigrationError(
          "目标目录已有文件，请选择新的空目录。",
          "targetInvalid"
        )
    }
  }
}
async function sourceEntries(record) {
  const source = resolve(record.sourceDirectory)
  const entries = await files(source)
  if (record.legacyProfileDirectory) {
    entries.push(
      ...(await files(record.legacyProfileDirectory, "webview")).filter(
        (entry) => !entry.relative.startsWith(join("webview", "logs"))
      )
    )
    entries.push(
      ...(await files(join(record.legacyProfileDirectory, "logs"), "logs"))
    )
  }
  return entries
}
async function summary(entries, record) {
  const destinations = new Map()
  for (const entry of entries) {
    const destination =
      process.platform === "win32"
        ? entry.relative.toLowerCase()
        : entry.relative
    const previous = destinations.get(destination)
    if (previous && !equal(previous.source, entry.source))
      throw new MigrationError(
        "迁移来源包含映射到同一目标的文件，请先处理同名来源。原目录保留，未复制或覆盖。",
        "dataInvalid"
      )
    destinations.set(destination, entry)
  }
  entries.splice(0, entries.length, ...destinations.values())
  const totalBytes = entries.reduce((sum, file) => sum + file.bytes, 0)
  const space = await statfs(dirname(record.targetDirectory))
  const availableBytes = Number(space.bavail) * Number(space.bsize)
  if (
    availableBytes <
    totalBytes + Math.max(64 * 1024 * 1024, totalBytes * 0.1)
  )
    throw new MigrationError(
      "目标磁盘可用空间不足，原目录保留。",
      "insufficientSpace"
    )
  return { totalBytes, availableBytes, fileCount: entries.length }
}
/** 用户确认前只枚举文件元数据，不能调用读取Pi历史内容的outputReferences。 */
export async function inspectMigrationMetadata(record) {
  await validateMigrationTarget(record)
  // 不导入时只检查独立空目标与空间，不能枚举或读取旧数据/profile来阻断用户选择。
  if (record.kind === "initialize") return summary([], record)
  const entries = await sourceEntries(record)
  return summary(entries, record)
}
export async function inspectMigration(record) {
  await validateMigrationTarget(record)
  const entries = await sourceEntries(record)
  const imported = await outputReferences(entries, record)
  return {
    entries,
    imported,
    ...(await summary(entries, record)),
  }
}
function mappedPath(path, record, requiredRoot) {
  if (typeof path !== "string" || !isAbsolute(path)) return path
  if (
    !equal(requiredRoot || record.sourceDirectory, path) &&
    !within(requiredRoot || record.sourceDirectory, path)
  )
    return path
  return join(record.targetDirectory, relative(record.sourceDirectory, path))
}
function transformValue(value, relativePath, record, imported, line = false) {
  const piRoot = join(record.sourceDirectory, "conversations", "pi")
  if (relativePath === join("conversations", "index.json"))
    for (const item of value.conversations || [])
      item.sessionFile = mappedPath(item.sessionFile, record, piRoot)
  if (
    relativePath.startsWith(join("conversations", "controls") + "/") ||
    relativePath.startsWith(join("conversations", "controls") + "\\")
  )
    for (const item of value.operations || []) {
      if (typeof item.targetSessionFile === "string")
        item.targetSessionFile = mappedPath(
          item.targetSessionFile,
          record,
          piRoot
        )
      for (const instruction of item.configuration?.instructions || [])
        instruction.path = mappedPath(
          instruction.path,
          record,
          join(record.sourceDirectory, "agent")
        )
    }
  if (line) {
    if (value.type === "session" && value.parentSession)
      value.parentSession = mappedPath(value.parentSession, record, piRoot)
    if (value.type === "message" && value.message?.role === "toolResult")
      visit(value.message.details, (item) => {
        if (imported.has(item.fullOutputPath))
          item.fullOutputPath = join(
            record.targetDirectory,
            imported.get(item.fullOutputPath)
          )
      })
  }
  // 只访问拥有schema声明的材料字段，绝不递归改未知自定义项或冻结原请求payload。
  const mapMaterial = (item) => {
    if (
      !item ||
      !["附件", "Skill"].includes(item.kind) ||
      typeof item.source !== "string"
    )
      return
    for (const root of [
      join(record.sourceDirectory, "materials"),
      join(record.sourceDirectory, "agent"),
    ])
      item.source = mappedPath(item.source, record, root)
  }
  if (
    within("materials", relativePath) &&
    ["file", "directory", "image", "skill"].includes(value.type)
  )
    for (const root of [
      join(record.sourceDirectory, "materials"),
      join(record.sourceDirectory, "agent"),
    ])
      value.source = mappedPath(value.source, record, root)
  if (
    within(join("conversations", "queue"), relativePath) &&
    Array.isArray(value.items)
  )
    for (const item of value.items)
      for (const material of item.materials || []) mapMaterial(material)
  if (relativePath === join("session-config", "sessions.json"))
    for (const session of Object.values(value.sessions || {}))
      for (const instruction of session.instructions || [])
        instruction.path = mappedPath(
          instruction.path,
          record,
          join(record.sourceDirectory, "agent")
        )
  if (line && value.type === "custom" && value.customType === "moon-materials")
    for (const material of value.data?.materials || []) mapMaterial(material)
  return value
}
function declaredJson(path) {
  return (
    path === join("conversations", "index.json") ||
    path === join("session-config", "sessions.json") ||
    (path.endsWith(".json") &&
      [
        "materials",
        join("conversations", "controls"),
        join("conversations", "queue"),
      ].some((root) => within(root, path)))
  )
}
async function copyEntry(entry, target, record, imported) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  if (
    entry.relative.endsWith(".jsonl") &&
    within(join("conversations", "pi"), entry.relative)
  ) {
    const file = await open(target, "wx", 0o600)
    try {
      for await (const value of jsonLines(entry.source))
        await file.writeFile(
          JSON.stringify(
            transformValue(value, entry.relative, record, imported, true)
          ) + "\n"
        )
      await file.sync()
      return (await file.stat()).size
    } finally {
      await file.close()
    }
  }
  if (declaredJson(entry.relative)) {
    const content = Buffer.from(
      JSON.stringify(
        transformValue(
          await readDeclaredJson(entry.source),
          entry.relative,
          record,
          imported
        ),
        null,
        2
      )
    )
    await writeSynced(target, content)
    return content.length
  }
  // 创建新文件并逐块复制，不能让CopyFile携带源文件较宽的Windows ACL。
  const file = await open(target, "wx", 0o600)
  try {
    for await (const chunk of createReadStream(entry.source))
      await file.writeFile(chunk)
    await file.sync()
    const size = (await file.stat()).size
    if (size !== entry.bytes)
      throw new MigrationError("复制期间文件大小发生变化，原目录保留。")
    return size
  } finally {
    await file.close()
  }
}

async function writeSynced(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const file = await open(path, "w", 0o600)
  try {
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
  }
}
async function privateStage(path, complete = false) {
  if (process.platform !== "win32") return
  // 固定.NET ACL API避免依赖父进程PowerShell模块状态；仅处理本操作新建stage。
  const script =
    "$ErrorActionPreference='Stop'; $p=$env:MOON_STAGE; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $items=@($p); if($env:MOON_STAGE_COMPLETE -eq '1'){$items+=@([IO.Directory]::EnumerateFileSystemEntries($p,'*',[IO.SearchOption]::AllDirectories))}; foreach($item in $items){if(([IO.File]::GetAttributes($item) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'unsafe link'}; $dir=[IO.Directory]::Exists($item); if($dir){$a=[System.Security.AccessControl.DirectorySecurity]::new()}else{$a=[System.Security.AccessControl.FileSecurity]::new()}; if($dir){$prior=[IO.Directory]::GetAccessControl($item)}else{$prior=[IO.File]::GetAccessControl($item)}; if($prior.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){$a.SetOwner($sid)}; $a.SetAccessRuleProtection($true,$false); foreach($s in @($sid.Value,'S-1-5-18','S-1-5-32-544')){$inherit=if($dir){'ContainerInherit,ObjectInherit'}else{'None'}; $r=[System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($s),'FullControl',$inherit,'None','Allow');$a.AddAccessRule($r)}; if($dir){[IO.Directory]::SetAccessControl($item,$a);$actual=[IO.Directory]::GetAccessControl($item)}else{[IO.File]::SetAccessControl($item,$a);$actual=[IO.File]::GetAccessControl($item)}; if($actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or -not $actual.AreAccessRulesProtected){throw 'unsafe owner'}; foreach($r in $actual.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')){throw 'unsafe ACL'}}}"
  await exec(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: {
        ...process.env,
        MOON_STAGE: path,
        MOON_STAGE_COMPLETE: complete ? "1" : "0",
      },
      windowsHide: true,
    }
  )
}

async function sourceLease(record) {
  return (await exists(record.sourceDirectory))
    ? await lockfile.lock(join(record.sourceDirectory, "runtime.json"), {
        realpath: false,
        lockfilePath: join(record.sourceDirectory, "runtime.json.lock"),
        retries: 0,
      })
    : async () => {}
}
export async function copyMigration(record, progress = () => {}) {
  const release = await sourceLease(record)
  return withAcquiredLock(release, async () => {
    const inspected = await inspectMigration(record)
    let staging = join(
      dirname(record.targetDirectory),
      `.Moon迁移-${record.operationId}`
    )
    const retainedCopies = Array.isArray(record.retainedCopies)
      ? [...record.retainedCopies]
      : []
    const reportRetained = () =>
      progress({
        phase: "copying",
        completedFiles: 0,
        totalFiles: inspected.fileCount,
        retainedCopies: [...new Set(retainedCopies)],
      })
    await noLinks(staging)
    let stageMarker = join(staging, ".moon-migration.json")
    if ((await exists(staging)) && (await readdir(staging)).length) {
      let marker
      try {
        marker = await parse(stageMarker)
      } catch (error) {
        if (!(error instanceof SyntaxError) && error.code !== "ENOENT")
          throw error
      }
      if (
        marker?.operationId === record.operationId &&
        marker?.dataSetId === record.dataSetId
      ) {
        // Only a verified stage belongs to this operation and may be renamed.
        const retained = `${staging}-interrupted-${randomUUID()}`
        await rename(staging, retained)
        retainedCopies.push(retained)
      } else {
        // Unknown partial markers stay at their exact original path. A fresh
        // attempt must not keep retrying the same unreadable marker forever.
        retainedCopies.push(staging)
        staging = `${staging}-attempt-${randomUUID()}`
        stageMarker = join(staging, ".moon-migration.json")
        retainedCopies.push(staging)
      }
      reportRetained()
    }
    await mkdir(staging, { recursive: true, mode: 0o700 })
    const markerTemporary = join(staging, `.moon-write-${randomUUID()}.tmp`)
    await writeSynced(
      markerTemporary,
      JSON.stringify({
        operationId: record.operationId,
        dataSetId: record.dataSetId,
      })
    )
    await rename(markerTemporary, stageMarker)
    await privateStage(staging)
    const expected = new Map()
    let copiedBytes = 0
    for (const [index, entry] of inspected.entries.entries()) {
      if (entry.relative === "moon-data.json") continue
      const bytes = await copyEntry(
        entry,
        join(staging, entry.relative),
        record,
        inspected.imported
      )
      expected.set(entry.relative, bytes)
      copiedBytes += bytes
      progress({
        phase: "copying",
        completedFiles: index + 1,
        totalFiles: inspected.fileCount,
        copiedBytes,
      })
    }
    let minimumAppVersion = "0.1.0"
    if (await exists(join(record.sourceDirectory, "moon-data.json"))) {
      const sourceMarker = await parse(
        join(record.sourceDirectory, "moon-data.json")
      )
      if (
        sourceMarker.dataSetId !== record.dataSetId ||
        sourceMarker.schemaVersion !== 1 ||
        typeof sourceMarker.minimumAppVersion !== "string"
      )
        throw new MigrationError("源数据集身份或兼容版本不匹配，原目录保留。")
      minimumAppVersion = sourceMarker.minimumAppVersion
    }
    const marker = {
      dataSetId: record.dataSetId,
      schemaVersion: 1,
      minimumAppVersion,
    }
    await writeSynced(
      join(staging, "moon-data.json"),
      JSON.stringify(marker, null, 2)
    )
    let mappings = []
    try {
      mappings = await parse(
        join(record.sourceDirectory, "maintenance", "directory-mappings.json")
      )
      if (!Array.isArray(mappings))
        throw new MigrationError("目录映射记录损坏。")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    mappings = mappings
      .filter((item) => item.sourceRoot !== record.sourceDirectory)
      .map((item) => ({
        sourceRoot: item.sourceRoot,
        targetRoot: record.targetDirectory,
      }))
    mappings.push({
      sourceRoot: record.sourceDirectory,
      targetRoot: record.targetDirectory,
    })
    const mappingBytes = Buffer.from(JSON.stringify(mappings, null, 2))
    const mappingFile = join("maintenance", "directory-mappings.json")
    await writeSynced(join(staging, mappingFile), mappingBytes)
    expected.set(mappingFile, mappingBytes.length)
    try {
      retainedCopies.push(
        ...(await parse(
          join(record.sourceDirectory, "maintenance", "retained-copies.json")
        ))
      )
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    retainedCopies.push(record.sourceDirectory)
    if (record.legacyProfileDirectory)
      retainedCopies.push(record.legacyProfileDirectory)
    const preparedCopy =
      (await exists(record.targetDirectory)) &&
      (await readdir(record.targetDirectory)).length
        ? `${staging}-prepared-${randomUUID()}`
        : null
    if (preparedCopy) retainedCopies.push(preparedCopy)
    const retainedBytes = Buffer.from(
      JSON.stringify([...new Set(retainedCopies)], null, 2)
    )
    const retainedFile = join("maintenance", "retained-copies.json")
    await writeSynced(join(staging, retainedFile), retainedBytes)
    expected.set(retainedFile, retainedBytes.length)
    progress({
      phase: "validating",
      completedFiles: inspected.fileCount,
      totalFiles: inspected.fileCount,
    })
    await validateOfflineStorage(staging)
    for (const [path, bytes] of expected)
      if ((await stat(join(staging, path))).size !== bytes)
        throw new MigrationError("复制结果大小与预期转换清单不符。")
    const actual = (await files(staging, "", true)).filter(
      (entry) =>
        !["moon-data.json", ".moon-migration.json"].includes(entry.relative)
    )
    if (
      actual.length !== expected.size ||
      actual.some(
        (entry) =>
          !expected.has(entry.relative) ||
          expected.get(entry.relative) !== entry.bytes
      )
    )
      throw new MigrationError("目标文件清单与转换清单不一致，未提交数据根。")
    const document = await new ConversationStore(staging).document()
    for (const item of document.conversations)
      if (item.sessionFile) {
        if (
          !within(
            join(record.targetDirectory, "conversations", "pi"),
            item.sessionFile
          )
        )
          throw new MigrationError("会话历史引用未正确映射。")
        // 原本不存在的空会话保持原请求身份；已存在的文件必须在目标真实可读。
        const sourceFile = join(
          record.sourceDirectory,
          relative(record.targetDirectory, item.sessionFile)
        )
        if (await exists(sourceFile))
          await assertReadable(
            join(staging, relative(record.targetDirectory, item.sessionFile))
          )
      }
    for (const destination of inspected.imported.values())
      await assertReadable(join(staging, destination))
    await privateStage(staging, true)
    if (preparedCopy) {
      await rename(record.targetDirectory, preparedCopy)
      reportRetained()
    }
    // bootstrap由Rust持锁后提交；Node只准备目标，不拥有权威根切换。
    if (await exists(record.targetDirectory)) {
      await rmdir(record.targetDirectory)
    }
    await rename(staging, record.targetDirectory)
    return {
      fileCount: inspected.fileCount,
      totalBytes: [...expected.values()].reduce((sum, bytes) => sum + bytes, 0),
      retainedCopies: [...new Set(retainedCopies)],
    }
  })
}
/** 由仅依赖Node内置模块的launcher调用，加载本模块不会读取或初始化业务数据。 */
export async function runMigrationAction(
  action,
  recordFile,
  progress = () => {}
) {
  const record = await parse(recordFile)
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(record.operationId || "") ||
    !equal(dirname(recordFile), record.controlDirectory) ||
    (action === "--prepare"
      ? !/^[A-Za-z0-9_-]{1,128}$/.test(record.previewPlanId || "") ||
        basename(recordFile) !== `preview-${record.previewPlanId}.json`
      : basename(recordFile) !== `${record.operationId}.json`)
  )
    throw new MigrationError("维护记录来源无效。")
  if (action === "--prepare") return inspectMigrationMetadata(record)
  if (action === "--inspect") {
    // 首启确认后读取完整旧数据前必须排除旧Node；设置在线预检保留其既有只读入口。
    const release = record.legacy ? await sourceLease(record) : async () => {}
    return withAcquiredLock(release, async () => {
      const result = await inspectMigration(record)
      return {
        fileCount: result.fileCount,
        totalBytes: result.totalBytes,
        availableBytes: result.availableBytes,
      }
    })
  } else if (action === "--copy") {
    const result = await copyMigration(record, progress)
    return { complete: true, ...result }
  } else throw new MigrationError("维护模式无效。")
}
if (process.argv[1] && equal(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    const [action, recordFile] = process.argv.slice(2)
    console.log(
      JSON.stringify(
        await runMigrationAction(action, recordFile, (value) =>
          console.log(JSON.stringify(value))
        )
      )
    )
  } catch (error) {
    const controlled = error instanceof MigrationError
    console.error(
      JSON.stringify({
        migrationFailure: true,
        code: controlled ? error.code : "migration_internal",
        message: controlled
          ? error.message
          : "数据迁移未完成，原目录与维护记录保留，请检查权限、文件占用或存储内容。",
      })
    )
    process.exitCode = 1
  }
}
