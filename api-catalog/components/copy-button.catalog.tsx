import type { CatalogEntry } from "../../ui-catalog/catalog"
import { CopyButton } from "./copy-button"
import { CatalogPreview } from "./catalog-fixtures"

export default {
  id: "api-copy-button",
  name: "目录复制操作",
  layer: "基础组件",
  group: "接口目录",
  source: "api-catalog/components/copy-button.tsx",
  description: "复制当前文档内容并提供成功/失败反馈。",
  boundary: "仅用户主动操作剪贴板；参数或响应更换后不保留旧内容复制反馈。",
  inputs: ["value", "label", "disabled"],
  events: ["复制", "aria-live 反馈"],
  composition: ["Button", "Lucide"],
  consumers: [
    "OperationDocs",
    "RequestEditor",
    "ResponseViewer",
    "ArchitectureViewer",
  ],
  viewport: { width: 400, height: 180 },
  states: [
    {
      id: "ready",
      name: "可复制",
      condition: "有内容",
      expected: "主动复制后显示反馈，失败有手动选择说明。",
      render: () => (
        <CatalogPreview>
          <CopyButton value="sessionApply" label="复制标识" />
        </CatalogPreview>
      ),
    },
    {
      id: "empty",
      name: "空内容",
      condition: "没有返回",
      expected: "复制禁用，不复制历史内容。",
      render: () => (
        <CatalogPreview>
          <CopyButton value="" label="复制结果" />
        </CatalogPreview>
      ),
    },
  ],
} satisfies CatalogEntry
