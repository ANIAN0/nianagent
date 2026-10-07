import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CatalogViewportControls } from "./catalog-viewport-controls"
import type { useCatalogController } from "./use-catalog-controller"

export function CatalogToolbar({
  controller,
}: {
  controller: ReturnType<typeof useCatalogController>
}) {
  const { selection, theme, width, height, previewUrl } = controller
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
  return (
    <div className="catalog-toolbar">
      <div className="catalog-viewbar">
        <Tabs
          value={selection.view}
          onValueChange={(view) => {
            if (entry)
              controller.navigate(
                entry,
                view === "canvas"
                  ? (state?.id ?? entry.states[0]?.id)
                  : undefined
              )
          }}
        >
          <TabsList aria-label="组件查看方式">
            <TabsTrigger value="docs">设计标准</TabsTrigger>
            <TabsTrigger value="canvas">交互预览</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="catalog-tools-actions">
          <Button variant="ghost" size="sm" onClick={controller.toggleTheme}>
            {theme === "dark" ? "浅色" : "深色"}
          </Button>
          <Button variant="ghost" size="sm" onClick={copyLink}>
            复制链接
          </Button>
        </div>
      </div>
      {entry && state && selection.view === "canvas" && (
        <div className="catalog-tools">
          <Select
            value={state.id}
            onValueChange={(id) => controller.navigate(entry, id)}
          >
            <SelectTrigger size="sm" aria-label="预览状态">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {entry.states
                  .filter(
                    (item) =>
                      !selection.section || item.section === selection.section
                  )
                  .map((item) => (
                    <SelectItem value={item.id} key={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <CatalogViewportControls
            width={width}
            height={height}
            defaultViewport={entry.viewport}
            onChange={controller.setViewport}
          />
          <div className="catalog-tools-actions">
            <Button variant="ghost" size="sm" onClick={controller.reset}>
              <RotateCcw data-icon="inline-start" />
              重置
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={previewUrl} target="_blank" rel="noreferrer">
                独立打开
                <ArrowUpRight data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </div>
      )}
      {copyStatus && (
        <p className="catalog-tool-feedback" role="status">
          {copyStatus}
        </p>
      )}
    </div>
  )
}
