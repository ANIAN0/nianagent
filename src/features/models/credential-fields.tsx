import { ApiKeyField } from "./api-key-field"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { ModelConnection } from "./model-types"
export function CredentialFields({
  value,
  errors,
  disabled,
  onChange,
  onClearKey,
  onRevealKey,
  onReloadConnection,
}: {
  onRevealKey?: (signal: AbortSignal) => Promise<string>
  onReloadConnection?: () => void
  value: ModelConnection
  errors: Record<string, string>
  disabled?: boolean
  onChange: (patch: Partial<ModelConnection>) => void
  onClearKey: (apply: () => void) => void
}) {
  return (
    <FieldGroup className="gap-4">
      <FieldSet>
        <FieldLegend variant="label">凭据方式</FieldLegend>
        <RadioGroup
          className="model-radio"
          value={value.credential}
          disabled={disabled}
          aria-label="凭据方式"
          onValueChange={(mode) => {
            const apply = () =>
              onChange({
                credential: mode as ModelConnection["credential"],
                apiKey: "",
                keySaved: false,
                environmentVariable: "",
              })
            if (value.keySaved && mode === "none") onClearKey(apply)
            else apply()
          }}
        >
          {(
            [
              ["key", "API 密钥"],
              ["environment", "环境变量"],
              ["none", "无凭据"],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode}>
              <RadioGroupItem value={mode} />
              {label}
            </label>
          ))}
        </RadioGroup>
      </FieldSet>
      {value.credential === "key" ? (
        <ApiKeyField
          key={`${value.id}:${value.revision ?? "new"}`}
          value={value.apiKey}
          saved={value.keySaved}
          disabled={disabled}
          error={errors.credential}
          onReveal={onRevealKey}
          onReloadConnection={onReloadConnection}
          onChange={(apiKey) => onChange({ apiKey, keySaved: false })}
        />
      ) : value.credential === "environment" ? (
        <Field data-invalid={!!errors.credential}>
          <FieldLabel htmlFor="connection-environment">环境变量名</FieldLabel>
          <Input
            id="connection-environment"
            value={value.environmentVariable}
            disabled={disabled}
            aria-invalid={!!errors.credential}
            onChange={(e) => onChange({ environmentVariable: e.target.value })}
          />
          <FieldDescription>
            只保存变量名，由后端进程读取；修改系统环境变量后需重启应用。
          </FieldDescription>
          {errors.credential && <FieldError>{errors.credential}</FieldError>}
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">请求不附加凭据。</p>
      )}
    </FieldGroup>
  )
}
