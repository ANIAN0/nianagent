import { Info, TriangleAlert } from "lucide-react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Alert, AlertDescription, AlertTitle } from "./alert"
export default {
  id: "alert",
  name: "提示信息",
  layer: "基础组件",
  group: "反馈",
  source: "src/components/ui/alert.tsx",
  description: "带语义的提示与错误信息容器。",
  boundary: "展示传入内容，不管理错误恢复或请求。",
  inputs: [
    "variant：default / destructive。",
    "AlertTitle / AlertDescription / AlertAction 组合内容。",
  ],
  events: ["操作由 AlertAction 内的实际控件处理。"],
  composition: ["Alert、AlertTitle、AlertDescription、AlertAction"],
  consumers: ["ConversationComposer"],
  viewport: { width: 560, height: 180 },
  states: [
    {
      id: "default",
      name: "普通提示",
      condition: "非错误提示。",
      expected: "图标、标题与描述清晰分层。",
      render: () => (
        <Alert>
          <Info />
          <AlertTitle>等待连接恢复</AlertTitle>
          <AlertDescription>草稿已保留，消息仍可阅读。</AlertDescription>
        </Alert>
      ),
    },
    {
      id: "destructive",
      name: "错误提示",
      condition: "请求失败。",
      expected: "危险色提示错误内容。",
      render: () => (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>读取失败</AlertTitle>
          <AlertDescription>请重试当前请求。</AlertDescription>
        </Alert>
      ),
    },
  ],
} satisfies CatalogEntry
