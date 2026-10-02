import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AddConnectionDialog } from "./add-connection-dialog"
function Example() {
  const [open, setOpen] = useState(true)
  const [value, setValue] = useState("")
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>添加连接</Button>
      <p role="status">{value}</p>
      <AddConnectionDialog
        open={open}
        onClose={() => setOpen(false)}
        onChoose={(kind) => {
          setValue(kind)
          setOpen(false)
        }}
      />
    </div>
  )
}
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "add-connection-dialog",
  name: "添加连接方式",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/add-connection-dialog.tsx",
  description: "选择API凭据或订阅账号授权。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: ["open"],
  events: ["onChoose(kind)", "onClose"],
  composition: ["Dialog", "Button"],
  consumers: ["ModelSettingsPage"],
  viewport: { width: 800, height: 420 },
  states: [
    {
      id: "default",
      name: "接入方式",
      condition: "打开添加弹窗",
      expected: "选择后传递连接类型",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
