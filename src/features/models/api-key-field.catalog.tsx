import { useState } from "react"
import { ApiKeyField } from "./api-key-field"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({
  fail = false,
  saved = true,
}: {
  fail?: boolean
  saved?: boolean
}) {
  const [value, setValue] = useState("")
  return (
    <div className="max-w-xl p-6">
      <ApiKeyField
        value={value}
        saved={saved && !value}
        onChange={setValue}
        onReveal={async () => {
          if (fail) throw new Error("连接已更新，请重新打开连接后查看密钥。")
          return "moon-demo-key-not-a-real-secret"
        }}
      />
    </div>
  )
}
export default {
  id: "api-key-field",
  name: "密钥输入",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/api-key-field.tsx",
  description: "默认遮蔽；按需读取保存值，显示、隐藏、复制与编辑。",
  boundary: "不存储密钥；读取回调由连接编辑器提供，离开后取消读取。",
  inputs: ["value/saved/disabled/error/onReveal"],
  events: ["onChange"],
  composition: ["InputGroup", "Field"],
  consumers: ["CredentialFields"],
  viewport: { width: 600, height: 220 },
  states: [
    {
      id: "saved",
      name: "已保存",
      condition: "有保存凭据",
      expected: "显式显示/复制，默认遮蔽",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "待填写",
      condition: "未保存",
      expected: "空值不能显示/复制",
      render: () => <Example saved={false} />,
    },
    {
      id: "error",
      name: "读取失败",
      condition: "版本冲突",
      expected: "明确错误，可重试",
      render: () => <Example fail />,
    },
  ],
} satisfies CatalogEntry
