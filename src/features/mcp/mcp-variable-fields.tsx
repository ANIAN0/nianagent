import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import type { McpConfiguration } from "./mcp-service"
export type McpVariableFieldsProps = {
  label: string
  value: McpConfiguration["env"]
  disabled?: boolean
  onChange(value: McpConfiguration["env"]): void
}
export function McpVariableFields({
  label,
  value,
  disabled,
  onChange,
}: McpVariableFieldsProps) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex flex-col gap-2">
        {value.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={`${label}名称 ${index + 1}`}
              placeholder="名称"
              value={entry.name}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  value.map((item, i) =>
                    i === index ? { ...item, name: event.target.value } : item
                  )
                )
              }
              className="min-w-0 flex-1"
            />
            <Input
              aria-label={`${label}值 ${index + 1}`}
              placeholder="值或 ${ENV_NAME}"
              value={entry.value}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  value.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item
                  )
                )
              }
              className="min-w-0 flex-[2]"
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`删除${label} ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={disabled}
          onClick={() => onChange([...value, { name: "", value: "" }])}
        >
          <Plus />
          添加{label}
        </Button>
      </div>
      <FieldDescription>
        支持字面值和 ${"{ENV_NAME}"}；环境变量由 Moon 宿主读取。
      </FieldDescription>
    </Field>
  )
}
