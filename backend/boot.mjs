// @ts-check
import { validateDomains } from "./storage-validation.mjs"

/** 浏览器启动证明只复用纯存储读取，不能借启动页投递队列或恢复未知写入。 */
export class BootService {
  /** @param {string} directory @param {ReturnType<import('./services.mjs').MoonServices['storageReaders']>} readers */
  constructor(directory, readers) {
    this.directory = directory
    this.readers = readers
  }
  /**
   * 分层启动确认（G03）：平台可达即 readable=true；各领域存储独立核验，
   * 单域损坏以 domains 条目显式呈现，不抛错、不阻塞其他域与工作台入口。
   * 维护/迁移的全量严格校验走 validateOfflineStorage，不经此路径。
   */
  /** @param {AbortSignal} [signal] */
  async status(signal) {
    signal?.throwIfAborted()
    const result = await validateDomains(this.readers, this.directory)
    signal?.throwIfAborted()
    return result
  }
}
