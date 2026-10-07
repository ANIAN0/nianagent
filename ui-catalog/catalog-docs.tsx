import { ArrowUpRight } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { CatalogSource } from "./catalog-source"
import {
  consumersOf,
  dependenciesOf,
  symbolOf,
  type CatalogMetadata,
} from "./catalog"
import { storySectionName, type StorySection } from "./catalog-sections"

export function CatalogDocs({
  entry,
  stateId,
  section,
  onNavigate,
  hrefFor,
}: {
  entry: CatalogMetadata
  stateId?: string
  section?: StorySection
  onNavigate: (entry: CatalogMetadata, state?: string) => void
  hrefFor: (entry: CatalogMetadata, state?: string) => string
}) {
  const state = entry.states.find((item) => item.id === stateId)
  if (entry.stage === "structure")
    return (
      <aside className="catalog-scroll catalog-docs" aria-label="组件结构信息">
        <p className="catalog-eyebrow">结构信息</p>
        <h2>{entry.name}</h2>
        <dl className="catalog-structure-info">
          <div>
            <dt>层级</dt>
            <dd>{entry.layer}</dd>
          </div>
          <div>
            <dt>关联页面</dt>
            <dd>{entry.pages.join("、")}</dd>
          </div>
          <div>
            <dt>{section ? "用户故事" : "功能分组"}</dt>
            <dd>{entry.group}</dd>
          </div>
          {section && (
            <div>
              <dt>当前栏目</dt>
              <dd>{storySectionName(section)}</dd>
            </div>
          )}
          <div>
            <dt>当前阶段</dt>
            <dd>组件空壳</dd>
          </div>
        </dl>
      </aside>
    )
  return (
    <aside className="catalog-scroll catalog-docs" aria-label="实现契约">
      <p className="catalog-eyebrow">实现契约</p>
      <h2>{entry.name}</h2>
      <code className="catalog-docs-symbol">{symbolOf(entry)}</code>
      <section>
        <h3>职责与边界</h3>
        <p>{entry.boundary}</p>
      </section>
      {state && (
        <section className="catalog-docs-state">
          <h3>核验 · {state.name}</h3>
          <p>{state.condition}</p>
          <ol>
            {state.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <h4>通过条件</h4>
          <p>{state.expected}</p>
          {state.knownIssue ? (
            <Alert variant="destructive">
              <AlertTitle>未通过</AlertTitle>
              <AlertDescription>{state.knownIssue}</AlertDescription>
            </Alert>
          ) : null}
        </section>
      )}
      <section>
        <h3>输入约束</h3>
        <ul>
          {entry.inputs.map((input) => (
            <li key={input}>{input}</li>
          ))}
        </ul>
      </section>
      {entry.props?.length ? (
        <section>
          <h3>参数</h3>
          <dl className="catalog-props">
            {entry.props.map((prop) => (
              <div key={prop.name}>
                <dt>
                  <code>{prop.name}</code> · {prop.type}
                </dt>
                <dd>
                  {prop.description}；默认：{prop.default}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <section>
        <h3>事件与数据归属</h3>
        <ul>
          {entry.events.map((event) => (
            <li key={event}>{event}</li>
          ))}
        </ul>
      </section>
      {(
        [
          ["组成组件", dependenciesOf(entry)],
          ["使用方", consumersOf(entry)],
        ] as const
      ).map(([label, related]) => (
        <section key={label}>
          <h3>{label}</h3>
          <div className="catalog-relations">
            {related.map((item) => (
              <a
                key={item.id}
                href={hrefFor(item)}
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
                <span>
                  {item.name}
                  <small>{symbolOf(item)}</small>
                </span>
                <ArrowUpRight aria-hidden="true" size={14} />
              </a>
            ))}
          </div>
          {!related.length && (
            <p>
              {(label === "组成组件"
                ? entry.composition
                : entry.consumers
              ).join("；")}
            </p>
          )}
        </section>
      ))}
      <CatalogSource key={entry.id} entry={entry} />
      <p className="catalog-footnote">
        组成链接由正式源码导入关系生成。类型以源码为准，设计预期以本项标准为准。
      </p>
    </aside>
  )
}
