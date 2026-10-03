import { useCallback, useId, useRef, useState } from "react"
import { FileCode2, LockKeyhole, TriangleAlert, Database } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DeferredContent } from "./deferred-content"
import { CopyButton } from "./copy-button"
import type {
  ModelOperation,
  OperationDefinition,
  SchemaRegistry,
  Schema,
} from "./types"

const loadFields = () =>
  import("./schema-field-table").then((module) => ({
    default: module.SchemaFieldTable,
  }))

function ContractFields({
  schema,
  schemas,
  label,
}: {
  schema: Schema
  schemas: SchemaRegistry
  label: string
}) {
  const fields = useRef<HTMLDivElement>(null)
  const restoreSearchFocus = useCallback(() => {
    fields.current
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true })
  }, [])
  const resolved = schema.$ref ? schemas[schema.$ref] : schema
  if (
    resolved?.type === "object" &&
    !resolved.anyOf &&
    Object.keys(resolved.properties ?? {}).length === 0
  )
    return (
      <p className="api-return-summary">
        <code>{"{}"}</code>
        <span>
          {label === "请求" ? "无需参数。" : "返回空对象。"}
          {resolved.additionalProperties === false && "不接受额外字段。"}
        </span>
      </p>
    )
  return (
    <div ref={fields}>
      <DeferredContent
        load={loadFields}
        props={{ schema, schemas, label }}
        label={`${label}字段表`}
        fallback={<p role="status">正在载入字段说明…</p>}
        onRetryReady={restoreSearchFocus}
      />
    </div>
  )
}

export function OperationDocs({
  operation,
  definition,
  schemas,
}: {
  operation: ModelOperation
  definition: OperationDefinition
  schemas: SchemaRegistry
}) {
  const [fieldType, setFieldType] = useState<"request" | "response">("request")
  const fieldId = useId()
  const response = definition.response.$ref
    ? schemas[definition.response.$ref]
    : definition.response
  return (
    <section
      className="api-operation-docs"
      aria-labelledby="api-operation-title"
    >
      <div className="api-operation-heading">
        <div className="api-operation-eyebrow">
          <span>{definition.module ?? "模型配置"}</span>
          <Badge variant="secondary">已实现</Badge>
        </div>
        <h2 id="api-operation-title">{definition.title}</h2>
        <div className="api-operation-id">
          <code>{operation}</code>
          <CopyButton value={operation} label="复制标识" />
        </div>
      </div>
      <div className="api-operation-facts">
        <div className="api-operation-fact">
          <Database aria-hidden="true" />
          <div>
            <h3>用途与数据变化</h3>
            <p>{definition.effect}</p>
          </div>
        </div>
        <div className="api-operation-fact">
          <LockKeyhole aria-hidden="true" />
          <div>
            <h3>调用条件与取消</h3>
            <p>{definition.condition}</p>
          </div>
        </div>
        <div className="api-operation-fact">
          <TriangleAlert aria-hidden="true" />
          <div>
            <h3>错误与恢复</h3>
            <p>{definition.errors}</p>
          </div>
        </div>
      </div>
      <div className="api-contract-header">
        <FileCode2 aria-hidden="true" />
        <h3>接口契约</h3>
        <span>正式定义</span>
      </div>
      <div className="api-contract-tabs">
        <div
          className="api-field-switcher"
          role="group"
          aria-label="接口字段类型"
        >
          {(["request", "response"] as const).map((type) => (
            <Button
              key={type}
              id={`${fieldId}-${type}`}
              variant="ghost"
              size="sm"
              aria-pressed={fieldType === type}
              aria-controls={`${fieldId}-fields`}
              onClick={() => setFieldType(type)}
            >
              {type === "request" ? "请求字段" : "返回字段"}
            </Button>
          ))}
        </div>
        <section
          id={`${fieldId}-fields`}
          role="region"
          aria-labelledby={`${fieldId}-${fieldType}`}
        >
          {fieldType === "request" ? (
            <ContractFields
              key="request"
              schema={definition.request}
              schemas={schemas}
              label="请求"
            />
          ) : (
            <>
              <p className="api-return-summary">
                <code>{definition.result}</code>
                {response?.description && <span>{response.description}</span>}
              </p>
              <ContractFields
                key="response"
                schema={definition.response}
                schemas={schemas}
                label="返回"
              />
            </>
          )}
        </section>
      </div>
    </section>
  )
}
