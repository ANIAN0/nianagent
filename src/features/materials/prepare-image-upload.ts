import type { MaterialService } from "./material-service"

/** Read and upload one immutable File under the same cancellable operation. */
export async function prepareImageUpload({
  service,
  sessionId,
  cwd,
  file,
  name,
  signal,
}: {
  service: Pick<MaterialService, "upload">
  sessionId: string
  cwd: string
  file: File
  name: string
  signal: AbortSignal
}) {
  signal.throwIfAborted()
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    let settled = false
    function finish(error?: unknown) {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", cancel)
      reader.onload = null
      reader.onerror = null
      reader.onabort = null
      if (error) reject(error)
      else resolve(String(reader.result).split(",")[1] || "")
    }
    function cancel() {
      reader.abort()
      finish(
        signal.reason ?? new DOMException("已取消图片读取。", "AbortError")
      )
    }
    reader.onload = () => finish()
    reader.onerror = () => finish(new Error("图片无法读取，请重新选择。"))
    reader.onabort = () =>
      finish(
        signal.reason ?? new DOMException("已取消图片读取。", "AbortError")
      )
    signal.addEventListener("abort", cancel, { once: true })
    try {
      reader.readAsDataURL(file)
    } catch (error) {
      finish(error)
    }
  })
  signal.throwIfAborted()
  return service.upload(
    sessionId,
    cwd,
    { name, mimeType: file.type, data },
    signal
  )
}
