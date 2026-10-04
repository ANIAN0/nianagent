import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiKeyField } from "./api-key-field"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({
  fail = false,
  saved = true,
  restart = false,
}: {
  fail?: boolean
  saved?: boolean
  restart?: boolean
}) {
  const [value, setValue] = useState("")
  const [open, setOpen] = useState(true)
  return (
    <div className="max-w-xl p-6">
      {open ? (
        <ApiKeyField
          value={value}
          saved={saved && !value}
          onChange={setValue}
          onReloadConnection={() => setOpen(false)}
          onReveal={async () => {
            if (restart)
              throw Object.assign(new Error("宿主需重启"), {
                issue: {
                  code: "host_version",
                  summary: "当前桌面服务不支持读取密钥，请更新并重启 Moon。",
                  recovery: "restart",
                  severity: "error",
                },
              })
            if (fail)
              throw Object.assign(new Error("连接已更新"), {
                issue: {
                  code: "revision_conflict",
                  summary: "连接已更新，请返回目录后重新打开连接。",
                  recovery: "reload",
                  severity: "error",
                },
              })
            return "moon-demo-key-not-a-real-secret"
          }}
        />
      ) : (
        <Button onClick={() => setOpen(true)}>已返回目录 · 重开密钥示例</Button>
      )}
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
  events: ["onChange", "onReloadConnection"],
  composition: ["InputGroup", "Field", "OperationFeedback", "RecoveryAction"],
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
      expected: "版本冲突返回目录，不能重复读取旧revision",
      render: () => <Example fail />,
    },
    {
      id: "restart",
      name: "服务需重启",
      condition: "revealKey返回restart",
      expected: "重启指引，不出现重复读取或复制的伪恢复",
      render: () => <Example restart />,
    },
  ],
} satisfies CatalogEntry
