import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises"
import { join } from "node:path"
import lockfile from "proper-lockfile"
import { replaceJson, withAcquiredLock } from "../../atomic-file.mjs"

const previewAge = 30 * 60_000
const receiptAge = 30 * 24 * 60 * 60_000
async function files(dir) {
  try {
    return (await readdir(dir)).filter((name) =>
      /^[0-9a-f-]{36}\.json$/.test(name)
    )
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }
}
export function createJournal(root) {
  const previews = join(root, "previews"),
    requests = join(root, "requests")
  const locked = async (action) =>
    withAcquiredLock(
      await lockfile.lock(join(root, "journal"), {
        realpath: false,
        retries: 5,
      }),
      action
    )
  const read = async (folder, id) =>
    JSON.parse(await readFile(join(root, folder, id + ".json"), "utf8"))
  let nextSweep = 0
  async function sweep() {
    if (Date.now() < nextSweep) return
    await locked(async () => {
      if (Date.now() < nextSweep) return
      const now = Date.now(),
        referenced = new Set()
      for (const name of await files(requests)) {
        const file = join(requests, name)
        const { previewId } = JSON.parse(await readFile(file, "utf8"))
        if (
          now - (await stat(file)).mtimeMs > receiptAge &&
          !(await lockfile.check(file, { realpath: false }))
        ) {
          await unlink(file)
        } else referenced.add(previewId + ".json")
      }
      for (const name of await files(previews)) {
        const file = join(previews, name)
        if (
          !referenced.has(name) &&
          now - (await stat(file)).mtimeMs > previewAge
        )
          await unlink(file)
      }
      nextSweep = now + 60_000
    })
  }
  async function apply(previewId, requestId, signal, action) {
    await mkdir(requests, { recursive: true })
    const file = join(requests, requestId + ".json")
    return withAcquiredLock(
      await lockfile.lock(file, { realpath: false, retries: 5 }),
      async (committed) => {
        const preview = await locked(async () => {
          const plan = await read("previews", previewId)
          let binding
          try {
            binding = await read("requests", requestId)
          } catch (error) {
            if (error.code !== "ENOENT") throw error
          }
          if (binding && binding.previewId !== previewId)
            throw new Error("该请求已关联其他预览。")
          if (!binding) {
            if (
              Date.now() -
                (await stat(join(previews, previewId + ".json"))).mtimeMs >
              previewAge
            )
              throw new Error("预览已过期，请重新预览。")
            await replaceJson(file, { previewId }, { signal })
            committed()
          }
          return plan
        })
        return action(preview)
      }
    )
  }
  return { read, sweep, apply }
}
