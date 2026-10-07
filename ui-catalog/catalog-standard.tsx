import { ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { CatalogMetadata } from "./catalog"
import { storySectionName, type StorySection } from "./catalog-sections"

export function CatalogStandard({
  entry,
  section,
  onNavigate,
  hrefFor,
}: {
  entry: CatalogMetadata
  section?: StorySection
  onNavigate: (entry: CatalogMetadata, state?: string) => void
  hrefFor: (entry: CatalogMetadata, state?: string) => string
}) {
  return (
    <article className="catalog-standard" aria-label="组件设计标准">
      {entry.story && (
        <section className="catalog-story-intro">
          <h2>用户目标</h2>
          <p>{entry.story.goal}</p>
          <h3>前置条件</h3>
          <ul>
            {entry.story.preconditions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h3>完成结果</h3>
          <p>{entry.story.result}</p>
        </section>
      )}
      <section className="catalog-standard-intro">
        <h2>设计标准</h2>
        <p>
          标准来自已确认的需求和设计约定。每条都说明为什么存在，以及怎样判断符合要求。
        </p>
      </section>
      {entry.standards.map((standard) => (
        <section className="catalog-rule" key={standard.id}>
          <h3>
            <span>{standard.id}</span>
            {standard.name}
          </h3>
          <p>{standard.rule}</p>
          <dl>
            <div>
              <dt>理由</dt>
              <dd>{standard.reason}</dd>
            </div>
            <div>
              <dt>检查</dt>
              <dd>{standard.check}</dd>
            </div>
          </dl>
        </section>
      ))}
      <section className="catalog-state-list">
        <h2>{section ? storySectionName(section) : "交互示例"}</h2>
        <p>打开正式组件，按契约中的步骤核验。载入成功不代表验收通过。</p>
        {entry.states
          .filter((state) => !section || state.section === section)
          .map((state) => (
            <section className="catalog-state-example" key={state.id}>
              <div className="catalog-state-row">
                <div>
                  <h3>{state.name}</h3>
                  <p>{state.condition}</p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={hrefFor(entry, state.id)}
                    onClick={(event) => {
                      if (
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return
                      event.preventDefault()
                      onNavigate(entry, state.id)
                    }}
                  >
                    打开预览
                    <ArrowUpRight data-icon="inline-end" />
                  </a>
                </Button>
              </div>
              <ol>
                {state.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p>
                <strong>通过条件：</strong>
                {state.expected}
              </p>
              {state.knownIssue && (
                <Alert variant="destructive">
                  <AlertTitle>当前差异</AlertTitle>
                  <AlertDescription>{state.knownIssue}</AlertDescription>
                </Alert>
              )}
            </section>
          ))}
      </section>
    </article>
  )
}
