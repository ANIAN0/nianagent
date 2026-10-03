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
}: {
  record: ConversationCompaction
  onLocate?: (entryId: string) => void
}) {
  return (
    <Collapsible className="flex flex-col gap-3 py-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-start">
          <Marker>
            <MarkerIcon>
              <Layers />
            </MarkerIcon>
            <MarkerContent>
              上下文已压缩 · {record.source === "manual" ? "手动" : "自动"}
            </MarkerContent>
          </Marker>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
        <p className="text-muted-foreground">
          压缩前估算 {record.tokensBefore.toLocaleString()} tokens ·
          压缩后占用待更新
        </p>
        <div className="max-h-72 overflow-auto wrap-break-word whitespace-pre-wrap">
          {record.summary}
        </div>
        <p className="text-xs text-muted-foreground">
          保存于 {new Date(record.time).toLocaleString("zh-CN")} · 保留起点{" "}
          {record.firstKeptEntryId}
        </p>
        {onLocate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onLocate(record.firstKeptEntryId)}
          >
            定位保留起点
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
