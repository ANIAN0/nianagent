import type { CatalogEntry } from "../../ui-catalog/catalog"
import { useState } from "react"
import { ResponseViewer } from "./response-viewer"
import { CatalogPreview } from "./catalog-fixtures"
import type { CatalogResponse } from "./types"

function ResponsePreview({ initial }: { initial: CatalogResponse }) {
  const [response, setResponse] = useState(initial)
  return (
    <CatalogPreview>
      <ResponseViewer
        response={response}
        onClear={() => setResponse({ status: "idle", text: "" })}
      />
    </CatalogPreview>
  )
}

export default {
  id: "api-response-viewer",
  name: "接口响应面板",
  layer: "复合组件",
  group: "接口目录",
  source: "api-catalog/components/response-viewer.tsx",
  description: "区分调用阶段和真实返回，提供局部滚动、复制反馈及独立结果清除。",
  boundary: "响应由外部按当前接口管理；不猜测统计或执行状态，不记录敏感凭据。",
  inputs: ["response.status", "response.text", "response.elapsedMs"],
  events: ["复制结果", "onClear"],
  composition: ["Badge", "Empty", "Button", "CopyButton"],
  consumers: ["DebugPanel"],
  viewport: { width: 600, height: 600 },
  states: [
    {
      id: "idle",
      name: "未执行",
      condition: "没有请求",
      expected: "说明浏览文档不会调用服务。",
      render: () => <ResponsePreview initial={{ status: "idle", text: "" }} />,
    },
    {
      id: "running",
      name: "等待返回",
      condition: "请求中",
      expected: "显示等待状态，不允许复制旧结果或清除。",
      render: () => (
        <ResponsePreview initial={{ status: "running", text: "" }} />
      ),
    },
    {
      id: "success",
      name: "正常返回",
      condition: "确定性展示结果",
      expected: "成功状态、耗时和 JSON 正文可读，可复制并清除。",
      render: () => (
        <ResponsePreview
          initial={{
            status: "success",
            elapsedMs: 25,
            text: JSON.stringify(
              {
                sessionId: "sample-session",
                revision: 2,
                effectiveToolIds: ["read"],
              },
              null,
              2
            ),
          }}
        />
      ),
    },
    {
      id: "error",
      name: "失败",
      condition: "版本冲突展示",
      expected: "错误与成功明确区分，提供按照文档恢复的提示。",
      render: () => (
        <ResponsePreview
          initial={{
            status: "error",
            elapsedMs: 42,
            text: "配置已被更新，请重新读取后再提交。",
          }}
        />
      ),
    },
    {
      id: "cancelled",
      name: "取消等待",
      condition: "用户取消",
      expected: "取消不声称回滚已提交的数据变化。",
      render: () => (
        <ResponsePreview
          initial={{
            status: "cancelled",
            text: "已取消等待，输入参数已保留。",
          }}
        />
      ),
    },
    {
      id: "long",
      name: "长响应",
      condition: "多行结果",
      expected: "局部滚动而非撑长页面，长字段可读。",
      render: () => (
        <ResponsePreview
          initial={{
            status: "success",
            elapsedMs: 128,
            text: JSON.stringify(
              Array.from({ length: 40 }, (_, index) => ({
                id: `model-${index + 1}`,
                name: `模型 ${index + 1}`,
                supportedThinkingLevels: ["off", "low", "medium", "high"],
              })),
              null,
              2
            ),
          }}
        />
      ),
    },
  ],
} satisfies CatalogEntry
