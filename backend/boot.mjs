// @ts-check
import { validateStorage } from "./storage-validation.mjs"

/** 浏览器启动证明只复用纯存储读取，不能借启动页投递队列或恢复未知写入。 */
export class BootService {
  /** @param {string} directory @param {() => import('./services.mjs').MoonServices} services */
  constructor(directory, services) {
    this.directory = directory
    this.services = services
  }
  /** @param {AbortSignal} [signal] */
  async status(signal) {
    signal?.throwIfAborted()
    const result = await validateStorage(this.services(), this.directory)
    signal?.throwIfAborted()
    return result
  }
}
