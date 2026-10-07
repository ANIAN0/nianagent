import { ArrowUpRight } from "lucide-react"
import { StatusMessage } from "@/components/feedback/status-message"
import { CatalogSource } from "./catalog-source"
import {
  consumersOf,
  dependenciesOf,
  associatedPagesOf,
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
            <dd>{associatedPagesOf(entry).join("、")}</dd>
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
            <dd>结构梳理 · 待逐项设计与验收</dd>
          </div>
        </dl>
        <section>
          <h3>组件组合映射</h3>
          <p>这些正式组件承载本故事的后续完善，不表示已完成设计或组合验收。</p>
          <ul>
            {entry.composition.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        {(
          [
            ["已识别的导入依赖", dependenciesOf(entry)],
            ["已识别的使用方", consumersOf(entry)],
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
            {!related.length && <p>当前登记关系中未识别到此项。</p>}
          </section>
        ))}
        <section>
          <h3>正式使用方映射</h3>
          <ul>
            {entry.consumers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <CatalogSource key={entry.id} entry={entry} />
        <p className="catalog-footnote">
          导入链接只覆盖已登记并被源码扫描识别的关系，不代表完整组件树。规划旅程在中间区域阅读。
        </p>
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
            <StatusMessage
              title="未通过"
              message={state.knownIssue}
              role="group"
            />
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
      {entry.composition.length > 0 && (
        <section>
          <h3>正式组件组合映射</h3>
          <ul>
            {entry.composition.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {entry.consumers.length > 0 && (
        <section>
          <h3>正式使用方映射</h3>
          <ul>
            {entry.consumers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {(
        [
          ["已识别的导入依赖", dependenciesOf(entry)],
          ["已识别的使用方", consumersOf(entry)],
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
          {!related.length && <p>当前登记关系中未识别到此项。</p>}
        </section>
      ))}
      <CatalogSource key={entry.id} entry={entry} />
      <p className="catalog-footnote">
        正式映射来自本项登记；导入链接仅覆盖已登记且被源码扫描识别的关系，不代表完整组件树。类型以源码为准，设计预期以本项标准为准。
      </p>
    </aside>
  )
}
