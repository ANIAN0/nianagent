import { ChevronDown, FileText } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { SessionInstruction } from "@/features/models/model-contract.generated"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { InstructionScope } from "./home-types"

export const instructionScopes = [
  {
    value: "all",
    label: "全局与目录指令",
    description: "加载个人指令，以及当前目录链的项目指令",
  },
  {
    value: "directory",
    label: "仅目录指令",
    description: "不加载全局指令，保留目录链的项目指令",
  },
  { value: "none", label: "不加载项目指令", description: "不影响应用系统指令" },
] as const

export function InstructionScopePicker({
  value,
  onChange,
  workspacePath,
  instructions,
  snapshot = false,
}: {
  value: InstructionScope
  onChange: (scope: InstructionScope) => void
  snapshot?: boolean
  instructions?: SessionInstruction[]
  workspacePath: string
}) {
  const visible = (instructions ?? []).filter(
    (file) =>
      value === "all" || (value === "directory" && file.source === "directory")
  )
  return (
    <div>
      <div className="mb-3 border-b pb-3 text-xs leading-6">
        <p className="text-muted-foreground">工作目录</p>
        <p className="break-all">{workspacePath || "未选择工作目录"}</p>
      </div>
      <RadioGroup
        aria-label="项目指令加载范围"
        className="gap-0 overflow-hidden rounded-[14px] border"
        value={value}
        onValueChange={(scope) => onChange(scope as InstructionScope)}
      >
        {instructionScopes.map((option) => (
          <label
            key={option.value}
            className="flex min-h-14 cursor-pointer items-start gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-accent/50 has-data-checked:bg-accent/60"
          >
            <RadioGroupItem value={option.value} className="mt-0.5" />
            <span>
              <span className="block text-[13px] leading-5">
                {option.label}
              </span>
              <span className="block text-xs leading-5 text-muted-foreground">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {instructions
          ? snapshot
            ? "以下是本会话已保存的指令快照。采用本次读取的文件并应用后才更新。"
            : "以下为本次从磁盘读取的候选指令文件；应用成功后保存为生效快照。"
          : "此展示使用示例配置，不读取指令文件。"}
      </p>
      {instructions && (
        <section className="mt-4" aria-label="项目指令来源">
          <h3 className="mb-2 text-xs font-medium">
            指令文件 · {visible.length}
          </h3>
          {!visible.length && (
            <p className="text-xs leading-5 text-muted-foreground">
              {value === "none"
                ? "本会话不加载项目指令。"
                : "所选范围内未发现指令文件。"}
            </p>
          )}
          {visible.map((file) => (
            <Collapsible key={file.path} className="border-b last:border-b-0">
              <CollapsibleTrigger className="flex w-full items-start gap-2 py-3 text-left text-xs hover:bg-accent/50 [&[data-state=open]>svg:last-child]:rotate-180">
                <FileText className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block leading-5 break-all">{file.path}</span>
                  <span className="text-muted-foreground">
                    {file.source === "global" ? "全局指令" : "目录指令"}
                  </span>
                </span>
                <ChevronDown className="mt-0.5 size-4 shrink-0" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mb-3 max-h-52 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5 break-words whitespace-pre-wrap">
                  {file.content || "文件为空"}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </section>
      )}
    </div>
  )
}
