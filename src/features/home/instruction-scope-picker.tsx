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
}: {
  value: InstructionScope
  onChange: (scope: InstructionScope) => void
  workspacePath: string
}) {
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
        目录链包括从根到当前工作目录的适用指令。当前为模拟配置，不读取指令文件。
      </p>
    </div>
  )
}
