import {
  composerEditor,
  materialMention,
  type ComposerEditorElement,
} from "@/components/composer/composer-editor-contract"
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { composerKeyIntent } from "@/components/composer/composer-keymap"
import {
  AtSign,
  ArrowLeft,
  FileText,
  Folder,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Terminal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
import {
  useComposerPanel,
  useComposerPanelInactive,
} from "./composer-panel-context"
import {
  materialQueryAtSelection,
  materialCandidateMatches,
  replaceMaterialQuery,
  replaceLeadingSkill,
} from "./material-query"
import { materialPanelPlacement } from "./material-panel-position"
export type MaterialPickerProps = {
  disabled?: boolean
  materials: Material[]
  selected: Material[]
  onAdd: (material: Material) => void
  anchorRef?: RefObject<HTMLDivElement | null>
  onInsert?: (text: string) => void
  allowCompact?: boolean
  onChooseAttachments?: () => Promise<void>
  choosing?: boolean
  sessionId?: string
  workspacePath?: string
  onTextChange?: (text: string) => void
  onCommandSelect?: (name: string, text: string) => void
}
export function MaterialPicker(props: MaterialPickerProps) {
  // A disabled phase owns no open candidates. Restoring the phase starts closed
  // rather than revealing a portal left open during the previous submission.
  return (
    <MaterialPickerContent
      key={props.disabled ? "disabled" : "enabled"}
      {...props}
    />
  )
}
function MaterialPickerContent({
  disabled = false,
  materials,
  selected,
  onAdd,
  anchorRef,
  onInsert,
  allowCompact = false,
  onChooseAttachments,
  choosing = false,
  sessionId,
  workspacePath,
  onTextChange,
  onCommandSelect,
}: MaterialPickerProps) {
  const [open, setOpen] = useComposerPanel("materials")
  const inactive = useComposerPanelInactive()
  const [pane, setPane] = useState<"candidates" | "resources">("candidates")
  const [query, setQuery] = useState("")
  const [inputMode, setInputMode] = useState<
    "button" | "file" | "slash" | "skill"
  >("button")
  const [resourceKind, setResourceKind] = useState<"file" | "skill">("file")
  const queryRange = useRef({ start: 0, end: 0 })
  const composing = useRef(false)
  const composingUntil = useRef(0)
  const dismissedQuery = useRef<string | null>(null)
  const previousQuery = useRef<string | null>(null)
  const previousOpen = useRef(open)
  const manualActivation = useRef(false)
  const [active, setActive] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [availableHeight, setAvailableHeight] = useState(320)
  const [position, setPosition] = useState<{
    left: number
    width: number
    top?: number
    bottom?: number
  }>({ left: 12, width: 0, bottom: 12 })
  function selectionKey(textarea: ComposerEditorElement) {
    return `${textarea.selectionStart}:${textarea.selectionEnd}:${textarea.value}`
  }
  function dismiss(restoreFocus = false) {
    const textarea = composerEditor(anchorRef?.current)
    if (textarea) dismissedQuery.current = selectionKey(textarea)
    setOpen(false)
    if (restoreFocus)
      (inputMode === "button" ? trigger.current : textarea)?.focus({
        preventScroll: true,
      })
  }
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
      : inputMode === "slash" || inputMode === "skill"
        ? resources.skills
        : pane === "resources"
          ? resourceKind === "skill"
            ? resources.skills
            : resources.files
          : materials
  useEffect(() => {
    // Switching another operation into this composer closes candidates without
    // stealing that operation's focus or immediately reopening the same token.
    if (previousOpen.current && !open) {
      const textarea = composerEditor(anchorRef?.current)
      if (textarea) dismissedQuery.current = selectionKey(textarea)
    }
    previousOpen.current = open
  }, [open, anchorRef])
  useEffect(() => {
    const textarea = composerEditor(anchorRef?.current)
    if (!textarea || !onTextChange || disabled || inactive) return
    let compositionTimer: ReturnType<typeof setTimeout> | undefined
    function inspect(event?: Event) {
      if (manualActivation.current) return
      if (composing.current || Date.now() < composingUntil.current) return
      if (document.activeElement !== textarea) {
        if (inputMode !== "button") setOpen(false)
        return
      }
      if (open && inputMode === "button" && event?.type !== "input") return
      const current = materialQueryAtSelection(
        textarea!.value,
        textarea!.selectionStart,
        textarea!.selectionEnd
      )
      if (!current) {
        dismissedQuery.current = null
        previousQuery.current = null
        if (inputMode !== "button") setOpen(false)
        return
      }
      const completed = selected.some((item) =>
        current.mode === "file"
          ? materialMention(item, workspacePath) ===
            textarea!.value.slice(current.start, current.end)
          : item.type === "skill" &&
            textarea!.value.slice(current.start, current.end) ===
              `/skill:${item.name}`
      )
      const commandName = textarea!.value
        .slice(current.start, current.end)
        .replace(/^\//, "")
      if (
        completed ||
        resources.commands.some((command) => command.name === commandName)
      ) {
        if (inputMode !== "button") setOpen(false)
        return
      }
      const key = selectionKey(textarea!)
      if (dismissedQuery.current === key) return
      dismissedQuery.current = null
      queryRange.current = { start: current.start, end: current.end }
      setInputMode(current.mode)
      setPane("resources")
      setQuery(current.query)
      // Native select/selectionchange may follow candidate ArrowDown. Keep the
      // selected row unless the actual query or replacement token has changed.
      const queryKey = `${current.mode}:${current.start}:${current.end}:${current.query}`
      if (previousQuery.current !== queryKey) setActive(0)
      previousQuery.current = queryKey
      setOpen(true)
    }
    function compositionStart() {
      composing.current = true
      clearTimeout(compositionTimer)
    }
    function compositionEnd() {
      composing.current = false
      composingUntil.current = Date.now() + 50
      clearTimeout(compositionTimer)
      compositionTimer = setTimeout(() => inspect(new Event("input")), 51)
    }
    textarea.addEventListener("input", inspect)
    textarea.addEventListener("select", inspect)
    textarea.addEventListener("keyup", inspect)
    textarea.addEventListener("focus", inspect)
    textarea.addEventListener("compositionstart", compositionStart)
    textarea.addEventListener("compositionend", compositionEnd)
    document.addEventListener("selectionchange", inspect)
    return () => {
      clearTimeout(compositionTimer)
      textarea.removeEventListener("input", inspect)
      textarea.removeEventListener("select", inspect)
      textarea.removeEventListener("keyup", inspect)
      textarea.removeEventListener("focus", inspect)
      textarea.removeEventListener("compositionstart", compositionStart)
      textarea.removeEventListener("compositionend", compositionEnd)
      document.removeEventListener("selectionchange", inspect)
    }
  }, [
    anchorRef,
    onTextChange,
    disabled,
    inactive,
    inputMode,
    open,
    setOpen,
    selected,
    workspacePath,
    resources.commands,
  ])
  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef?.current ?? trigger.current
    if (!anchor) return
    function updatePosition() {
      const rect = anchor!.getBoundingClientRect()
      const placement = materialPanelPlacement({
        card: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          width: anchorRef?.current ? rect.width : Math.max(288, rect.width),
        },
        trigger: trigger.current?.getBoundingClientRect() ?? rect,
        text: composerEditor(anchorRef?.current)?.getBoundingClientRect(),
        mode: inputMode,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        desiredHeight: pane === "resources" ? 382 : 160,
      })
      setPosition({
        left: placement.left,
        width: placement.width,
        top: placement.top,
        bottom: placement.bottom,
      })
      setAvailableHeight(placement.maxHeight)
    }
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(anchor)
    if (trigger.current) observer.observe(trigger.current)
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [open, anchorRef, inputMode, pane])
  function toggle() {
    if (disabled || choosing) return
    if (open) dismiss()
    else setOpen(true)
    setPane("candidates")
    setInputMode("button")
    setQuery("")
    setActive(0)
    const textarea = composerEditor(anchorRef?.current)
    if (textarea) {
      dismissedQuery.current = selectionKey(textarea)
      // focus dispatches synchronously while React still has the previous
      // query-mode listener. It must not close this explicit button opening.
      manualActivation.current = true
      try {
        textarea.focus({ preventScroll: true })
      } finally {
        manualActivation.current = false
      }
    }
  }
  function add(item: Material) {
    if (disabled || choosing) return
    if (item.type === "skill" || item.kind === "Skill") {
      const textarea = composerEditor(anchorRef?.current)
      if (!textarea || !onTextChange) return
      const updated = replaceLeadingSkill(textarea.value, item.name)
      onTextChange(updated.text)
      textarea.setSelectionAfterChange(
        updated.text,
        updated.caret,
        updated.caret
      )
      dismiss()
      textarea.focus({ preventScroll: true })
      return
    }
    onAdd(item)
    if (
      (inputMode !== "button" ||
        ["skill", "file", "directory"].includes(item.type ?? "")) &&
      onTextChange
    ) {
      const textarea = composerEditor(anchorRef?.current)
      if (textarea) {
        const { start, end } =
          inputMode === "button"
            ? { start: textarea.selectionStart, end: textarea.selectionEnd }
            : queryRange.current
        const replacement =
          (start > 0 && !/\s/u.test(textarea.value[start - 1]!) ? " " : "") +
          `${materialMention(item, workspacePath)} `
        const updated = replaceMaterialQuery(
          textarea.value,
          { start, end },
          replacement
        )
        onTextChange(updated.text)
        textarea.setSelectionAfterChange(
          updated.text,
          updated.caret,
          updated.caret
        )
      }
    }
    setOpen(false)
    composerEditor(anchorRef?.current)?.focus()
  }
  function insert(text: string) {
    if (disabled || choosing) return
    if ((inputMode === "slash" || inputMode === "skill") && onTextChange) {
      const textarea = composerEditor(anchorRef?.current)
      if (textarea) {
        const updated = replaceMaterialQuery(
          textarea.value,
          queryRange.current,
          text
        )
        onTextChange(updated.text)
        textarea.setSelectionAfterChange(
          updated.text,
          updated.caret,
          updated.caret
        )
      }
    } else onInsert?.(text)
    setOpen(false)
    composerEditor(anchorRef?.current)?.focus()
  }
  const materialRows: Candidate[] = available
    .filter((item) => pane === "resources" || item.kind === "Skill")
    .map((item) => ({
      id: item.id,
      group: item.kind === "Skill" ? "Skills" : "工作区文件",
      name: item.name,
      searchText: `${item.name} ${item.source ?? ""} ${item.description ?? ""}`,
      description:
        item.error ||
        (item.kind === "Skill"
          ? item.description || "用于本条消息的工作说明"
          : (item.description ?? item.name)
              .replace(/[/\\][^/\\]+$/u, "")
              .replace(item.name, "") ||
            (item.type === "directory" ? "目录" : "")),
      icon:
        item.kind === "Skill"
          ? Sparkles
          : item.type === "directory"
            ? Folder
            : FileText,
      drill: item.type === "directory",
      disabled:
        item.status === "failed" ||
        (item.kind !== "Skill" &&
          selected.some(
            (value) =>
              value.id === item.id ||
              (value.source &&
                value.source === item.source &&
                value.type === item.type)
          )),
      selected:
        item.kind === "Skill"
          ? composerEditor(anchorRef?.current)
              ?.value.trimStart()
              .match(/^\/skill:([^\s]+)/u)?.[1] === item.name
          : selected.some(
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
          ...(inputMode === "slash" &&
          queryRange.current.start === 0 &&
          (onInsert || onTextChange)
            ? [
                {
                  id: "compact",
                  group: "内置命令",
                  name: "压缩上下文 · /compact",
                  description: allowCompact
                    ? "填入命令，再打开压缩面板；不会发送给模型"
                    : "新会话尚无上下文，请先打开已有会话",
                  disabled: !allowCompact,
                  icon: Terminal,
                  text: "/compact ",
                },
              ]
            : []),
          ...materialRows,
          ...(inputMode === "slash" && queryRange.current.start === 0
            ? resources.commands
                .filter((command) => command.kind === "extension")
                .map((command) => ({
                  id: `command:${command.name}`,
                  group: "扩展命令",
                  name: `/${command.name}`,
                  description: command.available
                    ? command.description
                    : command.reason || "当前不可用",
                  icon: Terminal,
                  disabled: !command.available,
                  text: `/${command.name} `,
                }))
            : []),
        ]
      : [
          {
            id: "attachment",
            group: "添加",
            name: "添加附件",
            description: "选择本地文件；图片发送内容，其他文件引用路径",
            icon: Paperclip,
          },
          {
            id: "files",
            group: "添加",
            name: "引用工作区文件",
            description: "@ 搜索文件和目录",
            icon: AtSign,
          },
          {
            id: "skills",
            group: "添加",
            name: "选择 Skill",
            description: "补全消息开头的 /skill:name",
            icon: Sparkles,
          },
        ]
  const rows = candidates.filter(
    (item) =>
      // Keyboard selection follows the same visible source state as the list.
      (pane !== "resources" ||
        !(resources.loading || resources.issue || resources.error) ||
        item.group === "内置命令") &&
      materialCandidateMatches(
        item.searchText ?? `${item.name} ${item.description}`,
        query
      )
  )
  const activeIndex =
    rows[active] && !rows[active].disabled
      ? active
      : rows.findIndex((item) => !item.disabled)
  function activate(item: Candidate) {
    if (disabled || choosing || item.disabled) return
    if (item.id === "attachment") {
      if (onChooseAttachments) {
        setOpen(false)
        void onChooseAttachments()
      } else fileInput.current?.click()
    } else if (item.id === "files" || item.id === "skills") {
      setPane("resources")
      setResourceKind(item.id === "skills" ? "skill" : "file")
      setActive(0)
      setQuery("")
    } else if (item.id.startsWith("command:") && item.text && onCommandSelect) {
      const textarea = composerEditor(anchorRef?.current)
      const updated = replaceMaterialQuery(
        textarea?.value ?? "",
        queryRange.current,
        item.text
      )
      onCommandSelect(item.id.slice(8), updated.text)
      textarea?.setSelectionAfterChange(
        updated.text,
        updated.caret,
        updated.caret
      )
      dismiss(true)
    } else if (item.text) insert(item.text)
    else {
      const material = available.find((entry) => entry.id === item.id)
      if (material) add(material)
    }
  }
  function handleKey(event: KeyboardEvent) {
    if (event.key === "ArrowRight" && rows[activeIndex]?.drill) {
      event.preventDefault()
      drill(rows[activeIndex]!)
      return
    }
    if (disabled || choosing) return
    const intent = composerKeyIntent(event, {
      active: composing.current,
      endedAt: composingUntil.current - 50,
    })
    if (intent === "composing") return
    if (
      intent === "ignore" ||
      (event.key === "Tab" &&
        (event.altKey || event.ctrlKey || event.metaKey || event.repeat))
    ) {
      if (event.key === "Enter") {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }
    if (event.shiftKey && event.key === "Tab") {
      setOpen(false)
      return
    }
    if (event.shiftKey && event.key === "Enter") return
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
      const current = enabled.indexOf(activeIndex)
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
      rows[activeIndex] &&
      !rows[activeIndex].disabled
    ) {
      event.preventDefault()
      event.stopPropagation()
      activate(rows[activeIndex])
    } else if (event.key === "Enter") {
      // A loading/empty candidate menu must not let the same key submit a task.
      event.preventDefault()
      event.stopPropagation()
    }
  }
  function drill(item: Candidate) {
    const material = available.find((entry) => entry.id === item.id)
    if (!material) return
    const path =
      materialMention(material, workspacePath).replace(/^@"?|"$/gu, "") + "/"
    setQuery(path)
    setActive(0)
    if (inputMode === "file" && onTextChange) {
      const editor = composerEditor(anchorRef?.current)
      if (editor) {
        const updated = replaceMaterialQuery(
          editor.value,
          queryRange.current,
          /\s/u.test(path) ? `@"${path}"` : `@${path}`
        )
        onTextChange(updated.text)
        const caret = updated.caret - (/\s/u.test(path) ? 1 : 0)
        editor.setSelectionAfterChange(updated.text, caret, caret)
      }
    }
  }
  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        event.target !== composerEditor(anchorRef?.current) &&
        !trigger.current?.contains(event.target)
      )
        dismiss()
    }
    function escape(event: KeyboardEvent) {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        composing.current ||
        Date.now() < composingUntil.current
      )
        return
      if (event.key === "Escape") {
        event.preventDefault()
        dismiss(true)
      }
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
    }
  })
  useEffect(() => {
    if (!open || (pane !== "candidates" && inputMode === "button")) return
    const textarea = composerEditor(anchorRef?.current)
    if (!textarea) return
    textarea.setAttribute("aria-controls", id)
    textarea.setAttribute("aria-expanded", "true")
    if (activeIndex >= 0)
      textarea.setAttribute("aria-activedescendant", `${id}-${activeIndex}`)
    else textarea.removeAttribute("aria-activedescendant")
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
          if (disabled || choosing) {
            event.target.value = ""
            return
          }
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
      <Tooltip>
        <TooltipTrigger asChild>
          <InputGroupButton
            ref={trigger}
            size="icon-xs"
            className="size-7 rounded-full bg-composer-selector text-foreground hover:bg-composer-selector-hover aria-expanded:bg-composer-selector-hover [&>svg]:size-3.5"
            aria-label="添加消息材料"
            disabled={disabled || choosing}
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={toggle}
          >
            <Plus className="size-3.5" />
          </InputGroupButton>
        </TooltipTrigger>
        <TooltipContent side="top">
          {choosing ? "正在选择附件…" : "添加文件或调用指令"}
        </TooltipContent>
      </Tooltip>
      {open &&
        createPortal(
          <div
            ref={panel}
            data-composer-panel="materials"
            style={{ ...position, maxHeight: availableHeight }}
            className="fixed z-50 flex flex-col overflow-hidden rounded-2xl bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => handleKey(event.nativeEvent)}
          >
            {pane === "resources" && inputMode === "button" && (
              <div className="flex shrink-0 items-center gap-1 border-b p-1.5">
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
                  <ArrowLeft />
                </Button>
                <InputGroup className="h-9 border-0 shadow-none">
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    ref={search}
                    variant="compact"
                    autoFocus
                    role="combobox"
                    aria-expanded
                    aria-controls={id}
                    aria-activedescendant={
                      activeIndex >= 0 ? `${id}-${activeIndex}` : undefined
                    }
                    aria-label="搜索资源"
                    placeholder={
                      resourceKind === "skill"
                        ? "搜索 Skill"
                        : "搜索工作区文件或目录"
                    }
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
              active={activeIndex}
              listRef={list}
              maxHeight={Math.max(
                0,
                Math.min(
                  320,
                  availableHeight -
                    8 -
                    (pane === "resources" && inputMode === "button" ? 54 : 0)
                )
              )}
              loading={pane === "resources" && resources.loading}
              error={pane === "resources" ? resources.error : undefined}
              issue={pane === "resources" ? resources.issue : undefined}
              statusGroup={
                inputMode === "slash" || inputMode === "skill"
                  ? "Skill 调用"
                  : undefined
              }
              label={
                inputMode === "file"
                  ? "工作区文件候选"
                  : inputMode === "slash" || inputMode === "skill"
                    ? "命令与 Skill 候选"
                    : "消息材料候选"
              }
              emptyMessage={
                inputMode === "file"
                  ? "没有匹配的工作区文件，可修改关键词"
                  : inputMode === "slash" || inputMode === "skill"
                    ? "没有匹配的命令或 Skill，可修改关键词"
                    : "没有可用的工作区文件或 Skill"
              }
              diagnostics={
                pane === "resources"
                  ? resources.diagnostics
                      .filter(
                        (item) =>
                          item.scope ===
                          (inputMode === "slash" ||
                          inputMode === "skill" ||
                          (inputMode === "button" && resourceKind === "skill")
                            ? "skills"
                            : "files")
                      )
                      .map((item) => item.message)
                  : []
              }
              onRetry={() => {
                resources.retry()
                ;(inputMode === "button"
                  ? search.current
                  : composerEditor(anchorRef?.current)
                )?.focus({ preventScroll: true })
              }}
              onActive={setActive}
              onSelect={activate}
              onDrill={drill}
            />
          </div>,
          document.body
        )}
    </>
  )
}
