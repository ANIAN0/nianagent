import { Badge } from "@/components/ui/badge"
import {
  componentsForOperation,
  operationsForComponent,
  apiHref,
  fileHref,
  componentHref,
  sourcePaths,
} from "../../devtools/content-index"
import { CopyButton } from "./copy-button"
import { SchemaFieldTable } from "./schema-field-table"
import type {
  OperationDefinition,
  SchemaRegistry,
  Schema,
  ApiDocument,
} from "./types"
function example(
  schema: Schema,
  schemas: SchemaRegistry,
  seen = new Set<string>()
): unknown {
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return "（递归记录）"
    return example(
      schemas[schema.$ref] ?? {},
      schemas,
      new Set(seen).add(schema.$ref)
    )
  }
  if (schema.default !== undefined) return schema.default
  if (schema.enum?.length) return schema.enum[0]
  if (schema.anyOf)
    return example(
      schema.anyOf.find((part) => part.type !== "null") ?? schema.anyOf[0]!,
      schemas,
      seen
    )
  if (schema.properties)
    return Object.fromEntries(
      Object.entries(schema.properties)
        .filter(([key]) => schema.required?.includes(key))
        .map(([key, value]) => [key, example(value, schemas, seen)])
    )
  if (schema.type === "array") return []
  if (schema.type === "integer" || schema.type === "number")
    return schema.minimum ?? 0
  if (schema.type === "boolean") return false
  if (schema.type === "null") return null
  return schema.type === "string" ? "示例值" : "（按所属业务契约返回）"
}
function ContractFields({
  schema,
  schemas,
  label,
  documentationOnly = false,
}: {
  schema: Schema
  schemas: SchemaRegistry
  label: string
  documentationOnly?: boolean
}) {
  const resolved = schema.$ref ? schemas[schema.$ref] : schema
  if (
    resolved?.type === "object" &&
    !resolved.anyOf &&
    !Object.keys(resolved.properties ?? {}).length &&
    resolved.additionalProperties === false
  )
    return (
      <p className="api-return-summary">
        <code>{"{}"}</code>
        <span>{label === "入参" ? "无参数" : "空对象"}；不接受额外字段。</span>
      </p>
    )
  return (
    <SchemaFieldTable
      schema={schema}
      schemas={schemas}
      label={label}
      documentationOnly={documentationOnly}
    />
  )
}
export function OperationDocs({
  operation,
  definition,
  schemas,
  facts,
}: {
  operation: string
  definition: OperationDefinition
  schemas: SchemaRegistry
  facts?: ApiDocument
}) {
  const requestExample = JSON.stringify(
    facts?.kind === "desktop"
      ? example(definition.request, schemas)
      : (facts?.envelope?.example ?? definition.example),
    null,
    2
  )
  const responseExample = JSON.stringify(
    example(definition.response, schemas),
    null,
    2
  )
  const invocation =
    facts?.kind === "desktop"
      ? `import { invoke } from "@tauri-apps/api/core"\n\nconst result = await invoke(${JSON.stringify(operation)}, ${requestExample});`
      : `import { rpcCall } from "@/lib/rpc/client"\n\nconst result = await rpcCall(${JSON.stringify(facts?.kind === "plugin" ? "pluginCall" : operation)}, ${requestExample});`
  const components = componentsForOperation(operation)
  const related = [
    ...new Map(
      components.flatMap((entry) => operationsForComponent(entry.id))
    ).entries(),
  ].filter(([id]) => id !== operation)
  return (
    <section
      className="api-operation-docs"
      aria-labelledby="api-operation-title"
    >
      <header className="api-operation-heading">
        <div className="api-operation-eyebrow">
          <span>{definition.module ?? facts?.module ?? "模型配置"}</span>
          <Badge variant="secondary">
            {facts?.kind === "desktop"
              ? "Tauri 原生命令"
              : facts?.kind === "plugin"
                ? "插件操作"
                : "业务 RPC"}
          </Badge>
        </div>
        <h1 id="api-operation-title">{definition.title}</h1>
        <div className="api-operation-id">
          <code>{operation}</code>
          <CopyButton value={operation} label="复制标识" />
        </div>
        <p>{definition.effect}</p>
      </header>
      <section>
        <h2>调用方式</h2>
        {definition.method && (
          <p>
            宿主方法：<code>{definition.method}</code>
            {facts?.kind === "plugin"
              ? ` · ${facts.plugin} / ${facts.name}`
              : ""}
          </p>
        )}
        <pre>
          <code>{invocation}</code>
        </pre>
        <p className="devtools-muted">
          用法示例，参数来自正式契约；此页阅读不会执行调用。
          {facts?.kind === "plugin"
            ? "payload 为 JSON 编码，返回 payload 解码后按下方已知结构读取。"
            : ""}
        </p>
      </section>
      <section>
        <h2>调用条件</h2>
        <p>{definition.condition}</p>
      </section>
      <section id="request-fields">
        <h2>请求参数</h2>
        <div className="api-contract-section">
          <ContractFields
            schema={definition.request}
            schemas={schemas}
            label="入参"
          />
          <details>
            <summary>请求 JSON 示例</summary>
            <pre>
              {facts?.kind === "plugin"
                ? JSON.stringify(definition.example, null, 2)
                : requestExample}
            </pre>
          </details>
        </div>
      </section>
      <section id="response-fields">
        <h2>成功返回</h2>
        {facts?.kind === "plugin" && (
          <p>已知返回字段；运行时允许额外字段，不据文档收紧开放输出。</p>
        )}
        <div className="api-contract-section">
          <ContractFields
            schema={definition.response}
            schemas={schemas}
            label="出参"
            documentationOnly={facts?.kind === "plugin"}
          />
          <details>
            <summary>返回结构示例</summary>
            <pre>{responseExample}</pre>
            <p className="devtools-muted">
              结构示意，非真实调用结果；可选字段和联合分支见字段说明。
            </p>
          </details>
        </div>
      </section>
      <section>
        <h2>失败与恢复</h2>
        <p>{definition.errors}</p>
        {facts?.kind !== "desktop" && (
          <details>
            <summary>错误返回字段</summary>
            <ContractFields
              schema={{ $ref: "RpcFailure" }}
              schemas={schemas}
              label="错误"
            />
          </details>
        )}
        {related.length > 0 && (
          <div className="reader-related">
            {related.map(([id, doc]) => (
              <a key={id} href={apiHref(id)}>
                {doc.definition.title} · {id}
              </a>
            ))}
          </div>
        )}
      </section>
      {facts && (
        <section>
          <h2>相关实现与页面</h2>
          <p>{facts.storage}</p>
          <p className="devtools-muted">{facts.source}</p>
          <div className="reader-related">
            {sourcePaths(facts.source).map((path) => (
              <a key={path} href={fileHref(path)}>
                {path}
              </a>
            ))}
          </div>
          <h3>使用入口</h3>
          <div className="reader-related">
            {facts.consumers.map((path) => (
              <a key={path} href={fileHref(path)}>
                {path}
              </a>
            ))}
          </div>
          {components.length > 0 && (
            <div className="reader-related">
              {components.map((entry) => (
                <a key={entry.id} href={componentHref(entry.id)}>
                  {entry.name}
                </a>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  )
}
