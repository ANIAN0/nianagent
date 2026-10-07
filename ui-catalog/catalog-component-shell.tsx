import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import type { CatalogMetadata } from "./catalog"
import { storySectionName, type StorySection } from "./catalog-sections"

export function CatalogComponentShell({
  entry,
  section,
}: {
  entry: CatalogMetadata
  section?: StorySection
}) {
  const journeys =
    entry.story?.journeys?.filter(
      (journey) => !section || journey.section === section
    ) ?? []
  if (entry.story)
    return (
      <article
        className="catalog-standard catalog-journey-plan"
        aria-label="用户故事与规划旅程"
      >
        <p className="catalog-eyebrow">结构梳理 · 待逐项设计与验收</p>
        <section className="catalog-story-intro">
          <h2>用户目标</h2>
          <p>{entry.story.goal}</p>
          <h3>前置条件</h3>
          <ul>
            {entry.story.preconditions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h3>目标结果</h3>
          <p>{entry.story.result}</p>
        </section>
        <section>
          <h2>{section ? storySectionName(section) : "用户旅程"}</h2>
          <p className="catalog-footnote">
            这些旅程用于后续逐项完善，不是已通过的行为标准或可操作演示。
          </p>
          {journeys.map((journey) => (
            <section
              className="catalog-rule"
              key={`${journey.section}:${journey.name}`}
            >
              <h3>{journey.name}</h3>
              <p>
                <strong>起点：</strong>
                {journey.start}
              </p>
              <ol className="catalog-journey-steps">
                {journey.steps.map((step, index) => (
                  <li key={index}>
                    <p>
                      <strong>操作：</strong>
                      {step.action}
                    </p>
                    <p>
                      <strong>反馈或恢复：</strong>
                      {step.feedback}
                    </p>
                  </li>
                ))}
              </ol>
              <p>
                <strong>结束：</strong>
                {journey.end}
              </p>
            </section>
          ))}
          {!journeys.length && <p>当前栏目旅程待后续梳理。</p>}
        </section>
        <section>
          <h2>组件组合映射</h2>
          <p className="catalog-footnote">
            以下是后续完善所涉及的正式组件位置，不表示已完成组合验收。
          </p>
          <ul className="catalog-planning-components">
            {entry.composition.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </article>
    )
  return (
    <div className="catalog-component-shell" aria-label="组件空壳">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {section ? `${storySectionName(section)}待填充` : "内容待填充"}
          </EmptyTitle>
          <EmptyDescription>
            目录与组件结构确认后，再补充标准、状态和交互。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
