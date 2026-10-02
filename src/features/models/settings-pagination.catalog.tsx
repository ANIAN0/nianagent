import { useState } from "react"
import { SettingsPagination } from "./settings-pagination"
function Example() {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  return (
    <div className="p-6">
      <SettingsPagination
        total={125}
        page={page}
        size={size}
        onPage={setPage}
        onSize={setSize}
        label="连接"
      />
    </div>
  )
}
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "settings-pagination",
  name: "设置目录分页",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/settings-pagination.tsx",
  description: "连接、候选及模型目录共用分页；数量与页码受控。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: ["total", "page", "size", "label"],
  events: ["onPage", "onSize"],
  composition: ["Select", "Button"],
  consumers: ["ConnectionList", "ModelDirectory"],
  viewport: { width: 1000, height: 140 },
  states: [
    {
      id: "default",
      name: "多页目录",
      condition: "125项",
      expected: "页码省略、前后翻页、每页数量重置页码",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
