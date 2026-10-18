import { StatusMessage } from "@/components/feedback/status-message"
import type { CatalogMetadata } from "./catalog-types"
export function CatalogDocs({
  entry,
  stateId,
}: {
  entry: CatalogMetadata
  stateId?: string
}) {
  const state = entry.states.find((item) => item.id === stateId)
  if (!state) return null
  return (
    <section
      className="catalog-interaction-docs"
      aria-label="当前场景操作与反馈"
    >
      <h2>操作这个场景</h2>
      {state.condition && (
        <p className="devtools-muted">起点：{state.condition}</p>
      )}
      <ol>
        {state.steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      <h3>完成后</h3>
      <p>{state.expected}</p>
      {state.knownIssue && (
        <StatusMessage
          title="当前未完成项"
          message={state.knownIssue}
          role="group"
        />
      )}
    </section>
  )
}
