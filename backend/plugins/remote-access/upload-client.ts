import { callPlugin } from "@/features/plugins/plugin-service"
import type { MaterialReference } from "@/contracts/rpc.generated"

const copies = new Map<string, { token: string; sessionId: string }>()
const copyKey = "moon.remote.upload-copies"
function rememberCopy(id: string, copy: { token: string; sessionId: string }) {
  copies.set(id, copy)
  sessionStorage.setItem(copyKey, JSON.stringify([...copies]))
}
function restoreCopies() {
  if (copies.size) return
  try {
    const saved = JSON.parse(sessionStorage.getItem(copyKey) || "[]")
    for (const [id, copy] of saved) {
      if (/^[a-f0-9]{64}$/.test(id) && /^[a-f0-9-]{36}$/.test(copy.token) && typeof copy.sessionId === "string") copies.set(id, copy)
    }
  } catch { /* Unknown records are never used for deletion. */ }
}
export async function uploadRemoteFile(
  sessionId: string,
  cwd: string,
  file: File,
  signal: AbortSignal
) {
  if (file.size > 8 * 1024 * 1024)
    throw new Error("文件超过8MiB，请选择较小文件。")
  signal.throwIfAborted()
  restoreCopies()
  const started = await callPlugin<{ value: { token: string } }>(
    "remote-access",
    "uploadStart",
    { sessionId, cwd, name: file.name, mimeType: file.type, bytes: file.size },
    undefined,
    signal
  )
  const token = started.value.token
  try {
    for (let offset = 0; offset < file.size; offset += 2 * 1024 * 1024) {
      signal.throwIfAborted()
      const bytes = new Uint8Array(
        await file.slice(offset, offset + 2 * 1024 * 1024).arrayBuffer()
      )
      let binary = ""
      for (let start = 0; start < bytes.length; start += 32768)
        binary += String.fromCharCode(...bytes.subarray(start, start + 32768))
      await callPlugin(
        "remote-access",
        "uploadChunk",
        { token, offset, data: btoa(binary) },
        undefined,
        signal
      )
    }
    const result = await callPlugin<{ value: { material: MaterialReference } }>(
      "remote-access",
      "uploadFinish",
      { token },
      undefined,
      signal
    )
    rememberCopy(result.value.material.id, { token, sessionId })
    return result.value.material
  } catch (error) {
    // A failed transport may already have prepared the copy. Read status only;
    // never repeat writes or remove an uncertain prepared/accepted attachment.
    const status = await callPlugin<{
        value: { phase: string; material: MaterialReference | null }
      }>("remote-access", "uploadStatus", { token }).catch(() => null)
    if (signal.aborted || status?.value.phase === "receiving") {
      if (status && ["receiving", "prepared"].includes(status.value.phase)) {
        await callPlugin("remote-access", "uploadDiscard", { token }).catch(() => {})
      }
    } else {
      if (status?.value.phase === "prepared" && status.value.material) {
        rememberCopy(status.value.material.id, { token, sessionId })
        return status.value.material
      }
    }
    throw error
  }
}
export async function discardRemoteFile(materialId: string) {
  restoreCopies()
  const copy = copies.get(materialId)
  if (!copy) return
  const result = await callPlugin<{ value: { removed: boolean } }>(
    "remote-access",
    "uploadDiscard",
    { token: copy.token }
  )
  if (result.value.removed) {
    copies.delete(materialId)
    sessionStorage.setItem(copyKey, JSON.stringify([...copies]))
  }
}
export function chooseRemoteFiles(
  sessionId: string,
  cwd: string,
  signal?: AbortSignal
): Promise<MaterialReference[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    input.hidden = true
    const controller = new AbortController()
    const abort = () => {
      controller.abort(signal?.reason)
      input.remove()
      reject(signal?.reason ?? new DOMException("已取消选择。", "AbortError"))
    }
    const cleanup = () => {
      signal?.removeEventListener("abort", abort)
      input.remove()
    }
    input.oncancel = () => {
      cleanup()
      resolve([])
    }
    input.onchange = () => {
      const files = Array.from(input.files || [])
      void (async () => {
        const result: MaterialReference[] = []
        try {
          for (const file of files)
            result.push(await uploadRemoteFile(sessionId, cwd, file, controller.signal))
        } catch (error) {
          for (const material of result) await discardRemoteFile(material.id).catch(() => {})
          throw error
        }
        return result
      })()
        .then(resolve, reject)
        .finally(cleanup)
    }
    signal?.throwIfAborted()
    signal?.addEventListener("abort", abort, { once: true })
    document.body.append(input)
    input.click()
  })
}
