import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { McpVariableFields } from "./mcp-variable-fields"
import type { McpConfiguration } from "./mcp-service"
export type McpTransportFieldsProps = {
  value: McpConfiguration
  disabled?: boolean
  onChange(patch: Partial<McpConfiguration>): void
}
export function McpTransportFields({
  value,
  disabled,
  onChange,
}: McpTransportFieldsProps) {
  return (
    <FieldGroup>
      {value.transport === "stdio" ? (
        <>
          <Field>
            <FieldLabel htmlFor="mcp-command">可执行文件</FieldLabel>
            <Input
              id="mcp-command"
              placeholder="node / npx / 可执行文件的完整路径"
              value={value.command}
              disabled={disabled}
              onChange={(event) => onChange({ command: event.target.value })}
            />
            <FieldDescription>
              只填写程序，参数在下一栏逐行填写；带空格的文件路径无需再加引号。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-args">参数</FieldLabel>
            <Textarea
              id="mcp-args"
              placeholder={
                "H:/tools/server.mjs\n--workspace\nH:/workspace/moon"
              }
              rows={3}
              value={value.args.join("\n")}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  args: event.target.value
                    ? event.target.value.split("\n")
                    : [],
                })
              }
            />
            <FieldDescription>
              每行一个参数，含空格或中文的参数保持完整。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-cwd">工作目录（可选）</FieldLabel>
            <Input
              id="mcp-cwd"
              placeholder="留空使用当前会话目录"
              value={value.cwd}
              disabled={disabled}
              onChange={(event) => onChange({ cwd: event.target.value })}
            />
          </Field>
          <McpVariableFields
            label="环境变量"
            value={value.env}
            disabled={disabled}
            onChange={(env) => onChange({ env })}
          />
        </>
      ) : (
        <>
          <Field>
            <FieldLabel htmlFor="mcp-url">服务地址</FieldLabel>
            <Input
              id="mcp-url"
              placeholder="https://example.com/mcp"
              value={value.url}
              disabled={disabled}
              onChange={(event) => onChange({ url: event.target.value })}
            />
            <FieldDescription>使用 Streamable HTTP 服务端点。</FieldDescription>
          </Field>
          <McpVariableFields
            label="请求头"
            value={value.headers}
            disabled={disabled}
            onChange={(headers) => onChange({ headers })}
          />
        </>
      )}
    </FieldGroup>
  )
}
