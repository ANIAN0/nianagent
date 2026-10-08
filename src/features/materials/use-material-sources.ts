import type { MaterialService } from "./material-service"
import type { Dispatch, SetStateAction } from "react"
import { useEffect, type RefObject } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { composerEditor } from "@/components/composer/composer-editor-contract"
import type { Material } from "@/lib/composer/types"

import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

type Update = (apply: (materials: Material[]) => Material[]) => void

/** 只维护这一组状态的所有权，迟到结果仍按原身份核对。 */
export function useMaterialSources({
  anchorNode,
  scopeOwner,
  owns,
  setDropState,
  scope,
  latest,
  service,
  cwd,
  upload,
  prepare,
  setAction,
}: {
  anchorNode: HTMLDivElement | null
  scopeOwner: RefObject<{ scope: string }>
  owns: (owner: { scope: string }) => boolean
  setDropState: Dispatch<SetStateAction<{ scope: string; active: boolean }>>
  scope: string
  latest: RefObject<{
    materials: Material[]
    update: Update
    disabled: boolean
    scope: string
    onPasteText:
      ((text: string, start: number, end: number) => void) | undefined
  }>
  service: MaterialService | null
  cwd: string
  upload: (file: File) => Promise<void>
  prepare: (source: Material) => Promise<void>
  setAction: Dispatch<
    SetStateAction<{
      scope: string
      choosing: boolean
      feedback: FeedbackDescription | undefined
    }>
  >
}) {
  useEffect(() => {
    const anchor = anchorNode
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
          event.target instanceof HTMLTextAreaElement
            ? event.target
            : event.target instanceof Element
              ? composerEditor(anchor)
              : null
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
  }, [service, scope, cwd, anchorNode])
}
