import { readdir, readFile } from "node:fs/promises"
import { join, isAbsolute } from "node:path"
import { assertSchema, schemas } from "./schema.mjs"

async function readOptional(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    return null
  }
}
/** 启动确认只解析已落盘schema，不借读取触发unknown对账、重发、队列投递或扩展加载。 */
export async function validateStorage(ready, directory) {
  await ready.models()
  await ready.conversations()
  await ready.sessions()
  await ready.mcp()
  // Optional extension corruption remains visible in extensions.list. It may
  // disable those extensions, but cannot prevent an independent local chat.
  await ready.workspaces()
  await validateQueueAndMaintenance(ready, directory)
  return { readable: true }
}

/**
 * 分层启动确认（G03）：平台可达即 readable；各领域存储独立核验，
 * 单域损坏以显式条目呈现，不抛错、不阻塞其他域与工作台入口。
 * 维护/迁移路径仍使用上面的 validateStorage 全量严格校验。
 */
const DOMAIN_CHECKS = [
  { name: "models", run: (ready) => ready.models() },
  { name: "conversations", run: (ready) => ready.conversations() },
  { name: "sessions", run: (ready) => ready.sessions() },
  { name: "mcp", run: (ready) => ready.mcp() },
  { name: "workspaces", run: (ready) => ready.workspaces() },
]

const DOMAIN_CHECK_TIMEOUT_MS = 10_000

export async function validateDomains(ready, directory) {
  // 并行核验 + 每域超时：某域长期等待不再阻塞其他域与工作台入口（Q13）；
  // 超时域显式呈现为不可用，不以空数据冒充成功，底层读取自行结束不消费其结果。
  const withTimeout = async (run) => {
    let timer
    try {
      return await Promise.race([
        run(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `领域核验超时（${DOMAIN_CHECK_TIMEOUT_MS / 1000}s），已隔离呈现为不可用。`
                )
              ),
            DOMAIN_CHECK_TIMEOUT_MS
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const domains = await Promise.all(
    DOMAIN_CHECKS.map(async ({ name, run }) => {
      try {
        // AC11：检查器以 ready 为入参（run() 无参调用会让五域全部 TypeError，
        // 被误报为数据损坏）；超时隔离语义不变。
        await withTimeout(() => run(ready))
        return { name, ok: true }
      } catch (error) {
        return {
          name,
          ok: false,
          // 显式呈现损坏/超时域；原始数据不动，恢复入口由各域自身提供
          issue: error instanceof Error ? error.message : String(error),
        }
      }
    })
  )
  // 队列/控制/维护记录沿用全量逻辑单独核验，失败同样按域隔离呈现
  let legacy = null
  try {
    await withTimeout(() => validateQueueAndMaintenance(ready, directory))
  } catch (error) {
    legacy = error instanceof Error ? error.message : String(error)
  }
  domains.push(
    legacy === null
      ? { name: "queue-control-maintenance", ok: true }
      : { name: "queue-control-maintenance", ok: false, issue: legacy }
  )
  return { readable: true, domains }
}

/** 抽取 validateStorage 的队列/控制/维护记录段，供分域与严格两条路径共用。 */
async function validateQueueAndMaintenance(ready, directory) {
  let queues = []
  try {
    queues = await readdir(join(directory, "conversations", "queue"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  for (const name of queues.filter((name) =>
    /^[A-Za-z0-9_-]{1,128}\.json$/.test(name)
  ))
    await ready.queueDocument(name.slice(0, -5))
  let controls = []
  try {
    controls = await readdir(join(directory, "conversations", "controls"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  for (const name of controls.filter((name) =>
    /^[A-Za-z0-9_-]{1,128}\.json$/.test(name)
  )) {
    const value = await readOptional(
      join(directory, "conversations", "controls", name)
    )
    if (value?.version !== 1 || !Array.isArray(value.operations))
      throw new Error("控制记录损坏，原文件保留。")
    for (const operation of value.operations) {
      const {
        targetSessionFile,
        configuration,
        inheritedManualCompactionIds: _inherited,
        ...publicOperation
      } = operation
      assertSchema(
        schemas.ConversationControlOperation,
        publicOperation,
        "已保存控制回执"
      )
      if (
        operation.sessionId !== name.slice(0, -5) ||
        (targetSessionFile && !isAbsolute(targetSessionFile))
      )
        throw new Error("控制记录身份或历史路径无效。")
      if (configuration)
        assertSchema(
          schemas.SessionConfiguration,
          configuration,
          "已保存派生配置"
        )
    }
  }
  const mappings = await readOptional(
    join(directory, "maintenance", "directory-mappings.json")
  )
  if (
    mappings !== null &&
    (!Array.isArray(mappings) ||
      mappings.some(
        (item) =>
          !item ||
          typeof item.sourceRoot !== "string" ||
          typeof item.targetRoot !== "string" ||
          !isAbsolute(item.sourceRoot) ||
          !isAbsolute(item.targetRoot)
      ))
  )
    throw new Error("数据目录映射记录损坏，不能确认profile恢复。")
  const retained = await readOptional(
    join(directory, "maintenance", "retained-copies.json")
  )
  if (
    retained !== null &&
    (!Array.isArray(retained) ||
      retained.some((path) => typeof path !== "string" || !isAbsolute(path)))
  )
    throw new Error("旧数据副本记录损坏，原文件保留。")
}
