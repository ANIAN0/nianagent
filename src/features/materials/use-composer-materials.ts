import { useContext, useEffect, useRef, useState, type RefObject } from "react"
import { isTauri } from "@tauri-apps/api/core"
import type { Material } from "@/features/home/home-types"
import { MaterialServiceContext, sameMaterial } from "./material-service"

type Update = (apply: (materials: Material[]) => Material[]) => void
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)
export function useComposerMaterials({
  sessionId = "",
  cwd,
  anchorRef,
  materials,
  update,
  disabled = false,
}: {
  sessionId?: string
  cwd: string
  anchorRef: RefObject<HTMLDivElement | null>
  materials: Material[]
  update: Update
  disabled?: boolean
}) {
  const service = useContext(MaterialServiceContext)
  const latest = useRef({
    materials,
    update,
    disabled,
    scope: `${sessionId}:${cwd}`,
  })
  latest.current = { materials, update, disabled, scope: `${sessionId}:${cwd}` }
  const [action, setAction] = useState({
    scope: `${sessionId}:${cwd}`,
    choosing: false,
    error: "",
  })
  const requests = useRef(new Set<AbortController>())
  const alive = useRef(true)
  const scope = `${sessionId}:${cwd}`
  const choosing = action.scope === scope && action.choosing
  const error = action.scope === scope ? action.error : ""
  const verified = useRef(new Set<string>())
  const preparing = useRef(new Set<string>())
  useEffect(() => {
    const pendingRequests = requests.current
    const pendingMaterials = preparing.current
    const verifiedMaterials = verified.current
    alive.current = true
    return () => {
      alive.current = false
      for (const request of pendingRequests) request.abort()
      pendingRequests.clear()
      pendingMaterials.clear()
      verifiedMaterials.clear()
    }
  }, [scope])
  const referenceSignature = materials
    .map((item) => `${item.id}:${item.source}`)
    .join("\n")
  useEffect(() => {
    if (!service || !sessionId || !cwd) return
    const unverified = materials.filter(
      (item) =>
        !verified.current.has(`${scope}:${item.id}`) &&
        !preparing.current.has(item.id)
    )
    if (!unverified.length) return
    const controller = new AbortController()
    const ids = new Set(unverified.map((item) => item.id))
    update((current) =>
      current.map((item) =>
        ids.has(item.id) ? { ...item, status: "preparing" } : item
      )
    )
    void service
      .restore(sessionId, cwd, unverified, controller.signal)
      .then((restored) => {
        if (controller.signal.aborted || latest.current.scope !== scope) return
        for (const item of restored) verified.current.add(`${scope}:${item.id}`)
        latest.current.update((current) =>
          current.map((item) => {
            const value = restored.find((candidate) => candidate.id === item.id)
            return value ? { ...item, ...value, error: value.error } : item
          })
        )
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || latest.current.scope !== scope) return
        for (const id of ids) verified.current.add(`${scope}:${id}`)
        latest.current.update((current) =>
          current.map((item) =>
            ids.has(item.id)
              ? { ...item, status: "failed", error: message(failure) }
              : item
          )
        )
      })
    return () => controller.abort()
    // Whole drafts are owned and persisted by the application, not this hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, sessionId, cwd, scope, referenceSignature])
  function append(items: Material[]) {
    latest.current.update((current) => {
      const output = [...current]
      for (const item of items)
        if (!output.some((value) => sameMaterial(value, item)))
          output.push(item)
      return output
    })
  }
  async function operation<T>(
    action: (signal: AbortSignal) => Promise<T>,
    accept: (result: T) => void
  ) {
    // Entry points gate new work. Once reading an image has started, a temporary
    // disabled phase must not strand its placeholder; ownership changes still
    // cancel it and prevent a result from reaching another draft.
    if (!alive.current || latest.current.scope !== scope) return
    const owner = scope
    const controller = new AbortController()
    requests.current.add(controller)
    try {
      const result = await action(controller.signal)
      if (
        alive.current &&
        !controller.signal.aborted &&
        latest.current.scope === owner
      )
        accept(result)
    } finally {
      requests.current.delete(controller)
    }
  }
  async function choose() {
    if (
      !service ||
      latest.current.disabled ||
      choosing ||
      !alive.current ||
      latest.current.scope !== scope
    )
      return
    setAction({ scope, choosing: true, error: "" })
    try {
      await operation(
        (signal) => service.choose(sessionId, cwd, signal),
        (items) => {
          for (const item of items) verified.current.add(`${scope}:${item.id}`)
          append(items)
        }
      )
    } catch (failure) {
      if (alive.current && latest.current.scope === scope)
        setAction({ scope, choosing: false, error: message(failure) })
    } finally {
      if (alive.current && latest.current.scope === scope)
        setAction((current) => ({ ...current, scope, choosing: false }))
    }
  }
  async function prepare(source: Material) {
    if (
      !alive.current ||
      latest.current.disabled ||
      latest.current.scope !== scope
    )
      return
    if (!service || !source.source) {
      append([source])
      return
    }
    const placeholder = {
      ...source,
      id: `preparing:${crypto.randomUUID()}`,
      status: "preparing" as const,
    }
    if (latest.current.materials.some((item) => sameMaterial(item, source)))
      return
    preparing.current.add(placeholder.id)
    append([placeholder])
    try {
      await operation(
        (signal) => service.prepare(sessionId, cwd, [source.source!], signal),
        (prepared) => {
          for (const item of prepared)
            verified.current.add(`${scope}:${item.id}`)
          latest.current.update((current) =>
            current
              .flatMap((item) =>
                item.id === placeholder.id ? prepared : [item]
              )
              .filter(
                (item, index, all) =>
                  all.findIndex((value) => sameMaterial(value, item)) === index
              )
          )
        }
      )
    } catch (failure) {
      if (alive.current && latest.current.scope === scope)
        latest.current.update((current) =>
          current.map((item) =>
            item.id === placeholder.id
              ? { ...item, status: "failed", error: message(failure) }
              : item
          )
        )
    } finally {
      preparing.current.delete(placeholder.id)
    }
  }
  async function upload(file: File) {
    if (
      !alive.current ||
      latest.current.disabled ||
      latest.current.scope !== scope
    )
      return
    const placeholder: Material = {
      id: `preparing:${crypto.randomUUID()}`,
      name: file.name || "粘贴图片.png",
      kind: "附件",
      type: "image",
      status: "preparing",
      source: "粘贴或拖入的图片",
    }
    preparing.current.add(placeholder.id)
    append([placeholder])
    try {
      if (!service) throw new Error("当前环境未连接材料服务。")
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type))
        throw new Error(
          "浏览器拖入的普通文件缺少实际路径，请使用“添加附件”从系统选择。"
        )
      if (file.size > 8 * 1024 * 1024)
        throw new Error("图片超过8MiB，请选择较小图片。")
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "")
        reader.onerror = () => reject(new Error("图片无法读取，请重新选择。"))
        reader.readAsDataURL(file)
      })
      await operation(
        (signal) =>
          service.upload(
            sessionId,
            cwd,
            { name: placeholder.name, mimeType: file.type, data },
            signal
          ),
        (prepared) => {
          verified.current.add(`${scope}:${prepared.id}`)
          latest.current.update((current) =>
            current
              .map((item) => (item.id === placeholder.id ? prepared : item))
              .filter(
                (item, index, all) =>
                  all.findIndex((value) => sameMaterial(value, item)) === index
              )
          )
        }
      )
    } catch (failure) {
      if (alive.current && latest.current.scope === scope)
        latest.current.update((current) =>
          current.map((item) =>
            item.id === placeholder.id
              ? { ...item, status: "failed", error: message(failure) }
              : item
          )
        )
    } finally {
      preparing.current.delete(placeholder.id)
    }
  }
  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor || !service || !cwd) return
    const paste = (event: ClipboardEvent) => {
      if (latest.current.disabled) return
      const images = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((item): item is File => !!item)
      if (images.length) {
        event.preventDefault()
        for (const image of images) void upload(image)
      }
    }
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return
      event.preventDefault()
      if (latest.current.disabled) return
      if (!isTauri())
        for (const file of Array.from(event.dataTransfer.files))
          void upload(file)
    }
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault()
    }
    anchor.addEventListener("paste", paste)
    anchor.addEventListener("drop", drop)
    anchor.addEventListener("dragover", over)
    let unlisten: (() => void) | undefined
    let disposed = false
    if (isTauri())
      void import("@tauri-apps/api/webviewWindow")
        .then(({ getCurrentWebviewWindow }) =>
          getCurrentWebviewWindow().onDragDropEvent((event) => {
            if (event.payload.type !== "drop" || latest.current.disabled) return
            const rect = anchor.getBoundingClientRect()
            const scale = window.devicePixelRatio || 1
            const { x, y } = event.payload.position
            if (
              x / scale < rect.left ||
              x / scale > rect.right ||
              y / scale < rect.top ||
              y / scale > rect.bottom
            )
              return
            for (const path of event.payload.paths)
              void prepare({
                id: `path:${path}`,
                name: path.split(/[\\/]/).at(-1) || path,
                kind: "附件",
                type: "file",
                status: "ready",
                source: path,
              })
          })
        )
        .then((unsubscribe) => {
          if (disposed) unsubscribe()
          else unlisten = unsubscribe
        })
        .catch(() => {
          if (!disposed)
            setAction({
              scope,
              choosing: false,
              error: "拖放监听不可用，请通过“添加附件”选择文件。",
            })
        })
    return () => {
      disposed = true
      unlisten?.()
      anchor.removeEventListener("paste", paste)
      anchor.removeEventListener("drop", drop)
      anchor.removeEventListener("dragover", over)
    }
    // Event callbacks read latest draft references rather than mounting anew on edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, scope, cwd, anchorRef])
  const ready =
    !service ||
    materials.every(
      (item) =>
        item.status === "ready" && verified.current.has(`${scope}:${item.id}`)
    )
  return {
    service,
    ready,
    choosing,
    error,
    choose,
    prepare,
    clearError: () =>
      setAction((current) => ({ ...current, scope, error: "" })),
  }
}
