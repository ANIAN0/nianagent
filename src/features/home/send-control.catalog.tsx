import { useState } from "react"
import { SendControl } from "./send-control"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({ disabled = false }: { disabled?: boolean }) {
  const [count, setCount] = useState(0)
  return (
    <form
      className="flex items-center gap-4 p-6"
      onSubmit={(event) => {
        event.preventDefault()
        setCount(count + 1)
      }}
    >
      <SendControl disabled={disabled} />
      <output>提交事件：{count}</output>
    </form>
  )
}
export default {
  id: "send-control",
  name: "发送控制",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/send-control.tsx",
  description: "工作输入区的唯一主动作。",
  boundary:
    "由父级决定是否允许发送；通过所属 form 提交，不自行校验或调用服务。",
  props: [
    {
      name: "disabled",
      type: "boolean",
      default: "必填",
      description: "草稿为空或资源不可用时禁用。",
    },
  ],
  inputs: ["disabled: boolean"],
  events: ["原生 form submit；不额外维护 onClick 提交路径。"],
  composition: ["InputGroupButton"],
  consumers: ["ComposerToolbar"],
  viewport: { width: 340, height: 160 },
  states: [
    {
      id: "ready",
      name: "可发送",
      condition: "父级校验通过。",
      expected: "点击或键盘触发所属表单，事件次数增加。",
      render: () => <Example />,
    },
    {
      id: "disabled",
      name: "禁止发送",
      condition: "父级校验未通过。",
      expected: "按钮禁用，不触发提交。",
      render: () => <Example disabled />,
    },
  ],
} satisfies CatalogEntry
