import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react"
import { isTauri } from "@tauri-apps/api/core"
import { composerEditor } from "@/components/composer/composer-editor-contract"
import type { Material } from "@/features/home/home-types"
import {
  appendPreparedMaterials,
  MaterialServiceContext,
  sameMaterial,
} from "./material-service"
import { prepareImageUpload } from "./prepare-image-upload"
import {
  fileReferenceFeedback,
  isFileReference,
} from "./material-reference-feedback"
import {
  getUploadRetrySource,
  releaseUploadRetrySource,
  rememberUploadRetrySource,
} from "./upload-retry-sources"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

type Update = (apply: (materials: Material[]) => Material[]) => void
type RetrySource = { type: "path"; path: string }

/** A failed check may precede stat; preserve the already selected reference kind. */
function withSelectedReferenceType(
  result: Material,
  selected?: Material
): Material {
  return result.status === "failed" &&
    (selected?.type === "file" || selected?.type === "directory")
    ? { ...result, type: selected.type }
    : result
}

function hasActualPath(material: Material) {
  return (
    !!material.source && /^(?:[a-z]:[\\/]|[\\/]{2}|\/)/i.test(material.source)
  )
}
function canPreparePath(material: Material) {
  return (
    hasActualPath(material) &&
    (material.type !== "image" || /^preparing:/.test(material.id))
  )
}

function isTemporaryUpload(material: Material) {
  return (
    (material.type === "image" || material.type === "file") &&
    /^preparing:[a-zA-Z0-9-]+$/.test(material.id) &&
    !hasActualPath(material)
  )
}

