import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Label } from "./label"
import { useId } from "react"
import { Input } from "./input"
function Example() {
  const id = useId()
  return (
    <div className="flex flex-col gap-3 p-6">
      <Label htmlFor={id}>演示名称</Label>
      <Input id={id} placeholder="点击标签聚焦此处" />
    </div>
  )
}
export default {
  id: "label",
  name: "Label",
  layer: "基础组件",
  group: "表单",
  source: "src/components/ui/label.tsx",
  description: "关联表单标签和控件。",
  boundary: "htmlFor 与控件 id 一致，避免仅视觉标签。",
  inputs: ["htmlFor、children。"],
  events: ["点击关联控件聚焦。"],
  composition: ["原生 label"],
  consumers: ["FieldLabel"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "association",
      name: "标签关联",
      condition: "标签与输入 id 对应。",
      expected: "点击标签后输入获得焦点。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
