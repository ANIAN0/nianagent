import type { ApiDocument, Schema, SchemaRegistry } from "./components/types"
import { operationUrl, moduleUrl } from "./catalog-data"
import { resolveSchema } from "./components/schema-field-table"
function summary(schema: Schema, registry: SchemaRegistry, depth = 0): string {
  const value = resolveSchema(schema, registry)
  if (value.anyOf) {
    const branches = value.anyOf.map((part) => resolveSchema(part, registry))
    const nullable = branches.some((part) => part.type === "null")
    const objects = branches.filter((part) => part.type !== "null")
    if (
      nullable &&
      objects.some((part) => part.properties || part.type === "array")
    )
      return `（${objects.map((part) => summary(part, registry, depth)).join(" / ")}）；${depth === 0 ? "整个结果" : "该字段"}可为 null`
    return branches.map((part) => summary(part, registry, depth)).join(" | ")
  }
  if (value.properties) {
    const fields = Object.entries(value.properties)
    if (!fields.length)
      return value.additionalProperties === false ? "无参数 {}" : "开放对象"
    return (
      fields
        .slice(0, 6)
        .map(
          ([key, field]) =>
            `${key}${value.required?.includes(key) ? "" : "?"}${depth < 1 ? ": " + summary(field, registry, depth + 1) : ""}`
        )
        .join("、") + (fields.length > 6 ? ` 等 ${fields.length} 字段` : "")
    )
  }
  if (value.type === "array")
    return `数组 · ${value.items ? summary(value.items, registry, depth) : "JSON"}`
  return value.enum?.length
    ? value.enum.map((item) => JSON.stringify(item)).join(" | ")
    : (value.type ?? "JSON")
}
export function ModuleOverview({
  module,
  documents,
  onSelect,
  onModuleSelect,
}: {
  module: string
  documents: Record<string, ApiDocument>
  onSelect: (id: string) => void
  onModuleSelect: (module: string) => void
}) {
  const items = Object.entries(documents).filter(
    ([, doc]) => doc.module === module
  )
  const modules = [
    ...new Set(Object.values(documents).map((doc) => doc.module)),
  ]
  const unique = (key: "responsibility" | "storage" | "source") => [
    ...new Set(items.map(([, doc]) => doc[key])),
  ]
  const go = (
    event: React.MouseEvent<HTMLAnchorElement>,
    action: () => void
  ) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    action()
  }
  return (
    <article className="devtools-document api-module-overview">
      <header>
        <p className="devtools-breadcrumb">
          后端接口 · {Object.keys(documents).length} 个真实注册接口
        </p>
        <h1>{module === "all" ? "全部功能模块" : module}</h1>
        <p>
          {module === "all"
            ? "先选择要了解的功能，再查看它的接口、输入与输出。"
            : unique("responsibility").join(" ")}
        </p>
      </header>
      {module === "all" ? (
        <div className="api-module-list">
          {modules.map((name) => {
            const members = Object.values(documents).filter(
              (doc) => doc.module === name
            )
            return (
              <a
                key={name}
                href={moduleUrl(name)}
                onClick={(event) => go(event, () => onModuleSelect(name))}
              >
                <div>
                  <strong>{name}</strong>
                  <span>{members.length} 个接口 →</span>
                </div>
                <p>
                  {[...new Set(members.map((doc) => doc.responsibility))].join(
                    " "
                  )}
                </p>
              </a>
            )
          })}
        </div>
      ) : (
        <>
          <div className="api-module-list-heading">
            <h2>接口清单 · {items.length}</h2>
            <a
              href={moduleUrl("all")}
              onClick={(event) => go(event, () => onModuleSelect("all"))}
            >
              全部模块
            </a>
          </div>
          <div className="devtools-table-scroll">
            <table className="devtools-table api-module-table">
              <thead>
                <tr>
                  <th>功能</th>
                  <th>直接输入</th>
                  <th>直接输出</th>
                </tr>
              </thead>
              <tbody>
                {items.map(([id, doc]) => (
                  <tr key={id}>
                    <td>
                      <a
                        href={operationUrl(id)}
                        onClick={(event) => go(event, () => onSelect(id))}
                      >
                        {doc.definition.title}
                      </a>
                      <code>{id}</code>
                    </td>
                    <td>{summary(doc.definition.request, doc.schemas)}</td>
                    <td>{summary(doc.definition.response, doc.schemas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>实现位置与数据归属</summary>
            <p>{unique("storage").join("；")}</p>
            {unique("source").map((path) => (
              <p key={path}>
                <code>{path}</code>
              </p>
            ))}
          </details>
        </>
      )}
    </article>
  )
}
