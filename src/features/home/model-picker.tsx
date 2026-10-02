import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ChevronDown, ChevronRight, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import { ThinkingPicker } from "./thinking-picker"
import { navigatePicker, PickerOption } from "./picker-option"

export type ModelPickerCatalog = {
  items: { value: string; name: string; connection: string; modelId: string }[]
  status: "loading" | "ready" | "error"
  error?: string
  onRetry: () => void
  onOpenSettings: () => void
}
export type ModelPickerProps = {
  models: string[]
  labels?: Record<string, string>
  catalog?: ModelPickerCatalog
  thinkingByModel?: Record<string, string[]>
  value: string
  thinking: string
  onChange: (value: string) => void
  onThinkingChange: (value: string) => void
}
export function ModelPicker({
  models,
  labels,
  catalog,
  thinkingByModel,
  value,
  thinking,
  onChange,
  onThinkingChange,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<"root" | "model" | "thinking">("root")
  const [bounds, setBounds] = useState<{
    side: "top" | "bottom"
    height: number
  }>({ side: "top", height: 360 })
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const returnPane = useRef<"model" | "thinking">("model")
  function measure() {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const above = Math.max(0, rect.top - 20)
    const below = Math.max(0, window.innerHeight - rect.bottom - 20)
    const side = above >= 360 || above >= below ? "top" : "bottom"
    setBounds({ side, height: Math.min(360, side === "top" ? above : below) })
  }
  useEffect(() => {
    if (!open) return
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [open])
  function show(next: typeof pane) {
    if (next !== "root") returnPane.current = next
    setPane(next)
    requestAnimationFrame(() => {
      const selector =
        next === "root"
          ? `[data-root-item="${returnPane.current}"]`
          : '[aria-checked="true"], [data-picker-item]'
      const chosen =
        next !== "root"
          ? content.current?.querySelector<HTMLButtonElement>(
              '[aria-checked="true"]'
            )
          : null
      ;(
        chosen ?? content.current?.querySelector<HTMLButtonElement>(selector)
      )?.focus()
    })
  }
  const selected = catalog?.items.find((item) => item.value === value)
  const displayName = selected?.name ?? labels?.[value] ?? value
  const unavailable = !!value && !models.includes(value)
  const currentThinking = value && !unavailable ? thinking : ""
  const placeholder =
    catalog?.status === "loading"
      ? "正在读取模型…"
      : catalog?.status === "error"
        ? "模型读取失败"
        : models.length
          ? "选择模型"
          : "添加模型"
  const title = `${displayName || placeholder}${selected ? ` · ${selected.connection}` : ""}${currentThinking ? ` · ${currentThinking}` : ""}`
  const groups = new Map<
    string,
    { value: string; name: string; modelId?: string }[]
  >()
  for (const model of models) {
    const item = catalog?.items.find((item) => item.value === model)
    const connection = item?.connection ?? "可用模型"
    const entries = groups.get(connection) ?? []
    entries.push({
      value: model,
      name: item?.name ?? labels?.[model] ?? model,
      modelId: item?.modelId,
    })
    groups.set(connection, entries)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) measure()
        setOpen(next)
        setPane("root")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="sm"
          className="max-w-[min(220px,45cqw)] min-w-0 gap-1 rounded-full font-normal"
          aria-label={`选择模型，当前为 ${title}`}
          title={title}
        >
          <span className="truncate">
            {displayName || placeholder}
            {unavailable ? " · 不可用" : ""}
          </span>
          {currentThinking && (
            <span className="shrink-0 text-muted-foreground">
              {currentThinking}
            </span>
          )}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        side={bounds.side}
        align="end"
        sideOffset={8}
        collisionPadding={12}
        style={{ maxHeight: bounds.height }}
        className="w-72 max-w-[calc(100vw-24px)] gap-1 overflow-hidden rounded-xl p-1.5"
        aria-label="模型与思考"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          content.current
            ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
            ?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (pane !== "root") {
            event.preventDefault()
            show("root")
          }
        }}
      >
        {pane !== "root" && (
          <Button
            type="button"
            variant="ghost"
            className="h-9 shrink-0 justify-start"
            onClick={() => show("root")}
            aria-label="返回模型与思考"
          >
            <ArrowLeft data-icon="inline-start" />
            {pane === "model" ? "选择模型" : "思考强度"}
          </Button>
        )}
        <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto">
          {catalog?.status === "loading" && (
            <p
              role="status"
              className="px-3 py-2 text-sm text-muted-foreground"
            >
              正在读取模型目录…
            </p>
          )}
          {catalog?.status === "error" && (
            <div className="px-3 py-2">
              <p
                role="alert"
                className="text-sm [overflow-wrap:anywhere] text-destructive"
              >
                {catalog.error || "模型读取失败，请重试。"}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={catalog.onRetry}
              >
                重新读取
              </Button>
            </div>
          )}
          {unavailable && (
            <p role="status" className="px-3 py-2 text-xs text-destructive">
              原模型已移除或连接不可用。请选择其他模型，或打开模型设置修复连接。
            </p>
          )}
          {catalog?.status !== "loading" &&
            catalog?.status !== "error" &&
            !models.length && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                暂无可用模型。请在模型设置中添加连接。
              </p>
            )}
          {pane === "root" ? (
            <div
              role="menu"
              aria-label="模型与思考选项"
              onKeyDown={navigatePicker}
              className="flex flex-col"
            >
              {!!models.length && (
                <Button
                  data-picker-item
                  data-root-item="model"
                  role="menuitem"
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-10 w-full justify-start gap-3 py-2 font-normal"
                  onClick={() => show("model")}
                >
                  <span className="shrink-0">模型</span>
                  <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                    {displayName || "请选择"}
                  </span>
                  <ChevronRight data-icon="inline-end" />
                </Button>
              )}
              {!!value &&
                !unavailable &&
                (!thinkingByModel || !!thinkingByModel[value]?.length) && (
                  <Button
                    data-picker-item
                    data-root-item="thinking"
                    role="menuitem"
                    type="button"
                    variant="ghost"
                    className="h-10 w-full justify-start font-normal"
                    onClick={() => show("thinking")}
                  >
                    <span>思考强度</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {currentThinking}
                    </span>
                    <ChevronRight data-icon="inline-end" />
                  </Button>
                )}
            </div>
          ) : pane === "model" ? (
            <div
              role="menu"
              aria-label="可用模型"
              onKeyDown={navigatePicker}
              className="flex min-w-0 flex-col gap-2"
            >
              {[...groups].map(([connection, items]) => (
                <section
                  key={connection}
                  role="group"
                  aria-label={connection}
                  className="min-w-0"
                >
                  <h3 className="px-3 py-1.5 text-xs font-medium [overflow-wrap:anywhere] text-muted-foreground">
                    {connection}
                  </h3>
                  {items.map((item) => (
                    <PickerOption
                      key={item.value}
                      selected={item.value === value}
                      description={
                        item.modelId !== item.name ? item.modelId : undefined
                      }
                      onSelect={() => {
                        onChange(item.value)
                        setOpen(false)
                      }}
                    >
                      {item.name}
                    </PickerOption>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <ThinkingPicker
              options={thinkingByModel?.[value]}
              value={currentThinking}
              onChange={(next) => {
                onThinkingChange(next)
                setOpen(false)
              }}
            />
          )}
        </div>
        {catalog?.onOpenSettings && pane === "root" && (
          <>
            <Separator />
            <Button
              type="button"
              variant="ghost"
              className="h-9 shrink-0 justify-start font-normal"
              onClick={() => {
                setOpen(false)
                catalog.onOpenSettings()
              }}
            >
              <Settings data-icon="inline-start" />
              模型设置
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
