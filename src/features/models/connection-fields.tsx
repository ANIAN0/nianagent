import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from "@/components/ui/field"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select"
import { CredentialFields } from "./credential-fields"
import type { ModelConnection } from "./model-types"

export function ConnectionFields({
  value,
  errors,
  disabled,
  onChange,
  onClearKey,
  providers,
  onRevealKey,
  onReloadConnection,
}: {
  onRevealKey?: (signal: AbortSignal) => Promise<string>
  onReloadConnection?: () => void
  providers?: { id: string; name: string }[]
  value: ModelConnection
  errors: Record<string, string>
  disabled?: boolean
  onChange: (patch: Partial<ModelConnection>) => void
  onClearKey: (apply: () => void) => void
}) {
  const hasCustomHeaders =
    !!value.headers.trim() && value.headers.trim() !== "{}"
  const [advancedOpen, setAdvancedOpen] = useState(hasCustomHeaders)
  const headersOpen = advancedOpen || !!errors.headers

  return (
    <FieldGroup className="gap-5">
      <FieldGroup className="model-field-grid">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="connection-name">连接名称</FieldLabel>
          <Input
            id="connection-name"
            value={value.name}
            placeholder="例如：团队模型网关"
            disabled={disabled}
            aria-invalid={!!errors.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          {errors.name && <FieldError>{errors.name}</FieldError>}
        </Field>
        {value.kind === "subscription" && providers && (
          <Field data-invalid={!!errors.providerId}>
            <FieldLabel htmlFor="subscription-provider">订阅提供者</FieldLabel>
            <Select
              value={value.providerId || ""}
              disabled={disabled || !!value.revision}
              onValueChange={(providerId) =>
                onChange({ providerId, models: [], account: undefined })
              }
            >
              <SelectTrigger
                id="subscription-provider"
                aria-invalid={!!errors.providerId}
              >
                <SelectValue placeholder="选择 Pi 支持的服务" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {errors.providerId && <FieldError>{errors.providerId}</FieldError>}
            <FieldDescription>
              由 Pi 提供授权和凭据刷新；每个提供者使用一个连接。
            </FieldDescription>
          </Field>
        )}
        {value.kind === "api" && (
          <Field>
            <FieldLabel htmlFor="connection-protocol">模型目录协议</FieldLabel>
            <Select
              value={value.protocol || "openai-completions"}
              onValueChange={(protocol) =>
                onChange({
                  protocol: protocol as NonNullable<
                    ModelConnection["protocol"]
                  >,
                })
              }
              disabled={disabled}
            >
              <SelectTrigger id="connection-protocol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="openai-completions">
                    OpenAI 兼容
                  </SelectItem>
                  <SelectItem value="anthropic-messages">Anthropic</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        )}
        {value.kind === "api" && (
          <Field
            data-invalid={!!errors.endpoint}
            className="sm:col-span-2"
          >
            <FieldLabel htmlFor="connection-endpoint">服务端点</FieldLabel>
            <Input
              id="connection-endpoint"
              value={value.endpoint}
              placeholder="https://example.com/v1"
              disabled={disabled}
              aria-invalid={!!errors.endpoint}
              onChange={(e) => onChange({ endpoint: e.target.value })}
            />
            {errors.endpoint && <FieldError>{errors.endpoint}</FieldError>}
          </Field>
        )}
      </FieldGroup>
      {value.kind === "api" && (
        <>
          <CredentialFields
            {...{
              value,
              errors,
              disabled,
              onChange,
              onClearKey,
              onRevealKey,
              onReloadConnection,
            }}
          />
          <Collapsible open={headersOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  className={
                    headersOpen
                      ? "size-3.5 transition-transform"
                      : "size-3.5 -rotate-90 transition-transform"
                  }
                />
                高级设置（自定义请求头）
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <Field data-invalid={!!errors.headers}>
                <FieldLabel htmlFor="connection-headers">
                  自定义请求头
                </FieldLabel>
                <Textarea
                  id="connection-headers"
                  rows={3}
                  value={value.headers}
                  disabled={disabled}
                  aria-invalid={!!errors.headers}
                  onChange={(e) => onChange({ headers: e.target.value })}
                />
                {errors.headers ? (
                  <FieldError>{errors.headers}</FieldError>
                ) : (
                  <FieldDescription>
                    键和值均为字符串的 JSON 对象。
                  </FieldDescription>
                )}
              </Field>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </FieldGroup>
  )
}
