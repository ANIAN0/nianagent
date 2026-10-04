import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ExtensionConfig } from "./extension-config"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import {
  createExtensionFixtureService,
  type ExtensionFixtureMode,
} from "../../../ui-catalog/fixtures/extensions"

function Example({ mode = "ready" }: { mode?: ExtensionFixtureMode }) {
  const [open, setOpen] = useState(true)
  const [service] = useState(() => createExtensionFixtureService(mode))
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>配置扩展</Button>
      <ExtensionConfig open={open} onOpenChange={setOpen} service={service} />
    </div>
  )
}
export default {
  id: "extension-config",
  name: "扩展能力配置",
  layer: "复合组件",
  group: "会话配置",
  source: "src/features/extensions/extension-config.tsx",
  description:
    "独立的应用级扩展配置入口；表单来自正式schema，保存和原请求回执独立于会话候选。",
  boundary:
    "同一正式组件，catalog只提供隔离服务替身。全局保存不随会话配置取消回滚。",
  inputs: ["service: ExtensionService", "open"],
  events: ["onOpenChange", "onConfigured"],
  composition: [
    "ExtensionEditor",
    "OperationFeedback",
    "RecoveryAction",
    "Dialog",
  ],
  consumers: ["SessionConfig"],
  viewport: { width: 850, height: 700 },
  states: [
    {
      id: "ready",
      name: "扩展配置",
      condition: "兼容扩展，有字符串字段及启用开关",
      expected: "独立保存；取消仅放弃扩展草稿；不会更改会话候选",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "未安装扩展",
      condition: "服务返回空目录",
      expected: "明确空状态，关闭返回会话配置",
      render: () => <Example mode="empty" />,
    },
    {
      id: "restart",
      name: "宿主需重启",
      condition: "权威recovery为restart",
      expected: "展示真实重启指引，不再次请求伪恢复",
      render: () => <Example mode="restart" />,
    },
    {
      id: "unknown",
      name: "原保存待核对",
      condition: "保存响应丢失，回执已提交；结果未知后继续编辑",
      expected: "只读原回执；确认原保存后保留后续修改，不跳新版本盲重提",
      render: () => <Example mode="unknown" />,
    },
    {
      id: "pending",
      name: "原保存仍未确认",
      condition: "回执保持unknown",
      expected: "保留原请求与草稿，禁止重复保存，关闭后重开可核对",
      render: () => <Example mode="pending" />,
    },
  ],
} satisfies CatalogEntry
