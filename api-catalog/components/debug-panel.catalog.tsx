import { useState } from "react"
import type { CatalogEntry } from "../../ui-catalog/catalog"
import { operations, validateRequest } from "../../backend/contract.mjs"
import { Button } from "@/components/ui/button"
import DebugPanel from "./debug-panel"
import { CatalogPreview } from "./catalog-fixtures"
import type { CatalogResponse } from "./types"

function DebugPreview({ running = false }: { running?: boolean }) {
  const example = JSON.stringify(operations.list.example, null, 2)
  const [input, setInput] = useState(example)
  const [closed, setClosed] = useState(false)
  const [response, setResponse] = useState<CatalogResponse>({
    status: running ? "running" : "idle",
    text: "",
  })
  let validationError: string | null = null
  try {
    validateRequest("list", JSON.parse(input))
  } catch (error) {
    validationError = error instanceof Error ? error.message : "参数无效"
  }
  const cancel = () =>
    setResponse({
      status: "cancelled",
      text: "已取消展示等待，未调用真实服务。",
    })
  return (
    <CatalogPreview>
      {closed ? (
        <Button onClick={() => setClosed(false)}>
          重新打开调试面板（草稿保留）
        </Button>
      ) : (
        <DebugPanel
          request={{
            operation: "list",
            title: operations.list.title,
            value: input,
            dirty: input !== example,
            validationError,
            busy: response.status === "running",
            environment: "组件展示 · 不连接真实服务",
            effect: operations.list.effect,
            onChange: setInput,
            onRestoreExample: () => setInput(example),
            onClear: () => setInput(""),
            onRun: () => setResponse({ status: "running", text: "" }),
            onCancel: cancel,
          }}
          response={{
            response,
            onClear: () => setResponse({ status: "idle", text: "" }),
          }}
          onClose={() => {
            if (response.status === "running") cancel()
            setClosed(true)
          }}
        />
      )}
    </CatalogPreview>
  )
}

export default {
  id: "api-debug-panel",
  name: "按需接口调试面板",
  layer: "复合组件",
  group: "接口目录",
  source: "api-catalog/components/debug-panel.tsx",
  description: "从文档明确打开后组合参数编辑、真实结果与收起动作；首屏不加载。",
  boundary:
    "不拥有请求或草稿；正式 Controller 保留每接口数据，展示环境只改变内存状态。",
  inputs: ["request", "response", "focusOnMount"],
  events: ["onClose", "转交 RequestEditor/ResponseViewer 事件"],
  composition: ["RequestEditor", "ResponseViewer", "Button"],
  consumers: ["ApiCatalogApp"],
  viewport: { width: 640, height: 1080 },
  states: [
    {
      id: "ready",
      name: "编辑与收起",
      condition: "合法 list 示例，未发起调用",
      expected: "编辑、收起、重新打开后草稿保留；按钮不会调用真实服务。",
      render: () => <DebugPreview />,
    },
    {
      id: "running",
      name: "收起时取消等待",
      condition: "展示调用正在等待",
      expected: "收起后等待取消，重新打开显示取消状态且参数仍保留。",
      render: () => <DebugPreview running />,
    },
  ],
} satisfies CatalogEntry
