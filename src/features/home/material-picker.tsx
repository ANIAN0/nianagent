import { useEffect, useId, useRef, useState, type RefObject } from "react"
import {
  AtSign,
  ArrowLeft,
  Check,
  FileText,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Terminal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  InputGroupButton,
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "@/components/ui/input-group"
import type { Material } from "./home-types"
export type MaterialPickerProps = {
  materials: Material[]
  selected: Material[]
  onAdd: (material: Material) => void
  anchorRef?: RefObject<HTMLDivElement | null>
  onInsert?: (text: string) => void
}
type Candidate = {
  id: string
  group: string
  name: string
  description: string
  icon: typeof Plus
  disabled?: boolean
  text?: string
}
export function MaterialPicker({
  materials,
  selected,
  onAdd,
  anchorRef,
  onInsert,
}: MaterialPickerProps) {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<"candidates" | "resources">("candidates")
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [availableHeight, setAvailableHeight] = useState(320)
  function toggle() {
    setAvailableHeight(
      Math.max(
        100,
        (anchorRef?.current ?? trigger.current)?.getBoundingClientRect().top ??
          320
      ) - 16
    )
    setOpen(!open)
    setPane("candidates")
    setQuery("")
    setActive(0)
    anchorRef?.current?.querySelector("textarea")?.focus()
  }
  function add(item: Material) {
    onAdd(item)
    setOpen(false)
    anchorRef?.current?.querySelector("textarea")?.focus()
  }
  function insert(text: string) {
    onInsert?.(text)
    setOpen(false)
    anchorRef?.current?.querySelector("textarea")?.focus()
  }
  const materialRows: Candidate[] = materials
    .filter((item) => pane === "resources" || item.kind === "Skill")
    .map((item) => ({
      id: item.id,
      group: item.kind === "Skill" ? "Skills" : "文件",
      name: item.name,
      description:
        item.description ??
        (item.kind === "Skill" ? "项目中的工作说明" : item.name),
      icon: item.kind === "Skill" ? Sparkles : FileText,
      disabled: selected.some((value) => value.id === item.id),
    }))
  const candidates: Candidate[] =
    pane === "resources"
      ? materialRows
      : [
          {
            id: "attachment",
            group: "添加",
            name: "添加附件",
            description: "选择本地文件，可多选",
            icon: Paperclip,
          },
          {
            id: "resources",
            group: "添加",
            name: "引用资源",
            description: "文件 / Skills / 插件资源",
            icon: AtSign,
          },
          ...materialRows,
          ...(onInsert
            ? [
                {
                  id: "review-template",
                  group: "提示模板",
                  name: "代码评审",
                  description: "按评审清单检查指定文件的改动",
                  icon: FileText,
                  text: "请审查当前工作区的改动，重点检查正确性、可维护性和遗漏的边界情况。",
                },
                {
                  id: "report-template",
                  group: "提示模板",
                  name: "周报整理",
                  description: "把已完成事项整理成周报段落",
                  icon: FileText,
                  text: "请根据本周的工作记录，整理已完成事项、待办和阻塞。",
                },
                {
                  id: "compact",
                  group: "内置命令",
                  name: "压缩当前上下文 · compact",
                  description: "将压缩命令填入输入框",
                  icon: Terminal,
                  text: "/compact ",
                },
              ]
            : []),
        ]
  const rows = candidates.filter((item) =>
    `${item.name} ${item.description}`
      .toLowerCase()
      .includes(query.toLowerCase())
  )
  function activate(item: Candidate) {
    if (item.id === "attachment") fileInput.current?.click()
    else if (item.id === "resources") {
      setPane("resources")
      setActive(0)
      setQuery("")
    } else if (item.text) insert(item.text)
    else {
      const material = materials.find((entry) => entry.id === item.id)
      if (material) add(material)
    }
  }
  function handleKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const enabled = rows
        .map((item, index) => (item.disabled ? -1 : index))
        .filter((index) => index >= 0)
      if (!enabled.length) return
      const current = enabled.indexOf(active)
      const next =
        enabled[
          (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) %
            enabled.length
        ]!
      setActive(next)
      list.current
        ?.querySelector(`[data-candidate-index="${next}"]`)
        ?.scrollIntoView({ block: "nearest" })
    } else if (
      event.key === "Enter" &&
      rows[active] &&
      !rows[active].disabled
    ) {
      event.preventDefault()
      event.stopPropagation()
      activate(rows[active])
    }
  }
  useEffect(() => {
    if (!open) return
    function dismiss(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !anchorRef?.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        ;(
          anchorRef?.current?.querySelector("textarea") ?? trigger.current
        )?.focus()
      }
    }
    document.addEventListener("pointerdown", dismiss)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", dismiss)
      document.removeEventListener("keydown", escape)
    }
  }, [open, anchorRef])
  useEffect(() => {
    if (!open || pane !== "candidates") return
    const textarea = anchorRef?.current?.querySelector("textarea")
    if (!textarea) return
    textarea.setAttribute("aria-controls", id)
    textarea.setAttribute("aria-expanded", "true")
    textarea.setAttribute("aria-activedescendant", `${id}-${active}`)
    textarea.addEventListener("keydown", handleKey)
    return () => {
      textarea.removeEventListener("keydown", handleKey)
      textarea.removeAttribute("aria-controls")
      textarea.removeAttribute("aria-expanded")
      textarea.removeAttribute("aria-activedescendant")
    }
  })
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-label="选择附件"
        onChange={(event) => {
          Array.from(event.target.files ?? []).forEach((file) =>
            onAdd({
              id: `file:${file.name}:${file.size}:${file.lastModified}`,
              name: file.name,
              kind: "附件",
            })
          )
          event.target.value = ""
          setOpen(false)
        }}
      />
      <InputGroupButton
        ref={trigger}
        size="icon-xs"
        className="size-7 rounded-full bg-background"
        aria-label="添加附件或 Skill"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
      >
        <Plus className="size-4" />
      </InputGroupButton>
      {open && (
        <div
          ref={panel}
          className="absolute inset-x-0 bottom-[calc(100%+4px)] z-50 overflow-hidden rounded-2xl bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => handleKey(event.nativeEvent)}
        >
          {pane === "resources" && (
            <div className="flex items-center gap-1 border-b p-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="返回输入候选"
                onClick={() => {
                  setPane("candidates")
                  setQuery("")
                  setActive(0)
                }}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <InputGroup className="h-9 border-0 shadow-none">
                <InputGroupAddon>
                  <Search className="size-4" />
                </InputGroupAddon>
                <InputGroupInput
                  autoFocus
                  role="combobox"
                  aria-expanded
                  aria-controls={id}
                  aria-activedescendant={
                    rows[active] ? `${id}-${active}` : undefined
                  }
                  aria-label="搜索资源"
                  placeholder="搜索文件、Skills 或插件资源"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setActive(0)
                  }}
                />
              </InputGroup>
            </div>
          )}
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label="输入候选"
            className="overflow-y-auto"
            style={{
              maxHeight: Math.min(
                320,
                availableHeight - 8 - (pane === "resources" ? 54 : 0)
              ),
            }}
          >
            {rows.map((item, index) => (
              <div key={item.id}>
                {(index === 0 || rows[index - 1]?.group !== item.group) && (
                  <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
                    {item.group}
                  </div>
                )}
                <Button
                  type="button"
                  id={`${id}-${index}`}
                  data-candidate-index={index}
                  role="option"
                  aria-selected={active === index}
                  disabled={item.disabled}
                  tabIndex={-1}
                  variant="ghost"
                  className={`h-10 w-full justify-start gap-2 rounded-lg px-3 font-normal ${active === index ? "bg-accent/60" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => {
                    if (!item.disabled) setActive(index)
                  }}
                  onClick={() => activate(item)}
                >
                  <item.icon className="size-4" />
                  <span className="shrink-0">{item.name}</span>
                  <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                    {item.disabled ? "已添加" : item.description}
                  </span>
                  {item.disabled && <Check className="size-3.5" />}
                </Button>
              </div>
            ))}
            {!rows.length && (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                没有匹配的资源
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
