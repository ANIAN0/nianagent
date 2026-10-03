import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { blankMcpConfiguration } from "./mcp-service"
import { McpTransportFields } from "./mcp-transport-fields"
function Example({ http = false }: { http?: boolean }) {
  const [value, setValue] = useState({
    ...blankMcpConfiguration(),
    transport: http ? ("http" as const) : ("stdio" as const),
  })
  return (
    <div className="max-w-3xl p-6">
      <McpTransportFields
        value={value}
        onChange={(patch) => setValue((old) => ({ ...old, ...patch }))}
      />
    </div>
  )
}
export default {
  id: "mcp-transport-fields",
  name: "MCP 连接参数",
  layer: "复合组件",
  group: "MCP 服务",
  source: "src/features/mcp/mcp-transport-fields.tsx",
  description:
    "stdio命令/参数/目录/环境与HTTP地址/请求头，按传输显示有效字段。",
  boundary: "参数受控，不验证或启动进程。",
  inputs: ["value、disabled"],
  events: ["onChange(patch)"],
  composition: ["Field", "Input", "Textarea", "McpVariableFields"],
  consumers: ["McpServerEditor"],
  viewport: { width: 760, height: 550 },
  states: [
    {
      id: "stdio",
      name: "stdio 参数",
      condition: "选择本地程序",
      expected: "每行一个参数，环境变量可增删",
      render: () => <Example />,
    },
    {
      id: "http",
      name: "HTTP 参数",
      condition: "选择 Streamable HTTP",
      expected: "地址和请求头直接显示，可增删且键盘可达",
      render: () => <Example http />,
    },
  ],
} satisfies CatalogEntry
