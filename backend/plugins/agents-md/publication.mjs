import {
  link,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { randomUUID } from "node:crypto"
import { replaceJson } from "../../atomic-file.mjs"
import { operationError } from "../../operation-issue.mjs"

const previewLifetime = 30 * 60_000
const maxSnapshotBytes = 64 * 1024 * 1024
const receiptName = /^[0-9a-f-]{36}\.json$/u
const stagedName = /^\.AGENTS\.md-[0-9a-f-]{36}\.tmp$/u
const changed = "目标在预览后发生变化，请重新预览。"
const stopped = "发布已停止，未写入此目标。"
const unknown = "宿主中断，无法确认此目标是否已写入，请查看项目文件。"

const reject = (code, message) => operationError(code, message, "reload")
const conflict = () => reject("agents_target_conflict", changed)
const identity = (info) => `${info.dev}:${info.ino}`
const version = (info) =>
  `${identity(info)}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`

async function entryInfo(file) {
  try {
    return await lstat(file, { bigint: true })
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
}

async function directorySnapshot(path, pathKey, expected) {
  const canonical = await realpath(path).catch((error) => {
    if (expected && ["ENOENT", "ENOTDIR"].includes(error.code)) throw conflict()
    throw error
  })
  const info = await entryInfo(canonical)
  if (!info?.isDirectory()) throw conflict()
  const directory = { canonical, identity: identity(info) }
  if (
    expected &&
    (pathKey(canonical) !== pathKey(expected.canonical) ||
      directory.identity !== expected.identity)
  )
    throw conflict()
  return directory
}

async function fileSnapshot(file, limit, expected) {
  const info = await entryInfo(file)
  if (!info) {
    if (expected) throw conflict()
    return null
  }
  if (!info.isFile()) throw conflict()
  const fileVersion = version(info)
  if (expected === null || (expected && fileVersion !== expected.version))
    throw conflict()
  if (info.size > limit) {
    throw reject(
      "agents_preview_too_large",
      "目标文件总大小超过 64 MiB，请分批预览。"
    )
  }
  const handle = await open(file, "r")
  let bytes
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || version(opened) !== fileVersion) throw conflict()
    bytes = await handle.readFile()
  } finally {
    await handle.close()
  }
  const after = await entryInfo(file)
  if (
    !after?.isFile() ||
    version(after) !== fileVersion ||
    BigInt(bytes.length) !== info.size
  ) {
    throw conflict()
  }
  const content = bytes.toString("base64")
  if (expected && content !== expected.content) throw conflict()
  return { version: fileVersion, content }
}

const receiptResult = ({ publicationId, state, targets }) => ({
  publicationId,
  state,
  results: targets.map(({ path, name, outcome, reason }) => ({
    path,
    name,
    outcome: outcome ?? "pending",
    reason: reason ?? "",
  })),
})

function complete(target, outcome, reason = "") {
  target.outcome = outcome
  target.reason = reason
  delete target.snapshot
  delete target.directory
  delete target.attempt
}

