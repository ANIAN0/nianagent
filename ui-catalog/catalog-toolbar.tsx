import { useEffect, useRef, useState } from "react"
import {
  ArrowUpRight,
  Check,
  Copy,
  FileText,
  Moon,
  PanelsTopLeft,
  RotateCcw,
  Sun,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { symbolOf } from "./catalog"
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
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const copyGeneration = useRef(0)
  useEffect(
    () => () => {
      copyGeneration.current += 1
      clearTimeout(feedbackTimer.current)
    },
    []
  )
  async function copyLink() {
    const generation = ++copyGeneration.current
    clearTimeout(feedbackTimer.current)
    try {
      await navigator.clipboard.writeText(controller.shareUrl())
      if (generation !== copyGeneration.current) return
      setCopyStatus("链接已复制")
    } catch {
      if (generation !== copyGeneration.current) return
      setCopyStatus("无法复制，请复制浏览器地址")
    }
    feedbackTimer.current = setTimeout(() => setCopyStatus(""), 3000)
  }
  return (
    <div className="catalog-toolbar">
      <div className="catalog-viewbar">
        {entry ? (
          <div
            className="catalog-view-switcher"
            role="group"
            aria-label="组件查看方式"
          >
            <Button
              size="sm"
              variant={selection.view === "docs" ? "secondary" : "ghost"}
              aria-pressed={selection.view === "docs"}
              onClick={() => controller.navigate(entry)}
            >
              <FileText data-icon="inline-start" />
              概览
            </Button>
            <Button
              size="sm"
              variant={selection.view === "canvas" ? "secondary" : "ghost"}
              aria-pressed={selection.view === "canvas"}
              onClick={() =>
                controller.navigate(entry, state?.id ?? entry.states[0]?.id)
              }
            >
              <PanelsTopLeft data-icon="inline-start" />
              画布
            </Button>
          </div>
        ) : (
          <span>组件预览</span>
        )}
        <div className="catalog-current">
          <strong>{entry?.name ?? "未知组件"}</strong>
          {entry && <code>{symbolOf(entry)}</code>}
        </div>
      </div>
      <div className="catalog-tools">
        <div className="catalog-tools-primary">
          {entry && selection.view === "canvas" ? (
            <>
              <Select
                value={state?.id ?? ""}
                onValueChange={(id) => controller.navigate(entry, id)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="预览状态"
                  className="catalog-state-select"
                >
                  <SelectValue placeholder="选择状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {entry.states.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
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
            </>
          ) : (
            <span className="catalog-tools-hint">
              {entry
                ? `${entry.states.length} 个状态 · 展开示例查看交互`
                : "从组件树选择开始"}
            </span>
          )}
        </div>
        <div className="catalog-tools-actions">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
            title={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
            onClick={controller.toggleTheme}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="重置当前状态"
            title="重置当前状态"
            disabled={!entry}
            onClick={controller.reset}
          >
            <RotateCcw />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="复制当前链接"
            title="复制当前链接"
            onClick={copyLink}
          >
            {copyStatus === "链接已复制" ? <Check /> : <Copy />}
          </Button>
          {entry && state ? (
            <Button variant="outline" size="sm" asChild>
              <a href={previewUrl} target="_blank" rel="noreferrer">
                独立打开
                <ArrowUpRight data-icon="inline-end" />
              </a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              独立打开
              <ArrowUpRight data-icon="inline-end" />
            </Button>
          )}
        </div>
        {copyStatus && (
          <p className="catalog-tool-feedback" role="status">
            {copyStatus}
          </p>
        )}
      </div>
    </div>
  )
}
