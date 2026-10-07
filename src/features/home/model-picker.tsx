import { HoverHint } from "@/components/feedback/hover-hint"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Search,
  Settings,
  X,
} from "lucide-react"
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group"
import { useComposerKeyboard } from "@/components/composer/composer-keymap"
import { Button } from "@/components/ui/button"
import "@/components/composer/composer-input-card.css"
import { Separator } from "@/components/ui/separator"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import { ThinkingPicker } from "./thinking-picker"
import { navigatePicker, PickerOption } from "./picker-option"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "./composer-panel-context"

export type ModelPickerCatalog = {
  items: { value: string; name: string; connection: string; modelId: string }[]
  status: "loading" | "ready" | "error"
  error?: string
  issue?: FeedbackDescription
  onRetry: () => void
  onOpenSettings: () => void
}
export type ModelPickerProps = {
  disabled?: boolean
  disabledReason?: string
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
  disabled = false,
  disabledReason,
  models,
  labels,
  catalog,
  thinkingByModel,
  value,
  thinking,
  onChange,
  onThinkingChange,
}: ModelPickerProps) {
  const [open, setOpen] = useComposerPanel("model")
  const closeAutoFocus = useComposerPanelCloseAutoFocus("model")
  const [pane, setPane] = useState<"root" | "model" | "thinking">("root")
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const searchKeyboard = useComposerKeyboard<HTMLInputElement>(() => {
    content.current
      ?.querySelector<HTMLButtonElement>(
        `#${CSS.escape(listId)} button[data-picker-item]`
      )
      ?.click()
  })
  const [bounds, setBounds] = useState<{
    side: "top" | "bottom"
    height: number
  }>({ side: "top", height: 360 })
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const returnPane = useRef<"model" | "thinking">("model")
  useEffect(() => {
    if (disabled && open) setOpen(false)
  }, [disabled, open, setOpen])
  const measure = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const viewport = window.visualViewport
    const above = Math.max(0, rect.top - (viewport?.offsetTop ?? 0) - 20)
    const bottom = viewport
      ? viewport.offsetTop + viewport.height
      : window.innerHeight
    const below = Math.max(0, bottom - rect.bottom - 20)
    const side = above >= 360 || above >= below ? "top" : "bottom"
    const height = Math.min(360, side === "top" ? above : below)
    setBounds((current) =>
      current.side === side && current.height === height
        ? current
        : { side, height }
    )
  }, [])
  useEffect(() => {
    if (!open) return
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    window.visualViewport?.addEventListener("resize", measure)
    window.visualViewport?.addEventListener("scroll", measure)
    const observer = new ResizeObserver(measure)
    if (trigger.current) observer.observe(trigger.current)
    if (trigger.current?.parentElement)
      observer.observe(trigger.current.parentElement)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
      window.visualViewport?.removeEventListener("resize", measure)
      window.visualViewport?.removeEventListener("scroll", measure)
    }
  }, [open, measure])
  function show(next: typeof pane) {
    if (next !== "root") returnPane.current = next
    if (next !== "model") setQuery("")
    setPane(next)
    requestAnimationFrame(() => {
      if (next === "model" && models.length > 4) {
        searchRef.current?.focus()
        return
      }
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
  const failure =
    catalog?.issue ??
    (catalog?.status === "error"
      ? feedbackFromError(catalog.error, "模型目录未能读取，请重新读取。")
      : undefined)
  const displayName = selected?.name ?? labels?.[value] ?? value
  const modelAvailable = !!value && models.includes(value)
  const unavailable =
    !!value &&
    !modelAvailable &&
    catalog?.status !== "loading" &&
    catalog?.status !== "error"
  const stateLabel =
    catalog?.status === "loading"
      ? "读取中"
      : catalog?.status === "error"
        ? "读取失败"
        : unavailable
          ? "不可用"
          : undefined
  const currentThinking = modelAvailable ? thinking : ""
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
  const lookup = new Map(catalog?.items.map((item) => [item.value, item]))
  const needle = query.trim().toLocaleLowerCase()
  for (const model of models) {
    const item = lookup.get(model)
    const connection = item?.connection ?? "可用模型"
    const name = item?.name ?? labels?.[model] ?? model
    if (
      needle &&
      ![name, item?.modelId ?? model, connection].some((entry) =>
        entry.toLocaleLowerCase().includes(needle)
      )
    )
      continue
    const entries = groups.get(connection) ?? []
    entries.push({
      value: model,
      name,
      modelId: item?.modelId,
    })
    groups.set(connection, entries)
  }
  const triggerButton = (
    <HoverHint
      content={
        disabled
          ? disabledReason
          : unavailable
            ? `${title}：当前模型不可用，请重新选择。`
            : catalog?.status === "error"
              ? `${title}：${failure?.message ?? "模型目录未能读取，请打开模型菜单重新读取。"}`
              : title
      }
      disabled={disabled}
      label="选择模型"
      onlyWhenTruncated={
        disabled || stateLabel ? false : ".moon-composer-model-name"
      }
      suppressed={open || catalog?.status === "loading"}
    >
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          disabled={disabled}
          type="button"
          variant="composer"
          size="composer"
          className="moon-composer-model-trigger moon-composer-selector"
          aria-label={`选择模型，当前为 ${title}${value && stateLabel ? `，${stateLabel}` : ""}`}
        >
          <span className="moon-composer-model-short" aria-hidden="true">
            模型
          </span>
          <span className="moon-composer-model-name">
            {displayName || placeholder}
          </span>
          {value && stateLabel && (
            <span className="moon-composer-model-state">{stateLabel}</span>
          )}
          {currentThinking && (
            <span className="moon-composer-thinking">{currentThinking}</span>
          )}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
    </HoverHint>
  )
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) measure()
        setOpen(next)
        setPane("root")
        setQuery("")
      }}
    >
      {triggerButton}
      <PopoverContent
        onCloseAutoFocus={closeAutoFocus}
        ref={content}
        side={bounds.side}
        align="end"
        sideOffset={8}
        collisionPadding={12}
        style={{
          width: `${Math.max(catalog?.status === "error" ? 320 : 240, Math.min(420, Math.max(...models.map((model) => (lookup.get(model)?.name ?? labels?.[model] ?? model).length * 8), ...[...groups.keys()].map((name) => name.length * 8), 0) + 56))}px`,
          maxHeight: `min(${bounds.height}px, var(--radix-popover-content-available-height))`,
        }}
        className="moon-model-menu max-w-[calc(100vw-24px)] gap-1 overflow-hidden rounded-xl p-1"
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
            className="h-[34px] shrink-0 justify-start px-2 text-[13px] leading-5 font-normal"
            onClick={() => show("root")}
            aria-label="返回模型与思考"
          >
            <ArrowLeft data-icon="inline-start" />
            {pane === "model" ? "选择模型" : "思考强度"}
          </Button>
        )}
        {pane === "model" && models.length > 4 && (
          <InputGroup className="moon-model-search h-8 shrink-0">
            <InputGroupInput
              ref={searchRef}
              type="text"
              aria-label="搜索模型名称、ID或连接"
              aria-controls={listId}
              placeholder="搜索模型…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={searchKeyboard.onCompositionStart}
              onCompositionEnd={searchKeyboard.onCompositionEnd}
              onKeyDown={(event) => {
                const intent = searchKeyboard.onKeyDown(event)
                if (intent === "composing" || event.defaultPrevented) return
                if (
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                )
                  return
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault()
                  const buttons =
                    content.current?.querySelectorAll<HTMLButtonElement>(
                      `#${CSS.escape(listId)} button[data-picker-item]`
                    )
                  const option =
                    event.key === "ArrowUp"
                      ? buttons?.[buttons.length - 1]
                      : buttons?.[0]
                  option?.focus()
                }
              }}
            />
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            {query && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="清空模型搜索"
                  onClick={() => {
                    setQuery("")
                    searchRef.current?.focus()
                  }}
                >
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
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
          {catalog?.status === "error" && failure && (
            <div className="p-1.5">
              <OperationFeedback
                notify={false}
                title={
                  failure.code === "cancelled"
                    ? "模型读取已取消"
                    : "模型目录未能读取"
                }
                {...failure}
                actions={
                  <RecoveryAction
                    variant="ghost"
                    issue={failure}
                    onRetry={catalog.onRetry}
                    onReload={catalog.onRetry}
                    onCheck={catalog.onRetry}
                    onSettings={() => {
                      setOpen(false)
                      catalog.onOpenSettings()
                    }}
                    labels={{ retry: "重新读取" }}
                  />
                }
              />
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
                  className="h-[34px] w-full justify-start gap-2 px-2 py-0 text-[13px] leading-5 font-normal"
                  onClick={() => show("model")}
                >
                  <span className="shrink-0">模型</span>
                  <span className="ml-auto min-w-0 truncate text-[13px] text-muted-foreground">
                    {displayName || "请选择"}
                  </span>
                  <ChevronRight data-icon="inline-end" />
                </Button>
              )}
              {!!value &&
                modelAvailable &&
                (!thinkingByModel || !!thinkingByModel[value]?.length) && (
                  <Button
                    data-picker-item
                    data-root-item="thinking"
                    role="menuitem"
                    type="button"
                    variant="ghost"
                    className="h-[34px] w-full justify-start gap-2 px-2 py-0 text-[13px] leading-5 font-normal"
                    onClick={() => show("thinking")}
                  >
                    <span>思考强度</span>
                    <span className="ml-auto text-[13px] text-muted-foreground">
                      {currentThinking}
                    </span>
                    <ChevronRight data-icon="inline-end" />
                  </Button>
                )}
            </div>
          ) : pane === "model" ? (
            <div
              id={listId}
              role="menu"
              aria-label="可用模型"
              onKeyDown={navigatePicker}
              className="flex min-w-0 flex-col gap-2"
            >
              {!groups.size && (
                <p
                  role="status"
                  className="px-3 py-3 text-xs text-muted-foreground"
                >
                  没有匹配的模型。请修改搜索条件。
                </p>
              )}
              {[...groups].map(([connection, items]) => (
                <section
                  key={connection}
                  role="group"
                  aria-label={connection}
                  className="min-w-0"
                >
                  <h3 className="px-2 py-1 text-xs font-normal [overflow-wrap:anywhere] text-muted-foreground">
                    {connection}
                  </h3>
                  {items.map((item) => (
                    <PickerOption
                      key={item.value}
                      selected={item.value === value}
                      fullName={item.name}
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
              className="h-[34px] shrink-0 justify-start px-2 text-[13px] leading-5 font-normal"
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
