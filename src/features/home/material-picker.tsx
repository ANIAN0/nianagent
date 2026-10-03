import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import {
  AtSign,
  ArrowLeft,
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
import {
  MaterialCandidateList,
  type MaterialCandidate as Candidate,
} from "@/features/materials/material-candidate-list"
import { useResourceCatalog } from "@/features/materials/use-resource-catalog"
export type MaterialPickerProps = {
  disabled?: boolean
  materials: Material[]
  selected: Material[]
  onAdd: (material: Material) => void
  anchorRef?: RefObject<HTMLDivElement | null>
  onInsert?: (text: string) => void
  onChooseAttachments?: () => Promise<void>
  choosing?: boolean
  sessionId?: string
  workspacePath?: string
  onTextChange?: (text: string) => void
}
export function MaterialPicker({
  disabled = false,
  materials,
  selected,
  onAdd,
  anchorRef,
  onInsert,
  onChooseAttachments,
  choosing = false,
  sessionId,
  workspacePath,
  onTextChange,
}: MaterialPickerProps) {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<"candidates" | "resources">("candidates")
  const [query, setQuery] = useState("")
  const [inputMode, setInputMode] = useState<"button" | "file" | "skill">(
    "button"
  )
  const queryRange = useRef({ start: 0, end: 0 })
  const [active, setActive] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [availableHeight, setAvailableHeight] = useState(320)
  const [position, setPosition] = useState({ left: 0, width: 0, bottom: 0 })
  const resources = useResourceCatalog({
    sessionId,
    cwd: workspacePath,
    query,
    enabled: open && (pane === "resources" || inputMode !== "button"),
    fallback: materials,
  })
  const available =
    inputMode === "file"
      ? resources.files
      : inputMode === "skill"
        ? resources.skills
        : pane === "resources"
          ? [...resources.files, ...resources.skills]
          : materials
  useEffect(() => {
    const textarea = anchorRef?.current?.querySelector("textarea")
    if (!textarea || !onTextChange || disabled) return
    function inspect() {
      const before = textarea!.value.slice(0, textarea!.selectionStart)
      const file = before.match(/(?:^|\s)@([^\s@]*)$/u)
      const skill = before.match(/^\/(?:skill:)?([a-zA-Z0-9_-]*)$/u)
      if (file) {
        queryRange.current = {
          start: before.length - file[1]!.length - 1,
          end: before.length,
        }
        setInputMode("file")
        setPane("resources")
        setQuery(file[1]!)
        setActive(0)
        setOpen(true)
      } else if (skill) {
        queryRange.current = { start: 0, end: before.length }
        setInputMode("skill")
        setPane("resources")
        setQuery(skill[1]!)
        setActive(0)
        setOpen(true)
      } else if (inputMode !== "button") setOpen(false)
    }
    textarea.addEventListener("input", inspect)
    return () => textarea.removeEventListener("input", inspect)
  }, [anchorRef, onTextChange, disabled, inputMode])
  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef?.current ?? trigger.current
    if (!anchor) return
    function updatePosition() {
      const rect = anchor!.getBoundingClientRect()
      setPosition({
        left: rect.left,
        width: rect.width,
        bottom: window.innerHeight - rect.top + 4,
      })
      setAvailableHeight(Math.max(84, rect.top - 16))
    }
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(anchor)
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [open, anchorRef])
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
    setInputMode("button")
    setQuery("")
    setActive(0)
    anchorRef?.current?.querySelector("textarea")?.focus()
  }
  function add(item: Material) {
    onAdd(item)
    if (inputMode !== "button" && onTextChange) {
      const textarea = anchorRef?.current?.querySelector("textarea")
      if (textarea) {
        const { start, end } = queryRange.current
        const replacement = inputMode === "skill" ? `/skill:${item.name} ` : ""
        onTextChange(
          textarea.value.slice(0, start) +
            replacement +
            textarea.value.slice(end)
        )
        requestAnimationFrame(() =>
          textarea.setSelectionRange(
            start + replacement.length,
            start + replacement.length
          )
        )
      }
    }
    setOpen(false)
    anchorRef?.current?.querySelector("textarea")?.focus()
  }
  function insert(text: string) {
    if (inputMode === "skill" && onTextChange) {
      const textarea = anchorRef?.current?.querySelector("textarea")
      onTextChange(text + (textarea?.value.slice(queryRange.current.end) ?? ""))
    } else onInsert?.(text)
    setOpen(false)
    anchorRef?.current?.querySelector("textarea")?.focus()
  }
  const materialRows: Candidate[] = available
    .filter((item) => pane === "resources" || item.kind === "Skill")
    .map((item) => ({
      id: item.id,
      group: item.kind === "Skill" ? "Skills" : "文件",
      name: item.name,
      description:
        item.error ||
        [item.description, item.source].filter(Boolean).join(" · ") ||
        (item.kind === "Skill" ? "项目中的工作说明" : item.name),
      icon: item.kind === "Skill" ? Sparkles : FileText,
      disabled:
        item.status === "failed" ||
        selected.some(
          (value) =>
            value.id === item.id ||
            (value.source &&
              value.source === item.source &&
              value.type === item.type)
        ),
      selected: selected.some(
        (value) =>
          value.id === item.id ||
          (value.source &&
            value.source === item.source &&
            value.type === item.type)
      ),
    }))
  const candidates: Candidate[] =
    pane === "resources"
      ? [
          ...materialRows,
          ...(inputMode === "skill" && onInsert
            ? [
                {
                  id: "compact",
                  group: "内置命令",
                  name: "压缩当前上下文 · compact",
                  description: "填写 /compact 后打开压缩表单",
                  icon: Terminal,
                  text: "/compact ",
                },
              ]
            : []),
        ]
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
            description: "工作区文件 / Skills",
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
    if (item.id === "attachment") {
      if (onChooseAttachments) {
        setOpen(false)
        void onChooseAttachments()
      } else fileInput.current?.click()
    } else if (item.id === "resources") {
      setPane("resources")
      setActive(0)
      setQuery("")
    } else if (item.text) insert(item.text)
    else {
      const material = available.find((entry) => entry.id === item.id)
      if (material) add(material)
    }
  }
  function handleKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (
      event.target instanceof Element &&
      event.target.closest("button") &&
      !event.target.closest("[data-candidate-index]")
    )
      return
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
      (event.key === "Enter" || event.key === "Tab") &&
      rows[active] &&
      !rows[active].disabled
    ) {
      event.preventDefault()
      event.stopPropagation()
      activate(rows[active])
    } else if (event.key === "Enter") {
      // A loading/empty candidate menu must not let the same key submit a task.
      event.preventDefault()
      event.stopPropagation()
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
    if (!open || (pane !== "candidates" && inputMode === "button")) return
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
        disabled={disabled || choosing}
        title={choosing ? "正在选择附件…" : "添加附件或 Skill"}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
      >
        <Plus className="size-3.5" />
      </InputGroupButton>
      {open &&
        createPortal(
          <div
            ref={panel}
            style={position}
            className="fixed z-50 overflow-hidden rounded-2xl bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => handleKey(event.nativeEvent)}
          >
            {pane === "resources" && inputMode === "button" && (
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
                    placeholder="搜索工作区文件或 Skills"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setActive(0)
                    }}
                  />
                </InputGroup>
              </div>
            )}
            <MaterialCandidateList
              id={id}
              rows={rows}
              active={active}
              listRef={list}
              maxHeight={Math.max(
                64,
                Math.min(
                  320,
                  availableHeight -
                    8 -
                    (pane === "resources" && inputMode === "button" ? 54 : 0)
                )
              )}
              loading={pane === "resources" && resources.loading}
              error={pane === "resources" ? resources.error : undefined}
              diagnostics={pane === "resources" ? resources.diagnostics : []}
              onRetry={resources.retry}
              onActive={setActive}
              onSelect={activate}
            />
          </div>,
          document.body
        )}
    </>
  )
}
