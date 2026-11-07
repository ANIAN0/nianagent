import type { CatalogEntry } from "../../catalog-types.ts"
import { ReadOnlyPatch } from "@/components/read-only-patch"

export default {
  id: "read-only-patch",
  name: "只读差异",
  source: "src/components/read-only-patch.tsx",
  group: "文件工作栏",
  layer: "基础组件",
  order: 181,
  pages: ["会话", "文件工作栏"],
  stage: "content",
  description: "正式会话patch与Git差异共用成熟的只读差异组件。",
  boundary:
    "示例仅传入可公开的差异文字，不读取用户仓库，也不证明Git或工具执行已验收。",
  standards: [
    {
      id: "F1",
      name: "来源与原文",
      rule: "呈现实际传入patch，不补造旧文件全文，不提供写入或回滚。",
      reason: "操作历史与Git现状由各自业务owner负责。",
      check: "核对行号、增删及原patch；不出现保存/回滚入口。",
    },
  ],
  inputs: ["patch: 原unified diff文字"],
  events: ["展示模块加载与渲染故障由PageErrorBoundary承载"],
  composition: ["ReadOnlyPatch / PatchDiff / Suspense / PageErrorBoundary"],
  consumers: ["ChangesViewer", "GitViewer", "ToolCall"],
  states: [
    {
      id: "patch",
      name: "增删与上下文",
      section: "normal",
      condition: "传入完整unified patch。",
      steps: ["查看上下文、删除和新增行。"],
      expected: "只读展示行号和真实差异，原文未改写。",
      render: () => (
        <ReadOnlyPatch
          patch={
            'diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1,3 +1,3 @@\n export const name = "Moon"\n-export const mode = "draft"\n+export const mode = "ready"\n export const visible = true\n'
          }
        />
      ),
    },
  ],
  viewport: { width: 780, height: 420 },
} satisfies CatalogEntry
