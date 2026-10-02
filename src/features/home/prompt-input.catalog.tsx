import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { PromptInput } from "./prompt-input"
import { InputGroup } from "@/components/ui/input-group"

function Example() {
  const [value, setValue] = useState("")
  const [count, setCount] = useState(0)
  return (
    <div className="p-6">
      <InputGroup>
        <PromptInput
          value={value}
          onChange={setValue}
          onSubmit={() => setCount((n) => n + 1)}
        />
      </InputGroup>
      <p role="status">提交事件：{count}</p>
    </div>
  )
}
export default {
  id: "prompt-input",
  name: "需求输入",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/prompt-input.tsx",
  description: "处理文本编辑、回车发送与输入法组合保护。",
  boundary:
    "必须位于 InputGroup 中；父级负责发送有效性，文本由父级持有；不隐式抢占焦点，使用点击或 Tab 进入。",
  inputs: ["value: 文本。"],
  events: ["onChange(text)；onSubmit()，Shift+Enter 保留换行。"],
  composition: ["InputGroupTextarea"],
  consumers: ["HomeComposer"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "editing",
      name: "编辑与快捷键",
      condition: "空文本，父级只记录提交事件。",
      expected: "可输入；Enter 增加事件计数，Shift+Enter 换行。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
