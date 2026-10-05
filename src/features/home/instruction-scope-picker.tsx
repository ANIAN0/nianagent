import { useRef, useState } from "react"
import { ArrowLeft, ChevronRight, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SessionInstruction } from "@/features/models/model-contract.generated"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { InstructionScope } from "./home-types"
export const instructionScopes = [
  {
    value: "all",
    label: "全局与目录指令",
    description: "个人指令及当前目录链的项目指令",
  },
  {
    value: "directory",
    label: "仅目录指令",
    description: "只加载当前目录链的项目指令",
  },
  { value: "none", label: "不加载项目指令", description: "不影响应用系统指令" },
] as const
export function InstructionScopePicker({
  value,
  onChange,
  workspacePath,
  instructions,
  savedInstructions,
  snapshot = false,
}: {
  value: InstructionScope
  onChange: (scope: InstructionScope) => void
  snapshot?: boolean
  instructions?: SessionInstruction[]
  savedInstructions?: SessionInstruction[]
  workspacePath: string
}) {
  const [showSaved, setShowSaved] = useState(false)
  const [detail, setDetail] = useState<SessionInstruction>()
  const scroll = useRef<HTMLDivElement>(null)
  const position = useRef(0)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const savedView = snapshot || showSaved
  const visible = showSaved
    ? (savedInstructions ?? [])
    : (instructions ?? []).filter(
        (file) =>
          value === "all" ||
          (value === "directory" && file.source === "directory")
      )
  function back() {
    const path = detail?.path
    setDetail(undefined)
    requestAnimationFrame(() => {
      if (scroll.current) scroll.current.scrollTop = position.current
      if (path) buttons.current.get(path)?.focus()
    })
  }
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3"
      onKeyDownCapture={(event) => {
        if (detail && event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          back()
        }
      }}
    >
      {detail ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit shrink-0"
            onClick={back}
          >
            <ArrowLeft />
            返回项目指令
          </Button>
          <p className="shrink-0 text-xs break-all text-muted-foreground">
            {detail.path} · {savedView ? "已保存快照" : "本次磁盘读取"} · 只读
          </p>
          <pre className="moon-scrollbar min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5 whitespace-pre-wrap">
            {detail.content || "文件为空"}
          </pre>
        </>
      ) : (
        <>
          <RadioGroup
            className="shrink-0 gap-2"
            aria-label="项目指令加载范围"
            value={value}
            onValueChange={(scope) => onChange(scope as InstructionScope)}
          >
            {instructionScopes.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/50"
              >
                <RadioGroupItem value={option.value} />
                <span className="text-[13px] leading-5">
                  {option.label}
                  <span className="block text-xs leading-[18px] text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
          {savedInstructions && (
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                size="xs"
                variant={showSaved ? "ghost" : "secondary"}
                onClick={() => setShowSaved(false)}
              >
                磁盘候选
              </Button>
              <Button
                type="button"
                size="xs"
                variant={showSaved ? "secondary" : "ghost"}
                onClick={() => setShowSaved(true)}
              >
                已保存快照
              </Button>
            </div>
          )}
          <p
            className="shrink-0 text-xs leading-5 text-muted-foreground"
            title={workspacePath}
          >
            {savedView
              ? "已保存指令快照；应用新配置后才会更新。"
              : instructions
                ? "本次从磁盘读取的候选文件，应用成功后保存为生效快照。"
                : "示例配置，不读取指令文件。"}
          </p>
          <div
            ref={scroll}
            className="moon-scrollbar min-h-0 flex-1 overflow-auto"
            aria-label="项目指令来源"
          >
            <p className="mb-2 text-xs text-muted-foreground">
              指令文件 · {visible.length}
            </p>
            {!visible.length && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                {value === "none"
                  ? "本会话不加载项目指令"
                  : "所选范围内未发现指令文件"}
              </p>
            )}
            {visible.map((file) => (
              <Button
                ref={(node) => {
                  if (node) buttons.current.set(file.path, node)
                  else buttons.current.delete(file.path)
                }}
                key={file.path}
                type="button"
                variant="ghost"
                className="h-auto min-h-10 w-full justify-start gap-2 py-2 font-normal"
                onClick={() => {
                  position.current = scroll.current?.scrollTop ?? 0
                  setDetail(file)
                }}
              >
                <FileText className="size-4 shrink-0" />
                <span
                  className="min-w-0 flex-1 truncate text-left text-[13px]"
                  title={file.path}
                >
                  {file.path.split(/[\\/]/u).pop()}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {file.source === "global" ? "全局" : "目录"}
                </span>
                <ChevronRight className="size-3 shrink-0" />
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
