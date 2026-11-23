"use client"

import { GitCompare, History } from "lucide-react"
import { Badge } from "@/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select"
import type { BlockLineage, SkillDetail, VersionCompare } from "./api"

const diffStatusMeta: Record<
  VersionCompare["diffs"][number]["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  added: { label: "新增", variant: "default" },
  removed: { label: "删除", variant: "destructive" },
  modified: { label: "修改", variant: "secondary" },
  moved: { label: "移动", variant: "outline" },
  modified_and_moved: { label: "修改并移动", variant: "secondary" },
  unchanged: { label: "未变更", variant: "outline" },
}

const actionLabel: Record<string, string> = {
  create_skill: "创建 Skill",
  update_skill: "更新元数据",
  add_block: "新增段落",
  update_block: "修改段落",
  delete_block: "删除段落",
  reorder_blocks: "调整顺序",
  upsert_asset: "更新附属文件",
  delete_asset: "删除附属文件",
  publish_version: "发布版本",
}

const formatTime = (iso?: string) => {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("zh-CN", { hour12: false })
}

export function LineageTab({
  detail,
  fromVer,
  toVer,
  compareData,
  lineage,
  onFromVerChange,
  onToVerChange,
  onOpenLineage,
}: {
  detail: SkillDetail
  fromVer: number
  toVer: number
  compareData: VersionCompare | null
  lineage: BlockLineage | null
  onFromVerChange: (v: number) => void
  onToVerChange: (v: number) => void
  onOpenLineage: (blockId: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <section className="flex-1 overflow-y-auto p-5 lg:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          <GitCompare className="size-4 text-primary" />
          <span className="text-xs font-medium text-foreground">版本对比</span>
          <Select
            value={String(fromVer)}
            onValueChange={(v) => onFromVerChange(Number(v))}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">当前草稿</SelectItem>
              {detail.versions.map((v) => (
                <SelectItem key={v.id} value={String(v.versionNumber)}>
                  V{v.versionNumber} · {v.summary}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">→</span>
          <Select
            value={String(toVer)}
            onValueChange={(v) => onToVerChange(Number(v))}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">当前草稿</SelectItem>
              {detail.versions.map((v) => (
                <SelectItem key={v.id} value={String(v.versionNumber)}>
                  V{v.versionNumber} · {v.summary}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {compareData && (
          <div className="space-y-3">
            {compareData.diffs.map((item) => {
              const targetBlk = item.to || item.from
              const meta = diffStatusMeta[item.status]
              return (
                <div
                  key={item.blockId}
                  onClick={() => onOpenLineage(item.blockId)}
                  className="cursor-pointer rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant={meta.variant} className="h-5 text-[10px]">
                        {meta.label}
                      </Badge>
                      {targetBlk?.heading && (
                        <span className="truncate text-xs font-semibold text-foreground">
                          {targetBlk.heading}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] text-primary">
                      查看溯源 →
                    </span>
                  </div>
                  {item.from && item.to && item.from.content !== item.to.content ? (
                    <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                      <pre className="whitespace-pre-wrap rounded-lg border border-destructive/25 bg-destructive/10 p-2.5 font-mono text-foreground">
                        - {item.from.content}
                      </pre>
                      <pre className="whitespace-pre-wrap rounded-lg border border-status-success/25 bg-status-success/10 p-2.5 font-mono text-foreground">
                        + {item.to.content}
                      </pre>
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-mono text-xs text-foreground/85">
                      {targetBlk?.content}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 右侧：段落生命周期时间轴 */}
      <aside className="flex w-full shrink-0 flex-col border-t border-border bg-card p-5 lg:w-[400px] lg:border-t-0 lg:border-l xl:w-[440px]">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="size-4 text-primary" />
          段落溯源时间轴
        </h3>
        {!lineage ? (
          <div className="text-xs leading-relaxed text-muted-foreground">
            在左侧点击任意段落卡片，查看该段落的加入时间与每次修改原因。
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="mb-3 rounded-lg border border-border bg-muted/50 p-3 text-xs">
              <div className="font-mono text-muted-foreground">
                {lineage.blockId}
              </div>
              <div className="mt-1 text-foreground">
                加入于 {formatTime(lineage.createdAt)} · 共修改{" "}
                {lineage.editCount} 次{lineage.deleted ? " · 已删除" : ""}
              </div>
            </div>
            <div className="space-y-3 border-l-2 border-primary/30 pl-4">
              {lineage.revisions.map((rev) => (
                <div
                  key={rev.id}
                  className="rounded-lg border border-border bg-card p-3 text-xs"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-semibold text-primary">
                      {actionLabel[rev.action] || rev.action}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {rev.versionNumber > 0 ? `V${rev.versionNumber}` : "草稿"}
                    </span>
                  </div>
                  <div className="mb-1.5 rounded bg-muted px-2 py-1 text-foreground">
                    {rev.reason}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {rev.actor} · {formatTime(rev.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
