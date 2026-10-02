import { useState } from "react"
import { Button } from "@/components/ui/button"
import { SettingsConfirmDialog } from "./settings-confirmation"
function Example({ error = false }: { error?: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>打开确认</Button>
      <SettingsConfirmDialog
        value={
          open
            ? {
                title: "删除连接？",
                description: "已有会话保持原模型选择。",
                label: "删除连接",
                destructive: true,
                action: () => {},
              }
            : undefined
        }
        error={error ? "模拟服务暂时不可用，请重试。" : undefined}
        onCancel={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
      />
    </div>
  )
}
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "settings-confirmation",
  name: "设置确认弹窗",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/settings-confirmation.tsx",
  description: "删除与弃改确认，等待时禁用关闭，失败保留可重试。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: ["value", "busy", "error"],
  events: ["onConfirm", "onCancel"],
  composition: ["Dialog", "Button"],
  consumers: ["ConnectionEditor", "ModelEditor", "ModelSettingsPage"],
  viewport: { width: 700, height: 400 },
  states: [
    {
      id: "default",
      name: "删除确认",
      condition: "删除操作",
      expected: "取消不修改数据",
      render: () => <Example />,
    },
    {
      id: "error",
      name: "删除失败",
      condition: "模拟服务错误",
      expected: "错误保留在弹窗",
      render: () => <Example error />,
    },
  ],
} satisfies CatalogEntry
