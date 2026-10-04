import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Property = {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
}
type Schema = {
  type?: string
  properties?: Record<string, Property>
  required?: string[]
  additionalProperties?: boolean
}
export function readExtensionConfiguration(
  schemaText: string,
  configurationText: string
) {
  const schema = JSON.parse(schemaText) as Schema
  const configuration: unknown = JSON.parse(configurationText)
  if (
    !schema ||
    schema.type !== "object" ||
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration)
  )
    throw new Error("扩展配置格式无法识别，请检查扩展安装。")
  return { schema, configuration: configuration as Record<string, unknown> }
}
export function extensionConfigurationErrors(
  schema: Schema,
  values: Record<string, unknown>
) {
  const errors: string[] = []
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const value = values[name]
    if (value === undefined) {
      if (schema.required?.includes(name))
        errors.push(`请填写${property.title ?? name}。`)
      continue
    }
    if (
      property.type === "string" &&
      (typeof value !== "string" ||
        (property.minLength !== undefined &&
          value.length < property.minLength) ||
        (property.maxLength !== undefined && value.length > property.maxLength))
    )
      errors.push(`${property.title ?? name}不符合长度要求。`)
    if (
      (property.type === "number" || property.type === "integer") &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        (property.type === "integer" && !Number.isSafeInteger(value)) ||
        (property.minimum !== undefined && value < property.minimum) ||
        (property.maximum !== undefined && value > property.maximum))
    )
      errors.push(`${property.title ?? name}不符合数值范围。`)
    if (property.type === "boolean" && typeof value !== "boolean")
      errors.push(`${property.title ?? name}需要开关值。`)
    if (property.enum && !property.enum.some((option) => option === value))
      errors.push(`请选择${property.title ?? name}的有效值。`)
  }
  return errors
}
export function ExtensionConfigurationFields({
  id,
  schema,
  values,
  disabled,
  onChange,
}: {
  id: string
  schema: Schema
  values: Record<string, unknown>
  disabled: boolean
  onChange(value: Record<string, unknown>): void
}) {
  const properties = Object.entries(schema.properties ?? {})
  const supported = properties.every(
    ([, field]) =>
      ["string", "number", "integer", "boolean"].includes(field.type ?? "") &&
      (!field.enum || field.enum.every((option) => typeof option === "string"))
  )
  const edit = (name: string, value: unknown) =>
    onChange({ ...values, [name]: value })
  if (!supported)
    return (
      <Field>
        <FieldLabel htmlFor={`${id}-json`}>扩展配置（JSON 对象）</FieldLabel>
        <Textarea
          id={`${id}-json`}
          disabled={disabled}
          value={JSON.stringify(values, null, 2)}
          readOnly
        />
        <FieldDescription>
          此扩展的配置结构暂不支持表单编辑。当前配置仍可查看；启停可单独保存。
        </FieldDescription>
      </Field>
    )
  return (
    <FieldGroup>
      {properties.map(([name, field]) => (
        <Field
          key={name}
          orientation={field.type === "boolean" ? "horizontal" : "vertical"}
          data-disabled={disabled}
        >
          <FieldLabel htmlFor={`${id}-${name}`}>
            {field.title ?? name}
            {schema.required?.includes(name) ? " *" : ""}
          </FieldLabel>
          {field.type === "boolean" ? (
            <Switch
              id={`${id}-${name}`}
              checked={values[name] === true}
              disabled={disabled}
              onCheckedChange={(value) => edit(name, value)}
            />
          ) : field.enum ? (
            <Select
              value={String(values[name] ?? "")}
              disabled={disabled}
              onValueChange={(value) => edit(name, value)}
            >
              <SelectTrigger id={`${id}-${name}`}>
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {field.enum.map((option) => (
                    <SelectItem key={String(option)} value={String(option)}>
                      {String(option)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`${id}-${name}`}
              type={field.type === "string" ? "text" : "number"}
              min={field.minimum}
              max={field.maximum}
              step={field.type === "integer" ? 1 : "any"}
              maxLength={field.maxLength}
              placeholder={
                field.default === undefined ? undefined : String(field.default)
              }
              disabled={disabled}
              value={
                typeof values[name] === "number" &&
                !Number.isFinite(values[name])
                  ? ""
                  : String(values[name] ?? "")
              }
              onChange={(event) => {
                if (field.type === "string") edit(name, event.target.value)
                else if (event.target.value === "") {
                  const next = { ...values }
                  delete next[name]
                  onChange(next)
                } else edit(name, Number(event.target.value))
              }}
            />
          )}
          {field.description && (
            <FieldDescription>{field.description}</FieldDescription>
          )}
        </Field>
      ))}
    </FieldGroup>
  )
}
