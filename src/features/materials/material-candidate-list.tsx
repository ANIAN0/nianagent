import type { RefObject } from "react"
import { Check, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type MaterialCandidate = { id: string; group: string; name: string; description: string; icon: LucideIcon; disabled?: boolean; text?: string }
export function MaterialCandidateList({ id, rows, active, listRef, maxHeight, loading, error, diagnostics = [], onRetry, onActive, onSelect }: { id: string; rows: MaterialCandidate[]; active: number; listRef: RefObject<HTMLDivElement | null>; maxHeight: number; loading?: boolean; error?: string; diagnostics?: string[]; onRetry?: () => void; onActive: (index: number) => void; onSelect: (item: MaterialCandidate) => void }) {
  return <div ref={listRef} id={id} role="listbox" aria-label="输入候选" aria-busy={loading} className="moon-scrollbar overflow-y-auto" style={{ maxHeight }}>
    {loading ? <p role="status" className="px-3 py-6 text-center text-xs text-muted-foreground">正在读取资源…</p> : error ? <div role="alert" className="flex flex-col items-center gap-2 p-4 text-xs text-destructive"><p>{error}</p><Button size="sm" variant="outline" onClick={onRetry}>重新读取</Button></div> : rows.map((item, index) => <div key={item.id}>
      {(index === 0 || rows[index - 1]?.group !== item.group) && <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">{item.group}</div>}
      <Button type="button" id={`${id}-${index}`} data-candidate-index={index} role="option" aria-selected={active === index} disabled={item.disabled} tabIndex={-1} variant="ghost" className={cn("h-auto min-h-11 w-full justify-start gap-2 rounded-lg px-3 py-2 font-normal", active === index && "bg-accent/60")} onMouseDown={(event) => event.preventDefault()} onMouseMove={() => { if (!item.disabled) onActive(index) }} onClick={() => onSelect(item)}>
        <item.icon data-icon="inline-start" />
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5"><span className="truncate text-left">{item.name}</span><span className="max-w-full truncate text-xs text-muted-foreground" title={item.description}>{item.description}</span></span>
        {item.disabled && <Check data-icon="inline-end" />}
      </Button>
    </div>)}
    {!loading && !error && !rows.length && <p className="px-3 py-6 text-center text-xs text-muted-foreground">没有匹配的资源</p>}
    {diagnostics.map((item, index) => <p key={index} className="px-3 py-1 text-xs leading-5 text-muted-foreground">{item}</p>)}
  </div>
}
