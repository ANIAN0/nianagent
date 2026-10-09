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
  await ready.models.store.read()
  await ready.conversationStore.document()
  await ready.sessions.document()
  await ready.mcp.document()
  await ready.extensions.document()
  await ready.workspaces.read()
  let queues = []
  try {
    queues = await readdir(join(directory, "conversations", "queue"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  for (const name of queues.filter((name) =>
    /^[A-Za-z0-9_-]{1,128}\.json$/.test(name)
  ))
    await ready.conversations.queue.document(name.slice(0, -5))
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
  return { readable: true }
}

/** 离线目标使用同一读取者；不初始化服务依赖、不发现扩展、不连接MCP、不对账unknown。 */
export async function validateOfflineStorage(directory) {
  // Pi加载前固定本进程自有目录，首次legacy导入也不会借用用户agent/Temp。
  process.env.MOON_DATA_DIR = directory
  process.env.MOON_RUNTIME_FILE = join(directory, "runtime.json")
  process.env.PI_CODING_AGENT_DIR = join(directory, "agent")
  process.env.TEMP = join(directory, "tmp")
  process.env.TMP = join(directory, "tmp")
  const { MoonServices } = await import("./services.mjs")
  const ready = new MoonServices(directory)
  try {
    return await validateStorage(ready, directory)
  } finally {
    await ready.close({ strict: true })
  }
}
