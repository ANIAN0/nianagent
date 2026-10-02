import { Button } from "@/components/ui/button"
import { useState } from "react"
import { RotateCcw, ArrowUpRight } from "lucide-react"
import { CatalogPreviewFrame } from "./catalog-preview-frame"
import { catalogUrl, symbolOf, type CatalogEntry } from "./catalog"

export function CatalogOverview({
  entry,
  theme,
  revision,
  onNavigate,
}: {
  entry: CatalogEntry
  theme: string
  revision: number
  onNavigate: (entry: CatalogEntry, state?: string) => void
}) {
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
      {entry.states.map((state) => (
        <section className="catalog-example" key={state.id}>
          <header>
            <div>
              <h2>{state.name}</h2>
              <p>{state.condition}</p>
            </div>
            <div className="catalog-example-actions">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`重置${state.name}`}
                title="重置这个示例"
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
                  href={catalogUrl(entry, state.id)}
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
          <div className="catalog-example-canvas">
            <CatalogPreviewFrame
              key={`${theme}-${revision}-${resets[state.id] ?? 0}`}
              title={`${entry.name} · ${state.name}`}
              src={`./preview.html?${new URLSearchParams({ component: entry.id, state: state.id, theme })}`}
              initialHeight={entry.viewport.height}
            />
          </div>
          <footer>预期：{state.expected}</footer>
        </section>
      ))}
    </div>
  )
}
