import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { McpVariableFields } from "./mcp-variable-fields"
function Example() {
  const [value, onChange] = useState([
    { name: "Authorization", value: "Bearer ${DOCS_TOKEN}" },
  ])
  return (
    <div className="p-6">
      <McpVariableFields label="请求头" value={value} onChange={onChange} />
    </div>
  )
}
export default {
  id: "mcp-variable-fields",
  name: "MCP 名称和值",
  layer: "复合组件",
  group: "MCP 服务",
  source: "src/features/mcp/mcp-variable-fields.tsx",
  description: "直接展示环境变量或请求头名称/值，逐项增删。",
  boundary: "受控数组，不展开环境变量或执行表达式。",
  inputs: ["label、value、disabled"],
  events: ["onChange(entries)"],
  composition: ["Field", "Input", "Button"],
  consumers: ["McpTransportFields"],
  viewport: { width: 700, height: 240 },
  states: [
    {
      id: "default",
      name: "环境引用",
      condition: "带环境变量引用的请求头",
      expected: "输入与删除保持对应行，添加显示新行",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
