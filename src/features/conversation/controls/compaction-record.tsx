import { ChevronDown, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import type { ConversationCompaction } from "@/features/models/model-contract.generated"
export function CompactionRecord({
  record,
  onLocate,
  locateFeedback,
  locateDisabledReason,
}: {
  record: ConversationCompaction
  onLocate?: (entryId: string) => void
  locateFeedback?: string
  locateDisabledReason?: string
}) {
  const savedAt = new Date(record.time)
  const savedTime = Number.isNaN(savedAt.getTime())
    ? "保存时间未提供"
    : savedAt.toLocaleString("zh-CN", {
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
  const estimate =
    Number.isFinite(record.tokensBefore) && record.tokensBefore >= 0
      ? `${record.tokensBefore.toLocaleString()} tokens`
      : "未提供"
  return (
    <Collapsible className="group/collapsible flex flex-col gap-3 py-3">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start"
          aria-label="查看上下文压缩摘要"
        >
          <Marker>
            <MarkerIcon>
              <Layers />
            </MarkerIcon>
            <MarkerContent>
              上下文已压缩 · {record.source === "manual" ? "手动" : "自动"}
            </MarkerContent>
          </Marker>
          <ChevronDown
            data-icon="inline-end"
            className="transition-transform group-data-[state=open]/collapsible:rotate-180 motion-reduce:transition-none"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <div className="flex gap-2">
            <dt>保存于</dt>
            <dd>
              <time
                dateTime={
                  Number.isNaN(savedAt.getTime()) ? undefined : record.time
                }
              >
                {savedTime}
              </time>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt>压缩前估算</dt>
            <dd>{estimate}</dd>
          </div>
          <div className="flex gap-2">
            <dt>压缩后</dt>
            <dd>用量待更新</dd>
          </div>
        </dl>
        <div className="max-h-72 overflow-auto wrap-break-word whitespace-pre-wrap">
          {record.summary || "未提供摘要正文。"}
        </div>
        {onLocate && (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={!!locateDisabledReason}
            onClick={() => onLocate(record.firstKeptEntryId)}
          >
            定位保留起点
          </Button>
        )}
        {(locateFeedback || locateDisabledReason) && (
          <p role="status" className="text-xs text-muted-foreground">
            {locateFeedback || locateDisabledReason}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
