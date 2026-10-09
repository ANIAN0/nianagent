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
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import lockfile from "proper-lockfile"
import { ConversationStore } from "./conversation-store.mjs"
import { validateOfflineStorage } from "./storage-validation.mjs"
/** 只有本模块固定说明可公开；JSON/FS/SDK异常绝不按文本语言猜测安全性。 */
export class MigrationError extends Error {
  constructor(message) {
    super(message)
    this.name = "MoonMigrationError"
    this.code = "migration_validation"
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
  /^\.moon-write-.*\.tmp$/.test(name) ||
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
export async function inspectMigration(record) {
  const source = resolve(record.sourceDirectory)
  const target = resolve(record.targetDirectory)
  if (
    !isAbsolute(record.targetDirectory) ||
    equal(source, target) ||
    within(source, target) ||
    within(target, source) ||
    dirname(target) === target ||
    equal(target, record.installDirectory) ||
    within(join(record.installDirectory, "runtime"), target) ||
    within(target, record.installDirectory)
  )
    throw new MigrationError(
      "目标必须是独立的新空数据目录，不能与源、程序目录或runtime嵌套。"
    )
  await noLinks(source)
  await noLinks(target)
  if (!(await exists(dirname(target))))
    throw new MigrationError("目标父目录不存在，请先选择存在的可写位置。")
  if (await exists(target)) {
    if (!(await lstat(target)).isDirectory())
      throw new MigrationError("目标不是目录。")
    if ((await readdir(target)).length) {
      let sameOperation = false
      try {
        const marker = await parse(join(target, ".moon-migration.json"))
        sameOperation =
          marker.operationId === record.operationId &&
          marker.dataSetId === record.dataSetId
      } catch {
        /* 非同次操作不能接管。 */
      }
      if (!sameOperation)
        throw new MigrationError("目标目录已有文件，请选择新的空目录。")
    }
  }
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
  const imported = await outputReferences(entries, record)
  const totalBytes = entries.reduce((sum, file) => sum + file.bytes, 0)
  const space = await statfs(dirname(target))
  const availableBytes = Number(space.bavail) * Number(space.bsize)
  if (
    availableBytes <
    totalBytes + Math.max(64 * 1024 * 1024, totalBytes * 0.1)
  )
    throw new MigrationError("目标磁盘可用空间不足，原目录保留。")
  return {
    entries,
    imported,
    totalBytes,
    availableBytes,
    fileCount: entries.length,
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

export async function copyMigration(record, progress = () => {}) {
  const release = await lockfile.lock(
    join(record.sourceDirectory, "runtime.json"),
    {
      realpath: false,
      lockfilePath: join(record.sourceDirectory, "runtime.json.lock"),
      retries: 0,
    }
  )
  try {
    const inspected = await inspectMigration(record)
    const staging = join(
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
    const stageMarker = join(staging, ".moon-migration.json")
    if ((await exists(staging)) && (await readdir(staging)).length) {
      const marker = await parse(stageMarker)
      if (
        marker.operationId !== record.operationId ||
        marker.dataSetId !== record.dataSetId
      )
        throw new MigrationError("迁移暂存目录身份不匹配。")
      // 中断暂存保留为明确旧副本，新一轮按当前冻结源重建，避免残留已删除文件进入结果。
      const retained = `${staging}-interrupted-${randomUUID()}`
      await rename(staging, retained)
      retainedCopies.push(retained)
      reportRetained()
    }
    await mkdir(staging, { recursive: true, mode: 0o700 })
    await writeSynced(
      stageMarker,
      JSON.stringify({
        operationId: record.operationId,
        dataSetId: record.dataSetId,
      })
    )
    await privateStage(staging)
    const expected = new Map()
    for (const [index, entry] of inspected.entries.entries()) {
      if (entry.relative === "moon-data.json") continue
      const bytes = await copyEntry(
        entry,
        join(staging, entry.relative),
        record,
        inspected.imported
      )
      expected.set(entry.relative, bytes)
      progress({
        phase: "copying",
        completedFiles: index + 1,
        totalFiles: inspected.fileCount,
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
  } finally {
    await release()
  }
}
if (process.argv[1] && equal(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    const [action, recordFile] = process.argv.slice(2)
    const record = await parse(recordFile)
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(record.operationId || "") ||
      !equal(dirname(recordFile), record.controlDirectory) ||
      basename(recordFile) !== `${record.operationId}.json`
    )
      throw new MigrationError("维护记录来源无效。")
    if (action === "--inspect") {
      const result = await inspectMigration(record)
      console.log(
        JSON.stringify({
          fileCount: result.fileCount,
          totalBytes: result.totalBytes,
          availableBytes: result.availableBytes,
        })
      )
    } else if (action === "--copy") {
      const result = await copyMigration(record, (value) =>
        console.log(JSON.stringify(value))
      )
      console.log(JSON.stringify({ complete: true, ...result }))
    } else throw new MigrationError("维护模式无效。")
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
