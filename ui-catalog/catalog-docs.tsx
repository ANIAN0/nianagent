import { ChevronRight } from "lucide-react"
import {
  catalogUrl,
  consumersOf,
  dependenciesOf,
  sourceOf,
  symbolOf,
  type CatalogEntry,
} from "./catalog"

export function CatalogDocs({
  entry,
  stateId,
  onNavigate,
}: {
  entry: CatalogEntry
  stateId?: string
  onNavigate: (entry: CatalogEntry, state?: string) => void
}) {
  const state = entry.states.find((candidate) => candidate.id === stateId)
  return (
    <aside className="catalog-scroll catalog-docs" aria-label="组件文档">
      <p className="catalog-eyebrow">组件契约</p>
      <h2>{symbolOf(entry)}</h2>
      <p>{entry.description}</p>
      <h3>使用边界</h3>
      <p>{entry.boundary}</p>
      {state && (
        <section>
          <h3>当前状态 · {state.name}</h3>
          <p>条件：{state.condition}</p>
          <p>预期：{state.expected}</p>
        </section>
      )}
      <h3>参数与事件</h3>
      {entry.props ? (
        <div className="catalog-table-scroll">
          <table>
            <thead>
              <tr>
                <th>名称 / 类型</th>
                <th>默认 / 约束</th>
              </tr>
            </thead>
            <tbody>
              {entry.props.map((prop) => (
                <tr key={prop.name}>
                  <td>
                    <code>{prop.name}</code>
                    <small>{prop.type}</small>
                  </td>
                  <td>
                    {prop.default}
                    <small>{prop.description}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul>
          {entry.inputs.map((input) => (
            <li key={input}>{input}</li>
          ))}
        </ul>
      )}
      <ul>
        {entry.events.map((event) => (
          <li key={event}>{event}</li>
        ))}
      </ul>
      {(
        [
          ["直接组成", dependenciesOf(entry)],
          ["直接使用方", consumersOf(entry)],
        ] as const
      ).map(([label, related]) => (
        <section key={label}>
          <h3>{label}</h3>
          <div className="catalog-relations">
            {related.map((item) => (
              <a
                key={item.id}
                href={catalogUrl(item)}
                onClick={(event) => {
                  if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return
                  event.preventDefault()
                  onNavigate(item)
                }}
              >
                {item.name}
                <small>{symbolOf(item)}</small>
              </a>
            ))}
          </div>
          {!related.length && (
            <p>
              {label === "直接组成"
                ? "基础实现；交互原语由 Radix / HTML 提供。"
                : entry.consumers.join("；")}
            </p>
          )}
        </section>
      ))}
      <h3>源码</h3>
      <code className="catalog-source-path">{entry.source}</code>
      <details className="catalog-source">
        <summary>
          <ChevronRight aria-hidden="true" size={14} />
          查看正式实现
        </summary>
        <pre>
          <code>{sourceOf(entry)}</code>
        </pre>
      </details>
      <p className="catalog-footnote">
        组成关系从正式源码的直接导入生成。类型与完整 API 以源码为准。
      </p>
    </aside>
  )
}
