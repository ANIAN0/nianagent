import { Button } from "@/components/ui/button"
import { useState } from "react"
import { RotateCcw, ArrowUpRight, ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { CatalogPreviewFrame } from "./catalog-preview-frame"
import { symbolOf, type CatalogMetadata } from "./catalog"

export function CatalogOverview({
  entry,
  theme,
  revision,
  stateId,
  onInspectState,
  onNavigate,
  hrefFor,
}: {
  entry: CatalogMetadata
  theme: string
  revision: number
  stateId: string
  onInspectState: (stateId: string) => void
  onNavigate: (entry: CatalogMetadata, state?: string) => void
  hrefFor: (entry: CatalogMetadata, state?: string) => string
}) {
  const defaultState = entry.states.some((item) => item.id === stateId)
    ? stateId
    : (entry.states[0]?.id ?? null)
  const [expanded, setExpanded] = useState<{
    value: string | null
    locationState: string
  }>({ value: defaultState, locationState: stateId })
  const openState =
    expanded.locationState === stateId ? expanded.value : defaultState
  const [resets, setResets] = useState<Record<string, number>>({})
  return (
    <div className="catalog-overview">
      <p className="catalog-eyebrow">
        {entry.layer} / {entry.group}
      </p>
      <h1>
        {entry.name} <small>{symbolOf(entry)}</small>
      </h1>
      <p className="catalog-lead">{entry.description}</p>
      <div className="catalog-state-heading">
        <h2>状态与交互</h2>
        <Badge variant="secondary">{entry.states.length} 个状态</Badge>
      </div>
      {entry.states.map((state) => (
        <section
          className="catalog-example"
          key={state.id}
          data-expanded={openState === state.id}
        >
          <header>
            <div className="catalog-example-heading">
              <button
                className="catalog-example-toggle"
                type="button"
                aria-expanded={openState === state.id}
                aria-controls={`catalog-example-${state.id}`}
                onClick={() => {
                  const next = openState === state.id ? null : state.id
                  setExpanded({ value: next, locationState: next ?? stateId })
                  if (next) onInspectState(next)
                }}
              >
                <ChevronDown aria-hidden="true" size={16} />
                <span>{state.name}</span>
              </button>
              <p>{state.condition}</p>
            </div>
            <div className="catalog-example-actions">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`重置${state.name}`}
                title="重置这个示例"
                disabled={openState !== state.id}
                onClick={() =>
                  setResets((old) => ({
                    ...old,
                    [state.id]: (old[state.id] ?? 0) + 1,
                  }))
                }
              >
                <RotateCcw />
              </Button>
              <Button variant="ghost" size="sm" asChild>
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
                  画布 <ArrowUpRight data-icon="inline-end" />
                </a>
              </Button>
            </div>
          </header>
          <div
            hidden={openState !== state.id}
            id={`catalog-example-${state.id}`}
            className="catalog-example-canvas"
          >
            {openState === state.id && (
              <CatalogPreviewFrame
                key={`${theme}-${revision}-${resets[state.id] ?? 0}`}
                title={`${entry.name} · ${state.name}`}
                src={`./preview.html?${new URLSearchParams({ component: entry.id, state: state.id, theme })}`}
                initialHeight={entry.viewport.height}
              />
            )}
          </div>
          <footer>预期：{state.expected}</footer>
        </section>
      ))}
    </div>
  )
}
