import { useMaterialPicker } from "./use-material-picker"
import type { MaterialPickerProps } from "./material-picker.types"
export type { MaterialPickerProps } from "./material-picker.types"
import { composerEditor } from "@/components/composer/composer-editor-contract"

import { createPortal } from "react-dom"

import { ArrowLeft, Plus, Search } from "lucide-react"
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

import { MaterialCandidateList } from "@/features/materials/material-candidate-list"

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
  const {
    fileInput,
    setOpen,
    trigger,
    open,
    id,
    toggle,
    panel,
    position,
    availableHeight,
    handleKey,
    pane,
    inputMode,
    setPane,
    setQuery,
    setActive,
    search,
    activeIndex,
    resourceKind,
    query,
    rows,
    list,
    resources,
    activate,
    drill,
  } = useMaterialPicker({
    disabled,
    materials,
    selected,
    onAdd,
    anchorRef,
    onInsert,
    allowCompact,
    onChooseAttachments,
    choosing,
    sessionId,
    workspacePath,
    onTextChange,
    onCommandSelect,
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
              type: "file",
              status: "failed",
              source: file.name,
              error: "附件未准备，请通过正式输入区重新选择。",
              retryable: false,
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
