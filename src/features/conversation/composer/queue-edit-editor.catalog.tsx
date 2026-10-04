import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { homeData } from "../../../../ui-catalog/fixtures/home"
import type { HomeDraft } from "@/features/home/home-types"
import { MaterialServiceContext } from "@/features/materials/material-service"
import {
  exampleMaterials,
  exampleMaterialService,
} from "@/features/materials/material-catalog-fixtures"
import { QueueEditEditor } from "./queue-edit-editor"
function Example({
  failed = false,
  pending = false,
}: {
  failed?: boolean
  pending?: boolean
}) {
  const [draft, setDraft] = useState<HomeDraft>({
    workspaceId: homeData.workspaces[0].id,
    text: "补充检查生成的文件",
    model: homeData.models[0],
    thinking: "中等",
    session: { toolIds: [], instructionScope: "all" },
    materials: [
      {
        ...exampleMaterials[0],
        ...(failed
          ? { status: "failed", error: "请重新选择来源。", retryable: false }
          : {}),
      },
    ],
  })
  const [notice, setNotice] = useState("")
  const [service] = useState(() => ({
    ...exampleMaterialService,
    restore: async (
      ...args: Parameters<typeof exampleMaterialService.restore>
    ) =>
      failed
        ? args[2].map((material) => ({
            ...material,
            type: material.type ?? ("file" as const),
            source: material.source ?? "",
            status: "failed" as const,
            error: "请重新选择来源。",
            retryable: false,
          }))
        : exampleMaterialService.restore(...args),
  }))
  return (
    <MaterialServiceContext.Provider value={service}>
      <div className="p-4">
        <QueueEditEditor
          draft={draft}
          sessionId="catalog-edit"
          cwd="H:/工作区/moon"
          disabled={pending}
          pending={pending}
          onChange={setDraft}
          onSave={() => setNotice("提交完整文字与材料（展示）")}
          onCancel={() => setNotice("取消编辑（展示）")}
        />
        <p role="status">{notice}</p>
      </div>
    </MaterialServiceContext.Provider>
  )
}
export default {
  id: "queue-edit-editor",
  name: "排队消息编辑器",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/queue-edit-editor.tsx",
  description: "完整草稿的文字与材料编辑。",
  boundary:
    "parent/store持有原revision与提交副本；编辑器使用相同正式材料准备、选择、预览和键图。展示服务隔离。",
  inputs: ["完整draft、sessionId、cwd、disabled、pending、departed。"],
  events: ["onChange完整草稿；onSave/onCancel；onRecover文字与材料一起恢复。"],
  composition: [
    "ComposerInputCard",
    "MaterialPicker",
    "SelectedMaterials",
    "OperationFeedback",
  ],
  consumers: ["QueueDock"],
  viewport: { width: 760, height: 400 },
  states: [
    {
      id: "ready",
      name: "完整编辑",
      condition: "有文字和文件引用。",
      expected: "文字、材料可编辑和预览，保存按完整Draft通知父级。",
      render: () => <Example />,
    },
    {
      id: "failed-material",
      name: "材料来源失效",
      condition: "准备记录失败且不能自动重试。",
      expected: "材料可移除并通过相同＋重新添加，准备前保存禁用。",
      render: () => <Example failed />,
    },
    {
      id: "pending",
      name: "原编辑等待确认",
      condition: "请求结果未知。",
      expected: "编辑与材料选择禁用，完整草稿保留；核对动作由QueueDock持有。",
      render: () => <Example pending />,
    },
  ],
} satisfies CatalogEntry
