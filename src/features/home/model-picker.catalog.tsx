import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ModelPicker } from "./model-picker"
import { homeData } from "../../../ui-catalog/fixtures/home"

function Example({ empty = false }: { empty?: boolean }) {
  const [value, setValue] = useState(empty ? "" : homeData.models[0]!)
  const [thinking, setThinking] = useState("中等")
  return (
    <div className="p-6">
      <ModelPicker
        models={empty ? [] : homeData.models}
        value={value}
        onChange={setValue}
        thinking={thinking}
        onThinkingChange={setThinking}
      />
      <p role="status">
        模型：{value || "未选择"} · {thinking}
      </p>
    </div>
  )
}
export default {
  id: "model-picker",
  name: "模型选择",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/model-picker.tsx",
  description: "模型与思考共用入口，根菜单进入两级选择面板。",
  boundary: "受控值；模型目录由外部提供，不连接模型服务。",
  inputs: ["models: string[]；value: 模型名；thinking: 思考强度。"],
  events: ["onChange(model)、onThinkingChange(value)，选择立即回写关闭。"],
  composition: ["Popover", "RadioGroup", "ThinkingPicker"],
  consumers: ["ComposerToolbar"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "available",
      name: "可选模型",
      condition: "两个模拟模型。",
      expected:
        "选中项以尾部Check表示，未选项无圆框；进入模型或思考页；返回/Esc 回到根菜单；选择后关闭并更新输出。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "无模型",
      condition: "列表为空。",
      expected: "显示占位并禁用选择。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
