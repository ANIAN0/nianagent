"use client"

import { PanelLeft, Plus, Search, Trash2 } from "lucide-react"
import { Badge } from "@/ui/badge"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import type { SkillSummary } from "./api"

export function SkillSidebar({
  skills,
  selectedId,
  search,
  loading,
  error,
  onRetry,
  onSearch,
  onSelect,
  onClose,
  onCreate,
  onDelete,
}: {
  skills: SkillSummary[]
  selectedId: string
  search: string
  loading: boolean
  error: string
  onRetry: () => void
  onSearch: (value: string) => void
  onSelect: (skillId: string) => void
  onClose: () => void
  onCreate: () => void
  onDelete: (skill: SkillSummary) => void
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col md:w-[280px] border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" aria-label="收起侧栏" onClick={onClose}>
            <PanelLeft />
          </Button>
          <span className="text-[15px] font-semibold tracking-tight">moon</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 px-2.5 text-xs"
          disabled={loading}
          onClick={onCreate}
        >
          <Plus className="size-3.5" />
          新建 Skill
        </Button>
      </div>

      <div className="border-b border-sidebar-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="搜索 Skill…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="p-3 text-xs text-muted-foreground">加载中…</p>
        ) : error ? (
          <div className="flex flex-col items-start gap-2 p-3 text-xs" role="status">
            <p className="min-w-0 break-all text-destructive">列表加载失败 · {error}</p>
            <Button type="button" variant="outline" size="xs" onClick={onRetry}>重试</Button>
          </div>
        ) : skills.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            {search.trim() ? "没有匹配的 Skill。" : "暂无 Skill，点击右上角新建。"}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {skills.map((s) => {
              const active = s.id === selectedId
              return (
                <div
                  key={s.id}
                  className={`group flex items-center gap-2 rounded-lg pr-2.5 transition-colors ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-muted/70"
                  }`}
                >
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(s.id)}
                    className="min-w-0 flex-1 cursor-pointer rounded-lg py-2 pl-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">
                        {s.name}
                      </span>
                      <Badge
                        variant={s.currentVersion > 0 ? "secondary" : "outline"}
                        className="h-4 px-1.5 text-[10px]"
                      >
                        {s.currentVersion > 0 ? `V${s.currentVersion}` : "草稿"}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                      {s.slug}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onDelete(s)}
                    className="opacity-0 text-muted-foreground group-hover:opacity-100 group-focus-within:opacity-100 hover:text-destructive"
                    aria-label={`删除 ${s.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
