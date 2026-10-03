import type { ReactNode } from "react"
import "../catalog.css"

export function CatalogPreview({ children }: { children: ReactNode }) {
  return <div className="api-catalog-preview moon-scrollbar">{children}</div>
}
