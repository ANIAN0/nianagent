import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { CompactionRecord } from "./compaction-record"
export default {
  id: "compaction-record",
  name: "压缩历史记录",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/controls/compaction-record.tsx",
  description: "Pi实际历史中的只读摘要与保留边界。",
  boundary: "不改写摘要、不删除历史、不将估算差值当释放量。",
  inputs: ["record: ConversationCompaction", "onLocate(entryId)"],
  events: ["展开/收起、定位保留起点"],
  composition: ["Marker、Collapsible、Button"],
  consumers: ["ConversationCompactionRecord、LiveConversationView"],
  viewport: { width: 900, height: 480 },
  states: [
    {
      id: "manual",
      name: "手动压缩记录",
      condition: "Pi摘要已保存",
      expected: "展开真实摘要、时间、压缩前估算与保留起点，压缩后占用待更新。",
      render: () => (
        <div className="p-6">
          <CompactionRecord
            record={{
              id: "entry-compact",
              time: "2026-10-03T09:20:00Z",
              source: "manual",
              summary:
                "任务：完善本地工作流。\n已完成：模型连接与真实多轮对话。\n待处理：附件与会话控制。",
              firstKeptEntryId: "entry-kept",
              historyIndex: 20,
              firstKeptHistoryIndex: 16,
              tokensBefore: 53760,
            }}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
