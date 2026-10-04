import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { blankMcpConfiguration } from "./mcp-service"
import { McpTransportFields } from "./mcp-transport-fields"
function Example({
  http = false,
  validate = false,
}: {
  http?: boolean
  validate?: boolean
}) {
  const [value, setValue] = useState({
    ...blankMcpConfiguration(),
    transport: http ? ("http" as const) : ("stdio" as const),
  })
  return (
    <div className="max-w-3xl p-6">
      <McpTransportFields
        value={value}
        validate={validate}
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
  boundary: "参数受控，按提交状态显示必填反馈；不启动服务或写入配置。",
  inputs: ["value、disabled、validate"],
  events: ["onChange(patch)"],
  composition: [
    "Field",
    "FieldError",
    "Input",
    "Textarea",
    "McpVariableFields",
  ],
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
      id: "required",
      name: "缺少启动程序",
      condition: "提交时 stdio 可执行文件为空",
      expected: "错误与程序输入框关联，输入程序后字段错误消失",
      render: () => <Example validate />,
    },
    {
      id: "http-required",
      name: "缺少服务地址",
      condition: "提交时 HTTP 地址为空",
      expected: "错误与地址输入框关联，不将同一错误显示为全页失败",
      render: () => <Example http validate />,
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
