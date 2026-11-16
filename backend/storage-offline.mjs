import { join } from "node:path"
import { validateStorage } from "./storage-validation.mjs"

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
    return await validateStorage(ready.storageReaders(), directory)
  } finally {
    await ready.close({ strict: true })
  }
}
