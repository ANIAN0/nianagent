import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { CatalogDocs } from "./catalog-docs"
import type { CatalogMetadata } from "./catalog"

export function CatalogInspector({
  entry,
  stateId,
  initialTab,
}: {
  entry: CatalogMetadata
  stateId?: string
  initialTab?: "scenario" | "component"
}) {
  const sections = [
    ["输入", entry.inputs],
    ["事件", entry.events],
    ["组成", entry.composition],
    ["使用方", entry.consumers],
  ] as const
  return (
    <Tabs
      defaultValue={initialTab ?? (stateId ? "scenario" : "component")}
      className="catalog-inspector"
    >
      <TabsList aria-label="组件说明" className="catalog-inspector-tabs">
        <TabsTrigger value="scenario">当前场景</TabsTrigger>
        <TabsTrigger value="component">组件文档</TabsTrigger>
      </TabsList>
      <TabsContent value="scenario" className="catalog-inspector-content">
        {stateId ? (
          <CatalogDocs entry={entry} stateId={stateId} />
        ) : (
          <p className="devtools-muted">此项仍在规划中，主区展示设计旅程。</p>
        )}
      </TabsContent>
      <TabsContent value="component" className="catalog-inspector-content">
        <h2>{entry.name}</h2>
        <p>{entry.description || entry.story?.goal}</p>
        <h3>使用位置</h3>
        <p>{entry.pages.join("、") || "共享组件"}</p>
        {entry.props?.length ? (
          <>
            <h3>参数</h3>
            <dl>
              {entry.props.map((prop) => (
                <div key={prop.name}>
                  <dt>
                    <code>{prop.name}</code> · {prop.type}
                  </dt>
                  <dd>
                    {prop.description}
                    {prop.default && `（默认：${prop.default}）`}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
        {sections.map(([name, values]) =>
          values.length ? (
            <section key={name}>
              <h3>{name}</h3>
              <ul>
                {values.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            </section>
          ) : null
        )}
        {entry.standards.length > 0 && (
          <section>
            <h3>设计约定</h3>
            {entry.standards.map((standard) => (
              <details key={standard.id}>
                <summary>{standard.name}</summary>
                <p>{standard.rule}</p>
                <p className="devtools-muted">{standard.reason}</p>
                <p>{standard.check}</p>
              </details>
            ))}
          </section>
        )}
        {entry.boundary && (
          <details>
            <summary>功能边界</summary>
            <p>{entry.boundary}</p>
          </details>
        )}
        <h3>源码</h3>
        <code className="catalog-source-path">{entry.source}</code>
      </TabsContent>
    </Tabs>
  )
}