export function createPublications({
  directory,
  withStateLock,
  readState,
  collectRegisteredProjects,
  composeAgentsContent,
  pathKey,
  ensureOpen,
  saveComposition,
}) {
  const receiptDirectory = join(directory, "publications")
  const receiptPath = (id) => join(receiptDirectory, `${id}.json`)
  const save = (receipt) =>
    replaceJson(receiptPath(receipt.publicationId), receipt)

  async function read(id) {
    try {
      const doc = JSON.parse(await readFile(receiptPath(id), "utf8"))
      if (
        doc.publicationId !== id ||
        doc.version !== 1 ||
        !Array.isArray(doc.targets) ||
        !["previewed", "running", "finished"].includes(doc.state)
      ) {
        throw reject(
          "agents_receipt_invalid",
          "发布回执无法读取，请核对项目文件。"
        )
      }
      return doc
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      throw reject("agents_preview_missing", "未找到本次发布预览，请重新预览。")
    }
  }

  function keys(paths) {
    return [
      ...new Set(
        paths.map((path) => {
          if (!isAbsolute(path))
            throw reject("agents_path_invalid", "请选择已登记的绝对目录路径。")
          return pathKey(path)
        })
      ),
    ]
  }

  function checkTemplate(state, revision) {
    if (state.revision !== revision) {
      throw reject(
        "agents_template_conflict",
        "统一内容或项目清单已更新，请刷新后重新预览。"
      )
    }
  }

  async function registered(state, signal) {
    return new Map(
      (await collectRegisteredProjects(state, signal)).map((entry) => [
        pathKey(entry.path),
        entry,
      ])
    )
  }

  async function expirePreviews() {
    const entries = await readdir(receiptDirectory).catch((error) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    for (const name of entries.filter((name) => receiptName.test(name))) {
      const file = join(receiptDirectory, name)
      const info = await entryInfo(file)
      if (
        !info?.isFile() ||
        Date.now() - Number(info.mtimeMs) < previewLifetime
      )
        continue
      const doc = await read(name.slice(0, -5)).catch(() => null)
      if (doc?.state === "previewed" && Date.now() >= doc.expiresAt)
        await rm(file, { force: true })
    }
  }

  const preview = (input, signal) =>
    withStateLock(async () => {
      const state = await readState()
      checkTemplate(state, input.revision)
      if (
        !input.edit &&
        !composeAgentsContent(state.baseContent, state.snippets).trim()
      ) {
        throw reject(
          "agents_template_empty",
          "统一 AGENTS.md 内容为空，请先编辑正文或开启附加说明。"
        )
      }
      await expirePreviews()
      const entries = await registered(state, signal)
      const targets = []
      const canonicalKeys = new Set()
      let remaining = maxSnapshotBytes
      for (const key of keys(input.paths)) {
        ensureOpen(signal)
        const entry = entries.get(key)
        if (!entry || entry.knownUnavailable) {
          throw reject(
            "agents_path_invalid",
            "目标目录未登记或不可访问，请重新选择。"
          )
        }
        const directory = await directorySnapshot(entry.path, pathKey)
        const canonicalKey = pathKey(directory.canonical)
        if (canonicalKeys.has(canonicalKey)) {
          throw reject(
            "agents_path_invalid",
            "多个目标指向同一目录，请去除重复目标。"
          )
        }
        canonicalKeys.add(canonicalKey)
        const snapshot = await fileSnapshot(
          join(directory.canonical, "AGENTS.md"),
          remaining
        )
        await directorySnapshot(entry.path, pathKey, directory)
        if (
          input.edit &&
          (Boolean(snapshot) !== input.edit.exists ||
            Buffer.from(snapshot?.content ?? "", "base64").toString("utf8") !==
              input.edit.original)
        )
          throw conflict()
        if (snapshot) remaining -= Buffer.byteLength(snapshot.content, "base64")
        targets.push({
          path: entry.path,
          name: entry.name,
          composed: !!state.projectBindings?.[entry.id],
          directory,
          snapshot,
        })
      }
      const publicationId = randomUUID()
      ensureOpen(signal)
      await save({
        version: 1,
        publicationId,
        ...(input.edit
          ? {
              proposedContent: input.edit.content,
              composition: input.edit.composition,
            }
          : {}),
        revision: state.revision,
        expiresAt: Date.now() + previewLifetime,
        state: "previewed",
        targets,
      })
      return {
        publicationId,
        targets: targets.map(({ path, name, snapshot, composed }) => ({
          composed,
          path,
          name,
          exists: snapshot !== null,
        })),
      }
    }, signal)

  async function cleanupAttempt(target, attempt) {
    if (!stagedName.test(attempt.temporary)) return
    try {
      const folder = await directorySnapshot(
        target.path,
        pathKey,
        target.directory
      )
      const file = join(folder.canonical, attempt.temporary)
      const info = await entryInfo(file)
      if (info?.isFile() && identity(info) === attempt.identity)
        await rm(file, { force: true })
    } catch {
      // 目录可能在写入后消失或改向，此时不能清理路径上的新条目。
    }
  }

  async function recover(receipt) {
    for (const target of receipt.targets) {
      if (target.outcome) continue
      const attempt = target.attempt
      if (!attempt) {
        complete(target, "stopped", stopped)
        continue
      }
      let committed = false
      try {
        const folder = await directorySnapshot(
          target.path,
          pathKey,
          target.directory
        )
        const info = await entryInfo(join(folder.canonical, "AGENTS.md"))
        committed =
          info?.isFile() &&
          info.ino !== 0n &&
          identity(info) === attempt.identity
      } catch {
        // 保留不确定结果，恢复过程从不重新写入项目文件。
      }
      await cleanupAttempt(target, attempt)
      complete(
        target,
        committed ? attempt.outcome : "unknown",
        committed ? "" : unknown
      )
    }
    await saveComposition?.(receipt)
    receipt.state = "finished"
    await save(receipt)
    return receiptResult(receipt)
  }

  async function publishTarget(receipt, target, entry, content, signal) {
    if (!entry || entry.knownUnavailable) {
      complete(target, "conflict", "目标目录已不可用，请重新预览。")
      await save(receipt)
      return
    }
    const temporary = `.AGENTS.md-${randomUUID()}.tmp`
    const folder = target.directory
    const targetFile = join(folder.canonical, "AGENTS.md")
    const stagedFile = join(folder.canonical, temporary)
    const outcome = target.snapshot ? "replaced" : "created"
    let attempt
    let written = false
    let failure
    try {
      await directorySnapshot(entry.path, pathKey, folder)
      ensureOpen(signal)
      const handle = await open(stagedFile, "wx")
      try {
        attempt = {
          temporary,
          identity: identity(await handle.stat({ bigint: true })),
          outcome,
        }
        if (target.snapshot)
          await handle.chmod(Number((await lstat(targetFile)).mode))
        await handle.writeFile(content)
      } finally {
        await handle.close()
      }
    } catch (error) {
      failure = error
    }
    try {
      if (attempt && !failure) {
        target.attempt = attempt
        // 先记录可在重启后识别的暂存文件身份，收到持久化确认才准许发布。
        await save(receipt)
        try {
          await directorySnapshot(entry.path, pathKey, folder)
          await fileSnapshot(targetFile, maxSnapshotBytes, target.snapshot)
          ensureOpen(signal)
          if (target.snapshot) await rename(stagedFile, targetFile)
          else await link(stagedFile, targetFile)
          written = true
        } catch (error) {
          failure = error
        }
      }
    } finally {
      if (attempt)
        await cleanupAttempt({ path: target.path, directory: folder }, attempt)
    }
    if (written) complete(target, outcome)
    else if (
      failure?.code === "EEXIST" ||
      failure?.issue?.code === "agents_target_conflict"
    ) {
      complete(target, "conflict", changed)
    } else if (signal?.aborted || failure?.name === "AbortError")
      complete(target, "stopped", stopped)
    else
      complete(target, "failed", "写入失败，请检查目录、文件类型及写入权限。")
    await save(receipt)
  }

  const publish = (input, signal) => {
    if (!input.publicationId) {
      throw reject(
        "agents_preview_required",
        "请先预览目标，再确认替换 AGENTS.md。"
      )
    }
    return withStateLock(async (committed) => {
      const receipt = await read(input.publicationId)
      if (
        input.revision !== receipt.revision ||
        JSON.stringify(keys(input.paths)) !==
          JSON.stringify(receipt.targets.map(({ path }) => pathKey(path)))
      ) {
        throw reject(
          "agents_preview_mismatch",
          "提交的模板版本或目标与预览不符，请重新预览。"
        )
      }
      if (receipt.state === "finished") return receiptResult(receipt)
      if (receipt.state === "running") return recover(receipt)
      if (Date.now() >= receipt.expiresAt) {
        throw reject("agents_preview_expired", "发布预览已过期，请重新预览。")
      }
      const state = await readState()
      checkTemplate(state, receipt.revision)
      const content =
        receipt.proposedContent ??
        composeAgentsContent(state.baseContent, state.snippets)
      const entries = await registered(state, signal)
      ensureOpen(signal)
      receipt.state = "running"
      await save(receipt)
      committed()
      for (const target of receipt.targets) {
        if (signal?.aborted) complete(target, "stopped", stopped)
        else
          await publishTarget(
            receipt,
            target,
            entries.get(pathKey(target.path)),
            content,
            signal
          )
      }
      await saveComposition?.(receipt)
      receipt.state = "finished"
      await save(receipt)
      return receiptResult(receipt)
    }, signal)
  }

  const result = async ({ publicationId }, signal) => {
    ensureOpen(signal)
    const receipt = await read(publicationId)
    if (receipt.state === "previewed" && Date.now() >= receipt.expiresAt) {
      throw reject("agents_preview_expired", "发布预览已过期，请重新预览。")
    }
    if (receipt.state !== "running") return receiptResult(receipt)
    // 持有同一配置锁后才能判断 running 是否已被遗留。
    return withStateLock(async () => {
      const current = await read(publicationId)
      return current.state === "running"
        ? recover(current)
        : receiptResult(current)
    }, signal)
  }

  return { preview, publish, result }
}
