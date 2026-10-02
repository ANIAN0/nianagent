import { useId, useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Field, FieldGroup, FieldLabel } from "./field"
import { Switch } from "./switch"
function ConfigField() {
  const id = useId()
  const [enabled, setEnabled] = useState(true)
  return (
    <FieldGroup className="p-6">
      <Field orientation="horizontal">
        <FieldLabel htmlFor={id}>允许使用工具</FieldLabel>
        <Switch id={id} checked={enabled} onCheckedChange={setEnabled} />
      </Field>
      <p role="status">工具{enabled ? "开启" : "关闭"}</p>
    </FieldGroup>
  )
}
export default {
  id: "field",
  name: "Field",
  layer: "基础组件",
  group: "表单",
  source: "src/components/ui/field.tsx",
  description: "配置表单字段的布局、标签和状态语义。",
  boundary: "值由调用方管理，标签必须关联控件；不包含业务配置持久化。",
  inputs: [
    "orientation: horizontal/vertical/responsive；FieldLabel.htmlFor 关联控件 id。",
  ],
  events: ["字段本身不发业务事件；Switch.onCheckedChange 修改父状态。"],
  composition: ["FieldGroup、Field、FieldLabel、Switch"],
  consumers: ["HomeComposer 表单布局、SessionConfig 配置字段"],
  viewport: { width: 480, height: 240 },
  states: [
    {
      id: "toggle",
      name: "配置开关",
      condition: "默认开启。",
      expected: "点击标签或开关可切换，Space 可操作，重置恢复开启。",
      render: () => <ConfigField />,
    },
  ],
} satisfies CatalogEntry
