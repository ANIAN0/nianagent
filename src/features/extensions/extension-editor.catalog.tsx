import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ExtensionEditor } from "./extension-editor"
import type { ExtensionDescriptor } from "./extension-service"
import {
  createExtensionFixtureService,
  type ExtensionFixtureMode,
} from "../../../ui-catalog/fixtures/extensions"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({ mode = "ready" }: { mode?: ExtensionFixtureMode }) {
  const [service] = useState(() => createExtensionFixtureService(mode))
  const [descriptor, setDescriptor] = useState<ExtensionDescriptor>()
  const [open, setOpen] = useState(true)
  const [readGeneration, refresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void service
      .list(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setDescriptor(items[0])
      })
      .catch(() => {})
    return () => controller.abort()
  }, [service, readGeneration])
  return (
    <div className="max-w-xl p-6">
      {open && descriptor ? (
        <ExtensionEditor
          descriptor={descriptor}
          service={service}
          onClose={() => setOpen(false)}
          onSaved={(keepOpen) => {
            if (!keepOpen) setOpen(false)
            refresh((generation) => generation + 1)
          }}
          registerLeave={() => {}}
        />
      ) : (
        <Button onClick={() => setOpen(true)} disabled={!descriptor}>
          重新打开扩展编辑
        </Button>
      )}
    </div>
  )
}
export default {
  id: "extension-editor",
  name: "扩展配置表单",
  layer: "复合组件",
  group: "会话配置",
  source: "src/features/extensions/extension-editor.tsx",
  description: "独立的schema字段草稿、CAS保存和原请求回执恢复。",
  boundary: "接收同一正式ExtensionService；此展示使用内存服务，不改真实扩展。",
  inputs: ["descriptor", "service", "registerLeave"],
  events: ["onClose", "onSaved(keepOpen?)"],
  composition: [
    "ExtensionConfigurationFields",
    "Field",
    "Switch",
    "OperationFeedback",
    "RecoveryAction",
    "SettingsConfirmDialog",
  ],
  consumers: ["ExtensionConfig"],
  viewport: { width: 650, height: 550 },
  states: [
    {
      id: "ready",
      name: "全局配置草稿",
      condition: "兼容schema，示例字符串参数",
      expected: "编辑启用和文字前缀；取消询问弃改；保存归应用级",
      render: () => <Example />,
    },
    {
      id: "unknown",
      name: "原保存已提交待核对",
      condition: "修改后保存响应丢失",
      expected: "核对原ID，确认后保留后续修改，不自动跳新revision重提",
      render: () => <Example mode="unknown" />,
    },
    {
      id: "pending",
      name: "原保存仍未确定",
      condition: "回执unknown",
      expected: "保留原ID与草稿；离开再重开不会产生另一保存",
      render: () => <Example mode="pending" />,
    },
  ],
} satisfies CatalogEntry
