import { useContext, useEffect, useRef, useState } from "react"
import { MaterialServiceContext } from "./material-service"

/** Full image bytes are fetched only when this thumbnail becomes visible. */
export function useMaterialThumbnail(id: string, cwd: string, enabled: boolean) {
  const service = useContext(MaterialServiceContext)
  const target = useRef<HTMLDivElement>(null)
  const [thumbnail, setThumbnail] = useState<{ key: string; url: string }>()
  const key = `${cwd}:${id}`
  useEffect(() => {
    if (!service || !enabled || !cwd || !target.current) return
    const controller = new AbortController()
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void service.preview(cwd, id, controller.signal).then((preview) => {
        if (controller.signal.aborted || !preview.data) return
        const image = new Image()
        image.onload = () => {
          if (controller.signal.aborted) return
          const ratio = Math.min(1, 128 / Math.max(image.width, image.height))
          const canvas = document.createElement("canvas")
          canvas.width = Math.max(1, Math.round(image.width * ratio))
          canvas.height = Math.max(1, Math.round(image.height * ratio))
          canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)
          setThumbnail({ key, url: canvas.toDataURL("image/webp", 0.75) })
          image.src = ""
        }
        image.src = `data:${preview.mimeType};base64,${preview.data}`
      }).catch(() => { /* Clicking preview exposes a retryable actual error. */ })
    })
    observer.observe(target.current)
    return () => { controller.abort(); observer.disconnect() }
  }, [service, key, id, cwd, enabled])
  return { target, thumbnail: thumbnail?.key === key ? thumbnail.url : "" }
}
