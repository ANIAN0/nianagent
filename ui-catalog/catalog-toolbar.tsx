import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, ChevronDown, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CatalogViewportControls } from "./catalog-viewport-controls"
import type { useCatalogController } from "./use-catalog-controller"
export function CatalogToolbar({
  controller,
}: {
  controller: ReturnType<typeof useCatalogController>
}) {
  const { selection, width, height, previewUrl, fixedViewport } = controller
  const { entry, state } = selection
  const [copyStatus, setCopyStatus] = useState("")
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copyLink() {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(controller.shareUrl())
      setCopyStatus("链接已复制")
    } catch {
      setCopyStatus("复制失败，请复制浏览器地址")
    }
    timer.current = setTimeout(() => setCopyStatus(""), 3000)
  }
  if (!entry || !state) return null
  return (
    <div className="catalog-toolbar">
      <strong className="catalog-scene-label" title={state.name}>
        {state.name}
      </strong>
      <div className="catalog-tools-actions">
        <Button variant="ghost" size="sm" onClick={copyLink}>
          复制链接
        </Button>
        <Button variant="ghost" size="sm" onClick={controller.reset}>
          <RotateCcw data-icon="inline-start" />
          重置
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={previewUrl} target="_blank" rel="noreferrer">
            独立打开
            <ArrowUpRight data-icon="inline-end" />
          </a>
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              {fixedViewport ? `${width} × ${height}` : "自适应"}
              <ChevronDown data-icon="inline-end" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="catalog-display-panel">
            <Button
              variant={fixedViewport ? "outline" : "secondary"}
              size="sm"
              onClick={controller.fitViewport}
            >
              适应空间
            </Button>
            <CatalogViewportControls
              width={width}
              height={height}
              defaultViewport={entry.viewport}
              onChange={controller.setViewport}
            />
          </PopoverContent>
        </Popover>
        {copyStatus && (
          <span role="status" className="devtools-muted">
            {copyStatus}
          </span>
        )}
      </div>
    </div>
  )
}
