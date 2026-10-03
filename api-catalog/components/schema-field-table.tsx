import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Schema, SchemaRegistry } from "./types"

type SchemaRow = {
  id: string
  path: string
  type: string
  required: boolean
  description: string
  constraints: string[]
  depth: number
}

function resolve(schema: Schema, registry: SchemaRegistry): Schema {
  return schema.$ref ? (registry[schema.$ref] ?? schema) : schema
}

function typeLabel(
  schema: Schema,
  registry: SchemaRegistry,
  seen = new Set<string>()
): string {
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return schema.$ref
    const resolved = registry[schema.$ref]
    if (!resolved) return `${schema.$ref}（定义未找到）`
    const next = new Set(seen).add(schema.$ref)
    return resolved.anyOf
      ? `${schema.$ref} · ${typeLabel(resolved, registry, next)}`
      : schema.$ref
  }
  if (schema.anyOf)
    return schema.anyOf
      .map((part) => typeLabel(part, registry, seen))
      .join(" | ")
  if (schema.type === "array")
    return `${schema.items ? typeLabel(schema.items, registry, seen) : "unknown"}[]`
  return schema.type ?? "unknown"
}

function constraints(schema: Schema): string[] {
  return [
    schema.enum
      ? `取值 ${schema.enum.map((value) => JSON.stringify(value)).join(" / ")}`
      : "",
    schema.minimum !== undefined ? `最小值 ${schema.minimum}` : "",
    schema.minLength !== undefined ? `至少 ${schema.minLength} 字符` : "",
    schema.maxLength !== undefined ? `最多 ${schema.maxLength} 字符` : "",
    schema.maxItems !== undefined ? `最多 ${schema.maxItems} 项` : "",
    schema.pattern ? `格式 ${schema.pattern}` : "",
    schema.additionalProperties === false ? "不允许额外字段" : "",
  ].filter(Boolean)
}

export function schemaRows(
  schema: Schema,
  registry: SchemaRegistry
): SchemaRow[] {
  const rows: SchemaRow[] = []
  function walk(
    value: Schema,
    path: string,
    required: boolean,
    refs: Set<string>,
    depth: number,
    id: string
  ) {
    const resolved = resolve(value, registry)
    const circular = !!value.$ref && refs.has(value.$ref)
    const description = [
      value.description,
      value === resolved ? "" : resolved.description,
    ]
      .filter(Boolean)
      .join(" ")
    rows.push({
      id,
      path,
      type: typeLabel(value, registry),
      required,
      description: circular
        ? `${description}${description ? "；" : ""}递归引用，后续结构见 ${value.$ref}`
        : description,
      constraints: constraints(resolved),
      depth,
    })
    if (circular) return
    const nextRefs = value.$ref ? new Set(refs).add(value.$ref) : refs
    if (resolved.anyOf) {
      resolved.anyOf.forEach((part, index) => {
        walk(
          part,
          `${path} · 方案 ${index + 1}`,
          required,
          nextRefs,
          depth + 1,
          `${id}/union/${index}`
        )
      })
    }
    if (resolved.properties) {
      for (const [key, child] of Object.entries(resolved.properties)) {
        walk(
          child,
          path === "$" ? key : `${path}.${key}`,
          !!resolved.required?.includes(key),
          nextRefs,
          depth + 1,
          `${id}/property/${key}`
        )
      }
    }
    if (resolved.items)
      walk(
        resolved.items,
        `${path}[]`,
        true,
        nextRefs,
        depth + 1,
        `${id}/items`
      )
  }
  walk(schema, "$", true, new Set(), 0, "root")
  return rows
}

export function SchemaFieldTable({
  schema,
  schemas,
  label,
}: {
  schema: Schema
  schemas: SchemaRegistry
  label: string
}) {
  const [query, setQuery] = useState("")
  const rows = useMemo(() => schemaRows(schema, schemas), [schema, schemas])
  const filtered = query.trim()
    ? rows.filter((row) =>
        `${row.path} ${row.type} ${row.description} ${row.constraints.join(" ")}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())
      )
    : rows
  return (
    <div className="api-schema-fields">
      <div className="api-schema-toolbar">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={`搜索${label}字段`}
            placeholder="搜索字段或类型"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        <span>
          {filtered.length} / {rows.length} 项
        </span>
      </div>
      <div
        className="api-schema-scroll moon-scrollbar"
        tabIndex={0}
        role="region"
        aria-label={`${label}字段表`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>字段 / 类型</TableHead>
              <TableHead>说明与约束</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="api-schema-name">
                  <code>{row.path}</code>
                  <div>
                    <span>{row.type}</span>
                    {row.path !== "$" && (
                      <span className="api-field-presence">
                        {row.required ? "必填" : "可选"}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="api-schema-description">
                  {row.description && <p>{row.description}</p>}
                  {row.constraints.length ? (
                    <ul>
                      {row.constraints.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    !row.description && (
                      <span className="api-schema-unconstrained">
                        无额外约束
                      </span>
                    )
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={2}>
                  <p className="api-schema-no-results">
                    没有匹配字段，请调整搜索内容。
                  </p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="api-schema-note">
        $ 表示根值；必填针对所属对象。联合类型的各方案分别列出，null
        表示可以返回空值。
      </p>
    </div>
  )
}
