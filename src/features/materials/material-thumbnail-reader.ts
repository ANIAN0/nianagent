import type { MaterialPreview } from "@/features/models/model-contract.generated"

/** Decode only host-prepared bytes; no remote URL or caller path is accepted. */
export function readMaterialThumbnail(
  preview: MaterialPreview,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted)
    return Promise.reject(new DOMException("Cancelled", "AbortError"))
  if (
    !preview.data ||
    !/^image\/(?:png|jpeg|gif|webp)$/i.test(preview.mimeType)
  )
    return Promise.reject(new Error("此记录没有可解码的图片内容。"))

  return new Promise((resolve, reject) => {
    const image = new Image()
    let finished = false
    function release() {
      image.onload = null
      image.onerror = null
      signal.removeEventListener("abort", abort)
      image.removeAttribute("src")
    }
    function finish(error?: Error, url?: string) {
      if (finished) return
      finished = true
      release()
      if (error) reject(error)
      else resolve(url!)
    }
    function abort() {
      finish(new DOMException("Cancelled", "AbortError"))
    }
    image.onerror = () => finish(new Error("图片内容无法解码。"))
    image.onload = () => {
      if (finished) return
      if (signal.aborted) return abort()
      try {
        const width = image.naturalWidth
        const height = image.naturalHeight
        if (!width || !height) throw new Error("图片没有有效尺寸。")
        const ratio = Math.min(1, 128 / Math.max(width, height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(width * ratio))
        canvas.height = Math.max(1, Math.round(height * ratio))
        const context = canvas.getContext("2d")
        if (!context) throw new Error("当前窗口无法生成图片缩略图。")
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const url = canvas.toDataURL("image/webp", 0.75)
        if (!/^data:image\/(?:webp|png);base64,./i.test(url))
          throw new Error("图片缩略图未能生成。")
        finish(undefined, url)
      } catch (error) {
        finish(
          error instanceof Error ? error : new Error("图片缩略图未能生成。"),
        )
      }
    }
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) return abort()
    try {
      image.src = `data:${preview.mimeType};base64,${preview.data}`
    } catch (error) {
      finish(error instanceof Error ? error : new Error("图片内容无法加载。"))
    }
  })
}
