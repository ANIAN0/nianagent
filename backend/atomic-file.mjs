// @ts-check
import { mkdir, writeFile, rename, rm } from "node:fs/promises"
import { dirname, basename, join } from "node:path"
import { randomUUID } from "node:crypto"
import { operationError } from "./operation-issue.mjs"
/** @param {unknown} primary @param {unknown} cleanup */
const cleanupFailure = (primary, cleanup) =>
  new AggregateError([primary, cleanup], "操作和资源清理均未完成。", {
    cause: primary,
  })

/** 原子可见性不等于掉电持久性；调用方继续拥有 CAS 和副作用的接收边界。 */
/** @param {string} file @param {unknown} value @param {{signal?: AbortSignal, pretty?: boolean}} [options] */
export async function stageJson(file, value, { signal, pretty = false } = {}) {
  const directory = dirname(file)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.${basename(file)}-${randomUUID()}.tmp`)
  let committed = false
  try {
    signal?.throwIfAborted()
    await writeFile(
      temporary,
      JSON.stringify(value, null, pretty ? 2 : undefined),
      {
        flag: "wx",
        mode: 0o600,
      }
    )
  } catch (error) {
    try {
      await rm(temporary, { force: true })
    } catch (cleanup) {
      throw cleanupFailure(error, cleanup)
    }
    throw error
  }
  return {
    async commit() {
      signal?.throwIfAborted()
      await rename(temporary, file)
      committed = true
    },
    async discard() {
      // rename 已消费临时文件，提交后不再清理或撤销。
      if (!committed) await rm(temporary, { force: true })
    },
  }
}

/** @param {string} file @param {unknown} value @param {{signal?: AbortSignal, pretty?: boolean}} [options] */
export async function replaceJson(file, value, options) {
  const staged = await stageJson(file, value, options)
  try {
    await staged.commit()
  } catch (error) {
    try {
      await staged.discard()
    } catch (cleanup) {
      throw cleanupFailure(error, cleanup)
    }
    throw error
  }
}

/** action 标明提交之后，解锁异常只能要求核对；始终尝试释放本次持有的锁。 */
/** @template T @param {()=>Promise<void>} unlock @param {(committed:()=>void)=>Promise<T>} action @returns {Promise<T>} */
export async function withAcquiredLock(unlock, action) {
  let committed = false
  let failed = false
  let failure
  /** @type {T | undefined} */
  let result
  try {
    result = await action(() => {
      committed = true
    })
  } catch (error) {
    failed = true
    failure = error
  }
  try {
    await unlock()
  } catch (error) {
    if (committed)
      throw Object.assign(
        operationError(
          "result_unknown",
          "数据已保存，但本次请求收尾未完成，请核对原操作。",
          "check"
        ),
        { cause: error }
      )
    if (failed) throw cleanupFailure(failure, error)
    throw error
  }
  if (failed) {
    if (committed)
      throw Object.assign(
        operationError(
          "result_unknown",
          "数据已保存，但当前结果尚待核对，请读取原操作。",
          "check"
        ),
        { cause: failure }
      )
    throw failure
  }
  return /** @type {T} */ (result)
}

/** @template T @param {()=>Promise<T>} action @param {()=>Promise<unknown>} cleanup @returns {Promise<T>} */
export async function withCleanup(action, cleanup) {
  let failed = false
  let failure
  /** @type {T|undefined} */
  let result
  try {
    result = await action()
  } catch (error) {
    failed = true
    failure = error
  }
  try {
    await cleanup()
  } catch (error) {
    if (failed) throw cleanupFailure(failure, error)
    throw error
  }
  if (failed) throw failure
  return /** @type {T} */ (result)
}
