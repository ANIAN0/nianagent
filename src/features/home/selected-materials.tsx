import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { AttachmentGroup } from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { InputGroupAddon } from "@/components/ui/input-group"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import { MaterialChip } from "./material-chip"
import type { Material } from "./home-types"

export type SelectedMaterialsProps = {
  inlineReferences?: boolean
  materials: Material[]
  onRemove: (id: string) => void
  onRetry?: (id: string) => void
  canRetry?: (material: Material) => boolean
  retryLabel?: (material: Material) => string
  cwd?: string
}
export function SelectedMaterials({
  materials: allMaterials,
  inlineReferences = false,
  onRemove,
  onRetry,
  canRetry,
  retryLabel,
  cwd = "",
}: SelectedMaterialsProps) {
  const materials = inlineReferences
    ? allMaterials.filter(
        (item) =>
          !(
            (item.type === "file" || item.type === "directory") &&
            item.status === "ready"
          )
      )
    : allMaterials
  const [active, setActive] = useState<Material | null>(null)
  const rail = useRef<HTMLDivElement>(null)
  const previousCount = useRef(materials.length)
  const [edges, setEdges] = useState({ left: false, right: false })
  const updateEdges = useCallback(() => {
    const element = rail.current
    if (!element) return
    const left = element.scrollLeft > 1
    const right =
      element.scrollLeft < element.scrollWidth - element.clientWidth - 1
    setEdges((current) =>
      current.left === left && current.right === right
        ? current
        : { left, right }
    )
  }, [])
  const visible = materials.length > 0
  useEffect(() => {
    const element = rail.current
    if (!element) return
    const observer = new ResizeObserver(updateEdges)
    observer.observe(element)
    const wheel = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth || event.ctrlKey) return
      const delta = event.deltaX || event.deltaY
      if (!delta) return
      const hasRoom =
        delta > 0
          ? element.scrollLeft < element.scrollWidth - element.clientWidth - 1
          : element.scrollLeft > 1
      if (!hasRoom) return
      event.preventDefault()
      element.scrollBy({ left: delta, behavior: "auto" })
    }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => {
      observer.disconnect()
      element.removeEventListener("wheel", wheel)
    }
  }, [visible, updateEdges])
  useEffect(() => {
    const count = materials.length
    const frame = requestAnimationFrame(() => {
      const element = rail.current
      if (element && count > previousCount.current)
        element.scrollTo({ left: element.scrollWidth, behavior: "auto" })
      previousCount.current = count
      updateEdges()
    })
    return () => cancelAnimationFrame(frame)
  }, [materials.length, updateEdges])
  function page(direction: -1 | 1) {
    const element = rail.current
    if (!element) return
    element.scrollBy({
      left: direction * Math.max(element.clientWidth - 64, 120),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    })
    element.focus({ preventScroll: true })
  }
  if (!visible) return null
  // A preview belongs to a currently selected item. Removing it or changing the
  // draft cannot keep a dialog alive for a different collection.
  const preview = materials.find((item) => item.id === active?.id) ?? null
  return (
    <>
      <InputGroupAddon align="block-start" className="min-w-0 px-3.5 pt-3">
        <div className="relative w-full min-w-0">
          <AttachmentGroup
            ref={rail}
            role="group"
            aria-label="已选材料，使用左右方向键滚动"
            tabIndex={0}
            onScroll={updateEdges}
            onFocusCapture={(event) => {
              if (event.target === event.currentTarget) return
              const item = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-slot=attachment]"
              )
              if (!item) return
              const element = event.currentTarget
              const bounds = item.getBoundingClientRect()
              const viewport = element.getBoundingClientRect()
              if (bounds.left < viewport.left)
                element.scrollBy({ left: bounds.left - viewport.left - 4 })
              else if (bounds.right > viewport.right)
                element.scrollBy({ left: bounds.right - viewport.right + 4 })
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault()
                page(event.key === "ArrowLeft" ? -1 : 1)
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault()
                event.currentTarget.scrollTo({
                  left:
                    event.key === "Home" ? 0 : event.currentTarget.scrollWidth,
                  behavior: "auto",
                })
              }
            }}
            className="max-h-[72px] w-full items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {materials.map((item) => (
              <MaterialChip
                key={item.id}
                material={item}
                cwd={cwd}
                onRemove={onRemove}
                onPreview={setActive}
                onRetry={
                  onRetry && (canRetry?.(item) ?? item.status === "failed")
                    ? onRetry
                    : undefined
                }
                retryLabel={retryLabel?.(item)}
              />
            ))}
          </AttachmentGroup>
          <MaterialRailNavigation
            left={edges.left}
            right={edges.right}
            onPage={page}
          />
        </div>
      </InputGroupAddon>
      <MaterialPreviewDialog
        material={preview}
        cwd={cwd}
        onClose={() => setActive(null)}
      />
    </>
  )
}

/** These are navigation actions even when composed inside a message form. */
export function MaterialRailNavigation({
  left,
  right,
  onPage,
}: {
  left: boolean
  right: boolean
  onPage: (direction: -1 | 1) => void
}) {
  if (!left && !right) return null
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        className="absolute top-1/2 left-0 z-20 -translate-y-1/2 rounded-full shadow-sm"
        aria-label="向左滚动材料"
        disabled={!left}
        onClick={() => onPage(-1)}
      >
        <ChevronLeft />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        className="absolute top-1/2 right-0 z-20 -translate-y-1/2 rounded-full shadow-sm"
        aria-label="向右滚动材料"
        disabled={!right}
        onClick={() => onPage(1)}
      >
        <ChevronRight />
      </Button>
    </>
  )
}
