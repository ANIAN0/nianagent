import type { CatalogEntry } from "../../../ui-catalog/catalog"
import {
  InputGroup,
  InputGroupInput,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
} from "./input-group"
import { useState } from "react"
function Example({ multiline = false }: { multiline?: boolean }) {
  const [value, setValue] = useState("")
  const [count, setCount] = useState(0)
  return (
    <div className="p-6">
      <InputGroup>
        {multiline ? (
          <InputGroupTextarea
            aria-label="组合多行输入"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <InputGroupInput
            aria-label="组合单行输入"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <InputGroupAddon align={multiline ? "block-end" : "inline-end"}>
          <InputGroupButton onClick={() => setCount((n) => n + 1)}>
            操作
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <p role="status">
        {value}；操作 {count} 次
      </p>
    </div>
  )
}
export default {
  id: "input-group",
  name: "InputGroup",
  layer: "基础组件",
  group: "表单",
  source: "src/components/ui/input-group.tsx",
  description: "组合输入、图标和操作附属区域。",
  boundary: "必须使用 InputGroupInput/Textarea；Addon 负责附属区域位置。",
  inputs: ["align: inline-start/end、block-start/end；受控 value。"],
  events: ["输入 onChange；按钮 onClick。"],
  composition: ["Input", "Textarea", "Button"],
  consumers: [
    "ComposerToolbar",
    "SendControl",
    "HomeComposer",
    "PromptInput",
    "MaterialPicker",
    "SelectedMaterials",
    "ToolPicker",
    "ConversationSearch",
    "ConversationComposer",
    "ConversationSendControl",
    "ApiKeyField",
  ],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "single",
      name: "单行组合",
      condition: "输入与尾部操作。",
      expected: "输入与按钮独立可操作。",
      render: () => <Example />,
    },
    {
      id: "multiline",
      name: "多行组合",
      condition: "文本区与底部操作。",
      expected: "换行和按钮正常。",
      render: () => <Example multiline />,
    },
  ],
} satisfies CatalogEntry