export function useComposerMaterials({
  sessionId = "",
  cwd,
  anchorRef,
  materials,
  update,
  disabled = false,
  onSelectionActivity,
  onPasteText,
}: {
  sessionId?: string
  cwd: string
  anchorRef: RefObject<HTMLDivElement | null>
  materials: Material[]
  update: Update
  disabled?: boolean
  onSelectionActivity?: (active: boolean) => void
  onPasteText?: (text: string, start: number, end: number) => void
}) {
  const service = useContext(MaterialServiceContext)
  const scope = `${sessionId}:${cwd}`
  const scopeOwner = useRef({ scope })
  const latest = useRef({
    materials,
    update,
    disabled,
    scope,
    onPasteText,
  })
  useLayoutEffect(() => {
    latest.current = { materials, update, disabled, scope, onPasteText }
  }, [materials, update, disabled, scope, onPasteText])
  const [dropState, setDropState] = useState({ scope, active: false })
  const [action, setAction] = useState({
    scope: `${sessionId}:${cwd}`,
    choosing: false,
    feedback: undefined as FeedbackDescription | undefined,
  })
  const [validationRevision, setValidationRevision] = useState(0)
  const requests = useRef(new Set<AbortController>())
  const alive = useRef(true)
  const selectionReleases = useRef(new Set<() => void>())
  function owns(owner: typeof scopeOwner.current) {
    return (
      alive.current &&
      latest.current.scope === scope &&
      scopeOwner.current === owner
    )
  }
  const choosing = action.scope === scope && action.choosing
  const feedback = action.scope === scope ? action.feedback : undefined
  const error = feedback?.code === "cancelled" ? "" : (feedback?.message ?? "")
  const verified = useRef(new Set<string>())
  const [verifiedKeys, setVerifiedKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  function markVerified(items: { id: string }[]) {
    for (const item of items) verified.current.add(`${scope}:${item.id}`)
    // Event ownership is synchronous; presentation reads the immutable snapshot.
    setVerifiedKeys(new Set(verified.current))
    const references = items.filter((value): value is Material => {
      const item = value as Partial<Material>
      return (
        item.status === "ready" &&
        !!item.source &&
        typeof item.name === "string" &&
        typeof item.kind === "string" &&
        ["file", "directory", "skill"].includes(item.type ?? "")
      )
    })
    if (references.length)
      setReferenceHistory((current) => ({
        scope,
        items: [
          ...(current.scope === scope ? current.items : []).filter(
            (old) =>
              !references.some(
                (item) => old.source === item.source && old.type === item.type
              )
          ),
          ...references,
        ],
      }))
  }
  const [referenceHistory, setReferenceHistory] = useState<{
    scope: string
    items: Material[]
  }>({ scope, items: [] })
  const preparing = useRef(new Set<string>())
  // Only retain sources for unfinished preparation. Prepared images continue
  // to use their fixed host identity instead of silently rereading a disk file.
  const retrySources = useRef(new Map<string, RetrySource>())
  const selectedUploads = useRef(new Set<string>())
  const [retrySourceKeys, setRetrySourceKeys] = useState({
    scope,
    ids: new Set<string>(),
  })
  function syncRetrySources() {
    setRetrySourceKeys({ scope, ids: new Set(retrySources.current.keys()) })
  }
  useLayoutEffect(() => {
    const pendingRequests = requests.current
    const pendingMaterials = preparing.current
    const verifiedMaterials = verified.current
    const pendingSources = retrySources.current
    const pendingSelections = selectionReleases.current
    const pendingUploads = selectedUploads.current
    // The owner is a fresh identity, even if A -> B -> A repeats the cwd text
    // or React restarts these effects. Old catch/finally work cannot edit A again.
    scopeOwner.current = { scope }
    alive.current = true
    if (service)
      for (const item of latest.current.materials)
        if (getUploadRetrySource(service, sessionId, cwd, item.id))
          pendingUploads.add(item.id)
    return () => {
      alive.current = false
      for (const release of pendingSelections) release()
      for (const request of pendingRequests) request.abort()
      pendingRequests.clear()
      pendingMaterials.clear()
      verifiedMaterials.clear()
      pendingSources.clear()
      // Another composer in this same session may adopt an unfinished upload.
      // The bounded service-owned registry expires abandoned Files separately.
      pendingUploads.clear()
    }
  }, [scope, service, sessionId, cwd])
  const referenceSignature = materials
    .map((item) => `${item.id}:${item.source}`)
    .join("\n")
  useEffect(() => {
    const selected = new Set(materials.map((item) => item.id))
    for (const id of retrySources.current.keys())
      if (!selected.has(id)) retrySources.current.delete(id)
    if (!service) return
    for (const id of selectedUploads.current) {
      const item = materials.find((candidate) => candidate.id === id)
      if (!item || item.status === "ready" || item.retryable === false) {
        releaseUploadRetrySource(service, sessionId, cwd, id)
        selectedUploads.current.delete(id)
      }
    }
    for (const item of materials)
      if (getUploadRetrySource(service, sessionId, cwd, item.id))
        selectedUploads.current.add(item.id)
  }, [materials, service, sessionId, cwd])
  useEffect(() => {
    if (!service || !sessionId || !cwd) return
    const owner = scopeOwner.current
    const pending = materials.filter(
      (item) =>
        !verified.current.has(`${scope}:${item.id}`) &&
        !preparing.current.has(item.id)
    )
    // A provisional browser upload has no host record. Restore its local failure,
    // not an unknown RPC identity; a retained File is the only retry source.
    const localUploads = pending.filter(
      (item) => isTemporaryUpload(item) && item.status !== "ready"
    )
    if (localUploads.length) {
      const localIds = new Set(localUploads.map((item) => item.id))
      markVerified(localUploads)
      latest.current.update((current) =>
        current.map((item) =>
          !localIds.has(item.id)
            ? item
            : item.retryable === false
              ? { ...item, status: "failed" }
              : getUploadRetrySource(service, sessionId, cwd, item.id)
                ? {
                    ...item,
                    status: "failed",
                    retryable: true,
                    error: item.error || "图片尚未准备，重试后再发送。",
                  }
                : {
                    ...item,
                    status: "failed",
                    retryable: false,
                    error:
                      item.type === "file"
                        ? item.error ||
                          "浏览器拖入的普通文件缺少实际路径，请使用“添加附件”从系统选择。"
                        : item.error
                          ? `${item.error} 图片准备来源已失效，请重新选择或移除。`
                          : "图片准备已中断，请重新选择或移除。",
                  }
        )
      )
    }
    const unverified = pending.filter(
      (item) => !localUploads.some((candidate) => candidate.id === item.id)
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
        if (controller.signal.aborted || !owns(owner)) return
        const ownedRestored = restored.map((item) => {
          const original = unverified.find((old) => old.id === item.id)
          return { ...original, ...withSelectedReferenceType(item, original) }
        })
        markVerified(ownedRestored)
        latest.current.update((current) =>
          current.map((item) => {
            const value = ownedRestored.find(
              (candidate) => candidate.id === item.id
            )
            return value
              ? {
                  ...item,
                  ...value,
                  error: value.error,
                  retryable: value.retryable,
                }
              : item
          })
        )
        setAction((current) =>
          current.scope === scope && current.feedback?.code === "cancelled"
            ? { ...current, feedback: undefined }
            : current
        )
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || !owns(owner)) return
        const description = feedbackFromError(
          failure,
          "材料来源未能核对，请重新选择或移除。"
        )
        if (description.code === "cancelled") {
          latest.current.update((current) =>
            current.map((item) => {
              const original = unverified.find(
                (candidate) => candidate.id === item.id
              )
              return original ?? item
            })
          )
          setAction({
            scope,
            choosing: false,
            feedback: {
              ...description,
              message: "材料核对已取消，重新检查后再发送。",
              recovery: "retry",
            },
          })
          return
        }
        markVerified(Array.from(ids, (id) => ({ id })))
        latest.current.update((current) =>
          current.map((item) =>
            ids.has(item.id)
              ? {
                  ...item,
                  status: "failed",
                  error: description.message,
                  retryable: description.recovery !== "none",
                }
              : item
          )
        )
      })
    return () => controller.abort()
    // Whole drafts are owned and persisted by the application, not this hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, sessionId, cwd, scope, referenceSignature, validationRevision])
  function append(items: Material[]) {
    latest.current.update((current) => appendPreparedMaterials(current, items))
  }
  async function operation<T>(
    action: (signal: AbortSignal) => Promise<T>,
    accept: (result: T) => void
  ) {
    // Entry points gate new work. Once reading an image has started, a temporary
    // disabled phase must not strand its placeholder; ownership changes still
    // cancel it and prevent a result from reaching another draft.
    if (!alive.current || latest.current.scope !== scope) return
    const owner = scopeOwner.current
    const controller = new AbortController()
    requests.current.add(controller)
    try {
      const result = await action(controller.signal)
      if (!controller.signal.aborted && owns(owner)) accept(result)
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
    const owner = scopeOwner.current
    const releaseSelection = () => {
      if (selectionReleases.current.delete(releaseSelection))
        onSelectionActivity?.(false)
    }
    selectionReleases.current.add(releaseSelection)
    onSelectionActivity?.(true)
    setAction({ scope, choosing: true, feedback: undefined })
    try {
      await operation(
        (signal) => service.choose(sessionId, cwd, signal),
        (items) => {
          for (const item of items)
            if (
              item.status === "failed" &&
              item.retryable !== false &&
              hasActualPath(item)
            )
              retrySources.current.set(item.id, {
                type: "path",
                path: item.source!,
              })
          syncRetrySources()
          const attachments = items.map((item) => ({
            ...item,
            presentation: "attachment" as const,
          }))
          markVerified(attachments)
          append(attachments)
        }
      )
    } catch (failure) {
      const description = feedbackFromError(
        failure,
        "附件未能添加，当前草稿已保留。"
      )
      if (owns(owner) && description.code !== "cancelled")
        setAction({ scope, choosing: false, feedback: description })
    } finally {
      releaseSelection()
      if (owns(owner))
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
    const owner = scopeOwner.current
    if (!service || !source.source) {
      latest.current.update((current) =>
        appendPreparedMaterials(current, [
          { ...source, presentation: source.presentation ?? "reference" },
        ])
      )
      return
    }
    const placeholder = {
      ...source,
      presentation: source.presentation ?? ("reference" as const),
      id: `preparing:${crypto.randomUUID()}`,
      status: "preparing" as const,
    }
    if (latest.current.materials.some((item) => sameMaterial(item, source)))
      return
    preparing.current.add(placeholder.id)
    retrySources.current.set(placeholder.id, {
      type: "path",
      path: source.source,
    })
    syncRetrySources()
    latest.current.update((current) =>
      appendPreparedMaterials(current, [placeholder])
    )
    try {
      await operation(
        (signal) => service.prepare(sessionId, cwd, [source.source!], signal),
        (prepared) => {
          for (const item of prepared)
            if (item.status === "failed" && item.retryable !== false)
              retrySources.current.set(item.id, {
                type: "path",
                path: source.source!,
              })
          syncRetrySources()
          const references = prepared.map((item) => ({
            ...withSelectedReferenceType(item, placeholder),
            presentation: placeholder.presentation,
          }))
          markVerified(references)
          latest.current.update((current) =>
            appendPreparedMaterials(
              [],
              current.flatMap((item) =>
                item.id === placeholder.id ? references : [item]
              )
            )
          )
        }
      )
    } catch (failure) {
      if (owns(owner)) {
        const description = feedbackFromError(
          failure,
          fileReferenceFeedback({ ...placeholder, status: "failed" })
            ?.message ?? "材料未能准备，请重新选择或移除。"
        )
        if (description.code === "cancelled") {
          latest.current.update((current) =>
            current.filter((item) => item.id !== placeholder.id)
          )
          return
        }
        latest.current.update((current) =>
          current.map((item) =>
            item.id === placeholder.id
              ? {
                  ...item,
                  status: "failed",
                  error: description.message,
                  retryable: description.recovery !== "none",
                }
              : item
          )
        )
        if (description.recovery === "none") {
          retrySources.current.delete(placeholder.id)
          syncRetrySources()
        }
      }
    } finally {
      if (owns(owner)) preparing.current.delete(placeholder.id)
    }
  }
  async function upload(file: File) {
    if (
      !alive.current ||
      latest.current.disabled ||
      latest.current.scope !== scope
    )
      return
    const owner = scopeOwner.current
    const placeholder: Material = {
      id: `preparing:${crypto.randomUUID()}`,
      name: file.name || "粘贴图片.png",
      kind: "附件",
      presentation: "attachment",
      type: file.type.startsWith("image/") ? "image" : "file",
      status: "preparing",
      source: file.type.startsWith("image/")
        ? "粘贴或拖入的图片"
        : "浏览器拖入的文件",
    }
    preparing.current.add(placeholder.id)
    append([placeholder])
    let invalidInput = false
    try {
      if (!service) throw new Error("当前环境未连接材料服务。")
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        invalidInput = true
        throw new Error(
          file.type.startsWith("image/")
            ? "图片格式不支持，仅支持 PNG、JPEG、WebP、GIF，请重新选择或移除。"
            : "浏览器拖入的普通文件缺少实际路径，请使用“添加附件”从系统选择。"
        )
      }
      if (file.size > 8 * 1024 * 1024) {
        invalidInput = true
        throw new Error("图片超过8MiB，请选择较小图片或移除。")
      }
      rememberUploadRetrySource(service, sessionId, cwd, placeholder.id, file)
      selectedUploads.current.add(placeholder.id)
      await operation(
        (signal) =>
          prepareImageUpload({
            service,
            sessionId,
            cwd,
            file,
            name: placeholder.name,
            signal,
          }),
        (prepared) => {
          releaseUploadRetrySource(service, sessionId, cwd, placeholder.id)
          selectedUploads.current.delete(placeholder.id)
          const attachment = {
            ...prepared,
            presentation: "attachment" as const,
          }
          markVerified([attachment])
          latest.current.update((current) =>
            appendPreparedMaterials(
              [],
              current.map((item) =>
                item.id === placeholder.id ? attachment : item
              )
            )
          )
        }
      )
    } catch (failure) {
      if (owns(owner)) {
        const description = feedbackFromError(
          failure,
          "图片未能准备，请重新选择或移除。"
        )
        if (description.code === "cancelled") {
          if (service)
            releaseUploadRetrySource(service, sessionId, cwd, placeholder.id)
          selectedUploads.current.delete(placeholder.id)
          latest.current.update((current) =>
            current.filter((item) => item.id !== placeholder.id)
          )
          return
        }
        const retryable = !invalidInput && description.recovery !== "none"
        // This attempt has settled in this owner. Further draft validation must
        // not replace its real reason with a missing host-record error.
        markVerified([placeholder])
        latest.current.update((current) =>
          current.map((item) =>
            item.id === placeholder.id
              ? {
                  ...item,
                  status: "failed",
                  error: description.message,
                  retryable,
                }
              : item
          )
        )
        if (!retryable) {
          if (service)
            releaseUploadRetrySource(service, sessionId, cwd, placeholder.id)
          selectedUploads.current.delete(placeholder.id)
        }
      }
    } finally {
      if (owns(owner)) preparing.current.delete(placeholder.id)
    }
  }
  function canRetry(id: string) {
    const item = materials.find((candidate) => candidate.id === id)
    return !!(
      service &&
      sessionId &&
      cwd &&
      !disabled &&
      item?.status === "failed" &&
      item.retryable !== false &&
      ((retrySourceKeys.scope === scope && retrySourceKeys.ids.has(id)) ||
        (item.type === "image" &&
          getUploadRetrySource(service, sessionId, cwd, id)) ||
        /^[a-f0-9]{64}$/.test(id) ||
        canPreparePath(item))
    )
  }
  function retryLabel(id: string) {
    const item = materials.find((candidate) => candidate.id === id)
    if (item && isFileReference(item)) return "重新检查"
    return (retrySourceKeys.scope === scope && retrySourceKeys.ids.has(id)) ||
      (service && getUploadRetrySource(service, sessionId, cwd, id))
      ? "重试准备"
      : "重新检查"
  }
  async function retry(id: string) {
    const original = latest.current.materials.find((item) => item.id === id)
    if (
      !alive.current ||
      !service ||
      latest.current.disabled ||
      latest.current.scope !== scope ||
      original?.status !== "failed" ||
      preparing.current.has(id)
    )
      return
    const owner = scopeOwner.current
    const file =
      original.type === "image"
        ? getUploadRetrySource(service, sessionId, cwd, id)
        : undefined
    if (
      original.type === "image" &&
      /^preparing:/.test(id) &&
      original.retryable !== false &&
      !file &&
      !retrySources.current.has(id) &&
      !canPreparePath(original)
    ) {
      // A previously rendered retry may be clicked after bounded memory expires.
      // Explain the missing local source instead of issuing a futile RPC.
      latest.current.update((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "failed",
                retryable: false,
                error: "图片准备来源已失效，请重新选择。",
              }
            : item
        )
      )
      return
    }
    if (!canRetry(id)) return
    const source =
      retrySources.current.get(id) ??
      (file ? { type: "upload" as const, file } : undefined) ??
      (canPreparePath(original)
        ? { type: "path" as const, path: original.source! }
        : undefined)
    preparing.current.add(id)
    if (file) rememberUploadRetrySource(service, sessionId, cwd, id, file)
    verified.current.delete(`${scope}:${id}`)
    setVerifiedKeys(new Set(verified.current))
    latest.current.update((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, status: "preparing", error: undefined }
          : item
      )
    )
    setAction((current) => ({ ...current, scope, feedback: undefined }))
    try {
      await operation(
        async (signal) => {
          if (source?.type === "path")
            return service.prepare(sessionId, cwd, [source.path], signal)
          if (source?.type === "upload") {
            return [
              await prepareImageUpload({
                service,
                sessionId,
                cwd,
                file: source.file,
                name: original.name,
                signal,
              }),
            ]
          }
          return service.restore(sessionId, cwd, [original], signal)
        },
        (restored) => {
          const result = restored[0]
          const value = result && withSelectedReferenceType(result, original)
          if (!value)
            throw new Error(
              isFileReference(original)
                ? "引用未返回检查结果，请重新检查。"
                : "材料未返回准备结果，请重试。"
            )
          markVerified([{ ...original, ...value }])
          // Keep the selected position and use the authority-generated ID. An
          // existing reference keeps its ID; a provisional upload/path item is
          // replaced in place rather than appended as a duplicate.
          latest.current.update((current) =>
            appendPreparedMaterials(
              [],
              current.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      ...value,
                      error: value.error,
                      retryable: value.retryable,
                    }
                  : item
              )
            )
          )
          if (value.status === "ready" || value.retryable === false) {
            retrySources.current.delete(id)
            releaseUploadRetrySource(service, sessionId, cwd, id)
            selectedUploads.current.delete(id)
          } else if (source?.type === "path") {
            retrySources.current.delete(id)
            retrySources.current.set(value.id, source)
          } else if (file && value.id !== id) {
            releaseUploadRetrySource(service, sessionId, cwd, id)
            selectedUploads.current.delete(id)
            rememberUploadRetrySource(service, sessionId, cwd, value.id, file)
            selectedUploads.current.add(value.id)
          }
          syncRetrySources()
        }
      )
    } catch (failure) {
      if (!owns(owner)) return
      const description = feedbackFromError(
        failure,
        fileReferenceFeedback({ ...original, status: "failed" })?.message ??
          "材料未能重新检查，请重试或移除。"
      )
      markVerified([{ id }])
      latest.current.update((current) =>
        current.map((item) =>
          item.id === id
            ? description.code === "cancelled"
              ? original
              : {
                  ...item,
                  status: "failed",
                  error: description.message,
                  retryable: description.recovery !== "none",
                }
            : item
        )
      )
      if (description.recovery === "none") {
        releaseUploadRetrySource(service, sessionId, cwd, id)
        selectedUploads.current.delete(id)
        retrySources.current.delete(id)
        syncRetrySources()
      }
      if (description.code === "cancelled")
        setAction({
          scope,
          choosing: false,
          feedback: {
            ...description,
            message: "材料检查已取消，原条目已保留。",
            recovery: "retry",
          },
        })
    } finally {
      if (owns(owner)) preparing.current.delete(id)
    }
  }
  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const owner = scopeOwner.current
    const showDrop = (active: boolean) => {
      if (owns(owner))
        setDropState((current) =>
          current.scope === scope && current.active === active
            ? current
            : { scope, active }
        )
    }
    const paste = (event: ClipboardEvent) => {
      if (!owns(owner) || latest.current.disabled || !service || !cwd) return
      const images = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((item): item is File => !!item)
      if (images.length) {
        event.preventDefault()
        event.stopPropagation()
        const text = event.clipboardData?.getData("text/plain") ?? ""
        const input =
          event.target instanceof Element ? composerEditor(anchor) : null
        if (text && input && latest.current.onPasteText) {
          const start = input.selectionStart
          latest.current.onPasteText(text, start, input.selectionEnd)
          requestAnimationFrame(() => {
            if (owns(owner) && input.isConnected)
              input.setSelectionRange(start + text.length, start + text.length)
          })
        }
        for (const image of images) void upload(image)
      }
    }
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return
      event.preventDefault()
      showDrop(false)
      if (!owns(owner) || latest.current.disabled || !service || !cwd) return
      if (!isTauri())
        for (const file of Array.from(event.dataTransfer.files))
          void upload(file)
    }
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault()
        showDrop(true)
      }
    }
    const leave = (event: DragEvent) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !anchor.contains(event.relatedTarget)
      )
        showDrop(false)
    }
    anchor.addEventListener("paste", paste, true)
    anchor.addEventListener("drop", drop)
    anchor.addEventListener("dragover", over)
    anchor.addEventListener("dragleave", leave)
    let unlisten: (() => void) | undefined
    let disposed = false
    if (isTauri())
      void import("@tauri-apps/api/webviewWindow")
        .then(({ getCurrentWebviewWindow }) =>
          getCurrentWebviewWindow().onDragDropEvent((event) => {
            if (!owns(owner)) return
            if (event.payload.type === "leave") {
              showDrop(false)
              return
            }
            const rect = anchor.getBoundingClientRect()
            const scale = window.devicePixelRatio || 1
            const { x, y } = event.payload.position
            const inside = !(
              x / scale < rect.left ||
              x / scale > rect.right ||
              y / scale < rect.top ||
              y / scale > rect.bottom
            )
            showDrop(inside && event.payload.type !== "drop")
            if (
              event.payload.type !== "drop" ||
              !inside ||
              latest.current.disabled ||
              !service ||
              !cwd
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
                presentation: "attachment",
              })
          })
        )
        .then((unsubscribe) => {
          if (disposed) unsubscribe()
          else unlisten = unsubscribe
        })
        .catch((failure: unknown) => {
          if (
            !disposed &&
            owns(owner) &&
            feedbackFromError(failure).code !== "cancelled"
          )
            setAction({
              scope,
              choosing: false,
              feedback: {
                message: "拖放监听不可用，请通过“添加附件”选择文件。",
                code: "drop_unavailable",
                recovery: "none",
              },
            })
        })
    return () => {
      disposed = true
      unlisten?.()
      anchor.removeEventListener("paste", paste, true)
      anchor.removeEventListener("drop", drop)
      anchor.removeEventListener("dragover", over)
      anchor.removeEventListener("dragleave", leave)
    }
    // Event callbacks read latest draft references rather than mounting anew on edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, scope, cwd, anchorRef])
  const ready =
    !choosing &&
    (!service ||
      materials.every(
        (item) =>
          item.status === "ready" && verifiedKeys.has(`${scope}:${item.id}`)
      ))
  return {
    service,
    referenceIdentities:
      referenceHistory.scope === scope ? referenceHistory.items : [],
    ready,
    choosing,
    dropActive: dropState.scope === scope && dropState.active,
    error,
    feedback,
    choose,
    prepare,
    retry,
    canRetry,
    retryLabel,
    clearError: () =>
      setAction((current) => ({ ...current, scope, feedback: undefined })),
    recheck: () => {
      if (
        !alive.current ||
        latest.current.disabled ||
        latest.current.scope !== scope
      )
        return
      for (const item of latest.current.materials)
        verified.current.delete(`${scope}:${item.id}`)
      setVerifiedKeys(new Set(verified.current))
      setAction((current) => ({ ...current, scope, feedback: undefined }))
      setValidationRevision((value) => value + 1)
    },
  }
}
