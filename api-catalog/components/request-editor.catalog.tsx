import type { CatalogEntry } from "../../ui-catalog/catalog"
import { useState } from "react"
import { assertSchema, operations } from "../../backend/contract.mjs"
import { RequestEditor } from "./request-editor"
import { CatalogPreview } from "./catalog-fixtures"

function RequestPreview({
  invalid = false,
  initiallyBusy = false,
}: {
  invalid?: boolean
  initiallyBusy?: boolean
}) {
  const example = JSON.stringify(operations.sessionApply.example, null, 2)
  const [value, setValue] = useState(invalid ? '{ "sessionId": ' : example)
  const [busy, setBusy] = useState(initiallyBusy)
  let validationError: string | null = null
  try {
    assertSchema(operations.sessionApply.request, JSON.parse(value))
  } catch (error) {
    validationError = error instanceof Error ? error.message : "参数不符合契约"
  }
  return (
    <CatalogPreview>
      <RequestEditor
        operation="sessionApply"
        title="应用会话配置"
        value={value}
        onChange={setValue}
        onRestoreExample={() => setValue(example)}
        onClear={() => setValue("")}
        busy={busy}
        validationError={validationError}
        dirty={value !== example}
        onRun={() => setBusy(true)}
        onCancel={() => setBusy(false)}
        environment="组件展示 · 不连接真实服务"
        effect={operations.sessionApply.effect}
      />
    </CatalogPreview>
  )
}

export default {
  id: "api-request-editor",
  name: "真实调用参数编辑器",
  layer: "复合组件",
  group: "接口目录",
  source: "api-catalog/components/request-editor.tsx",
  description:
    "在真实目标和副作用说明旁编辑 JSON；展示契约错误、恢复示例并执行或取消请求。",
  boundary: "仅受控参数与事件，正式调用由 Controller；展示环境不接触真实服务。",
  inputs: [
    "operation",
    "value",
    "busy",
    "validationError",
    "dirty",
    "environment",
    "effect",
  ],
  events: [
    "onChange",
    "onRestoreExample",
    "onClear",
    "onRun",
    "onCancel",
    "复制参数",
  ],
  composition: [
    "FieldGroup",
    "Field",
    "Textarea",
    "Alert",
    "Button",
    "CopyButton",
  ],
  consumers: ["DebugPanel"],
  viewport: { width: 560, height: 760 },
  states: [
    {
      id: "ready",
      name: "合法示例",
      condition: "合法 sessionApply 示例",
      expected:
        "数据变化和目标可读，恢复/复制/清空可操作；执行只进入展示等待。",
      render: () => <RequestPreview />,
    },
    {
      id: "invalid",
      name: "无效 JSON",
      condition: "JSON 不完整",
      expected: "错误在输入后显示，执行按钮禁用；恢复示例后可执行。",
      render: () => <RequestPreview invalid />,
    },
    {
      id: "running",
      name: "调用中",
      condition: "展示请求等待",
      expected: "禁止修改/恢复/清空和再次执行，取消后参数保留。",
      render: () => <RequestPreview initiallyBusy />,
    },
  ],
} satisfies CatalogEntry
