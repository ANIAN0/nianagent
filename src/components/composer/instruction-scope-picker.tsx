import { useId } from "react"
import { cn } from "cn"
import type { SessionInstruction } from "@/contracts/rpc.generated"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Field, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field"
import type { InstructionScope } from "@/lib/composer/types"

export const instructionScopes = [
  { value: "all", label: "全局与目录" },
  { value: "directory", label: "仅目录" },
  { value: "none", label: "不加载" },
] as const

export function InstructionScopePicker({
  value,
  onChange,
  instructions,
}: {
  value: InstructionScope
  onChange: (scope: InstructionScope) => void
  instructions?: SessionInstruction[]
}) {
  const scopeId = useId()
  const visible = (instructions ?? []).filter(
    (file) =>
      value === "all" || (value === "directory" && file.source === "directory")
  )

  return (
    <FieldSet className="min-h-0 min-w-0 flex-1 gap-0">
      <FieldLegend className="sr-only">AGENTS.md加载范围</FieldLegend>
      <RadioGroup
        className="flex min-h-0 flex-1 flex-col gap-2"
        aria-label="AGENTS.md加载范围"
        value={value}
        onValueChange={(scope) => onChange(scope as InstructionScope)}
      >
        {instructionScopes.map((option) => {
          const selected = value === option.value
          const radioId = `${scopeId}-${option.value}`
          return (
            <div
              key={option.value}
              data-selected={selected || undefined}
              className={cn(
                "flex flex-col rounded-lg border border-transparent px-2.5 py-2 data-[selected=true]:border-border data-[selected=true]:bg-muted/30",
                selected ? "min-h-0 shrink" : "shrink-0"
              )}
            >
              <Field orientation="horizontal" className="shrink-0">
                <RadioGroupItem id={radioId} value={option.value} />
                <FieldLabel htmlFor={radioId} className="cursor-pointer">
                  {option.label}
                </FieldLabel>
              </Field>
              {selected && option.value !== "none" && (
                <div
                  className="moon-scrollbar mt-3 min-h-0 overflow-auto pl-6"
                  aria-label="AGENTS.md文件路径"
                >
                  {visible.length ? (
                    <ul className="flex flex-col gap-3 text-[13px] leading-5 break-all select-text">
                      {visible.map((file) => (
                        <li key={file.path}>{file.path}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-3 text-xs text-muted-foreground">
                      所选范围内未发现AGENTS.md
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </RadioGroup>
    </FieldSet>
  )
}
