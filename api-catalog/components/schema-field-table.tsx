import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Schema, SchemaRegistry } from "./types"
export type SchemaRow = {
  id: string
  path: string
  name: string
  type: string
  required: boolean
  kind: "field" | "branch" | "item" | "root"
  nullable: boolean
  description: string
  constraints: string[]
  depth: number
  expandable: boolean
}
export function resolveSchema(
  schema: Schema,
  registry: SchemaRegistry
): Schema {
  const seen = new Set<string>()
  let value = schema
  while (value.$ref && registry[value.$ref] && !seen.has(value.$ref)) {
    seen.add(value.$ref)
    value = registry[value.$ref]!
  }
  return value
}
function typeLabel(
  schema: Schema,
  registry: SchemaRegistry,
  seen = new Set<string>()
): string {
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return schema.$ref
    const resolved = registry[schema.$ref]
    return resolved?.anyOf
      ? `${schema.$ref} · ${typeLabel(resolved, registry, new Set(seen).add(schema.$ref))}`
      : schema.$ref
  }
  if (schema.anyOf)
    return schema.anyOf
      .map((part) => typeLabel(part, registry, seen))
      .join(" | ")
  if (schema.type === "array")
    return `${schema.items ? typeLabel(schema.items, registry, seen) : "JSON"}[]`
  return schema.type ?? "JSON"
}
export function schemaConstraints(
  schema: Schema,
  documentationOnly = false
): string[] {
  return [
    schema.enum
      ? `取值 ${schema.enum.map((value) => JSON.stringify(value)).join(" / ")}`
      : "",
    schema.minimum !== undefined ? `最小值 ${schema.minimum}` : "",
    schema.maximum !== undefined ? `最大值 ${schema.maximum}` : "",
    schema.default !== undefined
      ? `省略时 ${JSON.stringify(schema.default)}`
      : "",
    schema.minLength !== undefined ? `至少 ${schema.minLength} 字符` : "",
    schema.maxLength !== undefined ? `最多 ${schema.maxLength} 字符` : "",
    schema.maxItems !== undefined ? `最多 ${schema.maxItems} 项` : "",
    schema.pattern ? `格式 ${schema.pattern}` : "",
    schema.type === "object" || schema.properties
      ? schema.additionalProperties === false
        ? documentationOnly
          ? "文档列出已知字段；运行时 output 不据此收紧"
          : "不允许额外字段"
        : "允许额外字段"
      : "",
  ].filter(Boolean)
}
function nullableScalar(schema: Schema, registry: SchemaRegistry) {
  if (schema.anyOf?.length !== 2) return false
  const parts = schema.anyOf.map((part) => resolveSchema(part, registry))
  return (
    parts.some((part) => part.type === "null") &&
    parts.every(
      (part) =>
        ["string", "number", "integer", "boolean", "null"].includes(
          part.type ?? ""
        ) &&
        !part.anyOf &&
        !part.properties &&
        !part.items
    )
  )
}
export function schemaRows(
  schema: Schema,
  registry: SchemaRegistry,
  documentationOnly = false
): SchemaRow[] {
  const rows: SchemaRow[] = []
  function children(
    value: Schema,
    path: string,
    refs: Set<string>,
    depth: number,
    id: string
  ) {
    if (value.anyOf && !nullableScalar(value, registry))
      value.anyOf.forEach((part, index) =>
        walk(
          part,
          `${path} · 方案 ${index + 1}`,
          `方案 ${index + 1}`,
          false,
          refs,
          depth,
          `${id}/union/${index}`,
          "branch"
        )
      )
    for (const [key, child] of Object.entries(value.properties ?? {}))
      walk(
        child,
        path === "$" ? key : `${path}.${key}`,
        key,
        !!value.required?.includes(key),
        refs,
        depth,
        `${id}/property/${key}`
      )
    if (value.items) {
      const item = resolveSchema(value.items, registry)
      if (item.properties && !item.anyOf && !refs.has(value.items.$ref ?? "")) {
        const next = value.items.$ref
          ? new Set(refs).add(value.items.$ref)
          : refs
        for (const [key, child] of Object.entries(item.properties))
          walk(
            child,
            `${path}[].${key}`,
            key,
            !!item.required?.includes(key),
            next,
            depth,
            `${id}/items/property/${key}`
          )
      } else
        walk(
          value.items,
          `${path}[]`,
          "数组条目",
          true,
          refs,
          depth,
          `${id}/items`,
          "item"
        )
    }
  }
  function walk(
    value: Schema,
    path: string,
    name: string,
    required: boolean,
    refs: Set<string>,
    depth: number,
    id: string,
    kind: SchemaRow["kind"] = "field"
  ) {
    const resolved = resolveSchema(value, registry)
    const circular = !!value.$ref && refs.has(value.$ref)
    const item = resolved.items
      ? resolveSchema(resolved.items, registry)
      : undefined
    const description = [
      value.description,
      value === resolved ? "" : resolved.description,
      circular ? `递归引用：${value.$ref}` : "",
    ]
      .filter(Boolean)
      .join("；")
    const rules = schemaConstraints(resolved, documentationOnly)
    const scalar = nullableScalar(resolved, registry)
    if (scalar)
      for (const branch of resolved.anyOf!) {
        const part = resolveSchema(branch, registry)
        rules.push(
          ...schemaConstraints(part, documentationOnly).map(
            (rule) => `${part.type}：${rule}`
          )
        )
        if (part.description && !description.includes(part.description))
          rules.push(`${part.type}：${part.description}`)
      }
    if (item?.properties && !item.anyOf) {
      if (item.description) rules.push(`每项：${item.description}`)
      rules.push(
        ...schemaConstraints(item, documentationOnly).map(
          (rule) => `每项${rule}`
        )
      )
    }
    rows.push({
      id,
      path,
      name,
      type: typeLabel(value, registry),
      required,
      kind,
      nullable: !!resolved.anyOf?.some(
        (part) => resolveSchema(part, registry).type === "null"
      ),
      description,
      constraints: rules,
      depth,
      expandable:
        !circular &&
        !!(
          (!scalar && resolved.anyOf?.length) ||
          Object.keys(resolved.properties ?? {}).length ||
          resolved.items
        ),
    })
    if (!circular)
      children(
        resolved,
        path,
        value.$ref ? new Set(refs).add(value.$ref) : refs,
        depth + 1,
        id
      )
  }
  const root = resolveSchema(schema, registry)
  if (root.properties && !root.anyOf)
    children(
      root,
      "$",
      schema.$ref ? new Set([schema.$ref]) : new Set(),
      0,
      "root"
    )
  else walk(schema, "$", "根值", true, new Set(), 0, "root", "root")
  return rows
}
export function SchemaFieldTable({
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
  const rows = useMemo(
    () => schemaRows(schema, schemas, documentationOnly),
    [schema, schemas, documentationOnly]
  )
  const [query, setQuery] = useState(() => {
    const params = new URLSearchParams(location.search)
    const kind = label === "入参" ? "request" : "response"
    return params.get("fieldKind") === kind ? (params.get("field") ?? "") : ""
  })
  const [expanded, setExpanded] = useState(
    () =>
      new Set(
        rows
          .filter((row) => row.expandable && row.depth < 2)
          .map((row) => row.id)
      )
  )
  const normalized = query.trim().toLocaleLowerCase()
  const hit = rows.filter((row) =>
    `${row.path} ${row.type} ${row.description} ${row.constraints.join(" ")}`
      .toLocaleLowerCase()
      .includes(normalized)
  )
  const filtered = normalized
    ? rows.filter((row) =>
        hit.some(
          (found) => row.id === found.id || found.id.startsWith(row.id + "/")
        )
      )
    : rows.filter((row) =>
        rows
          .filter(
            (parent) => parent.expandable && row.id.startsWith(parent.id + "/")
          )
          .every((parent) => expanded.has(parent.id))
      )
  const root = resolveSchema(schema, schemas)
  const rootFacts =
    root.properties && !root.anyOf
      ? [
          schema === root ? "" : schema.description,
          root.description,
          ...schemaConstraints(root, documentationOnly),
        ].filter(Boolean)
      : []
  return (
    <div className="api-schema-fields">
      {!!rootFacts.length && (
        <p className="api-schema-root">{rootFacts.join("；")}</p>
      )}
      <div className="api-schema-toolbar">
        <Input
          aria-label={`搜索${label}字段`}
          placeholder="搜索字段或说明"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            setExpanded(
              new Set(rows.filter((row) => row.expandable).map((row) => row.id))
            )
          }
        >
          展开全部
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setExpanded(new Set())}
        >
          收起
        </Button>
        <span>{filtered.length} 项</span>
      </div>
      <div
        className="api-schema-scroll moon-scrollbar"
        role="region"
        aria-label={`${label}字段表`}
        tabIndex={0}
      >
        <table className="api-field-table">
          <thead>
            <tr>
              <th>字段与类型</th>
              <th>含义与约束</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                data-field-match={
                  normalized && hit.some((found) => found.id === row.id)
                    ? true
                    : undefined
                }
              >
                <td>
                  <p className="api-field-rule">
                    默认值：
                    {resolveSchema(schema, schemas).default !== undefined &&
                    row.kind === "root"
                      ? JSON.stringify(resolveSchema(schema, schemas).default)
                      : row.constraints.some((rule) =>
                            rule.startsWith("省略时")
                          )
                        ? "见下方约束"
                        : "未声明"}
                  </p>
                  <div
                    className="api-field-identity"
                    style={{ paddingLeft: Math.min(row.depth, 5) * 14 }}
                  >
                    {row.expandable ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${expanded.has(row.id) ? "收起" : "展开"}${row.path}`}
                        aria-expanded={!!normalized || expanded.has(row.id)}
                        onClick={() =>
                          setExpanded((previous) => {
                            const next = new Set(previous)
                            if (next.has(row.id)) next.delete(row.id)
                            else next.add(row.id)
                            return next
                          })
                        }
                      >
                        {expanded.has(row.id) ? "−" : "+"}
                      </Button>
                    ) : (
                      <span className="api-field-indent" />
                    )}
                    <div>
                      <code title={row.path}>{row.name}</code>
                      {row.path !== row.name && row.path !== "$" && (
                        <small className="api-field-path">{row.path}</small>
                      )}
                      <div className="api-field-type">
                        {row.type}
                        {row.kind === "field" && (
                          <span>
                            {row.required
                              ? label === "入参"
                                ? "必填"
                                : "必有"
                              : "可选"}
                          </span>
                        )}
                        {row.kind === "branch" && <span>备选分支</span>}
                        {row.nullable && <span>可空</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  {row.description && <p>{row.description}</p>}
                  {row.constraints.map((rule, index) => (
                    <p className="api-field-rule" key={index}>
                      {rule}
                    </p>
                  ))}
                  {!row.description && !row.constraints.length && (
                    <span className="devtools-muted">无额外约束</span>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={2}>
                  没有匹配字段。
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setQuery("")}
                  >
                    清除搜索
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
