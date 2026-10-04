import { useState } from "react"
import { ConfigurationRecoveryPanel } from "./configuration-recovery-panel"
import type { ConfigurationRecovery } from "./configuration-recovery-store"
import type { WriteReceipt } from "./model-contract.generated"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({
  mode = "unknown",
}: {
  mode?: "unknown" | "committed" | "rejected" | "restart"
}) {
  const [recoveries, setRecoveries] = useState<ConfigurationRecovery[]>([
    {
      operation: "save",
      operationRequestId: "demo-original-save",
      targetId: "openai",
      revision: 1,
    },
  ])
  const [service] = useState(() => ({
    evidence: "demo" as const,
    readWriteReceipt: async (
      operation: WriteReceipt["operation"],
      operationRequestId: string,
      signal?: AbortSignal
    ): Promise<WriteReceipt> => {
      signal?.throwIfAborted()
      if (mode === "restart")
        throw Object.assign(new Error("宿主需重启"), {
          issue: {
            code: "host_version",
            summary: "示例：当前服务不支持回执读取，请更新并重启 Moon。",
            recovery: "restart",
            severity: "error",
          },
        })
      return {
        operation,
        operationRequestId,
        targetId: "openai",
        state: mode,
        revision: mode === "committed" ? 2 : undefined,
        issue:
          mode === "rejected"
            ? {
                code: "revision_conflict",
                severity: "error",
                recovery: "reload",
                summary: "示例：原请求因版本变化未提交。",
              }
            : undefined,
      }
    },
  }))
  return (
    <div className="max-w-xl p-6">
      <ConfigurationRecoveryPanel
        recoveries={recoveries}
        service={service}
        operations={["save"]}
        onResolved={() => setRecoveries([])}
      />
    </div>
  )
}
export default {
  id: "configuration-recovery-panel",
  name: "设置原请求恢复",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/configuration-recovery-panel.tsx",
  description: "应用重开后只读原回执/原授权身份；没有再次执行原操作。",
  boundary:
    "正式入口从只含ID和版本的恢复记录读取；展示注入独立recoveries与服务替身，不读写正式存储。",
  inputs: [
    "service",
    "operations",
    "recoveries?: controlled recovery identities",
  ],
  events: ["onResolved"],
  composition: [
    "OperationFeedback",
    "RecoveryAction",
    "SettingsConfirmDialog",
    "Button",
  ],
  consumers: ["ModelSettingsPage", "McpSettings", "ExtensionConfig"],
  viewport: { width: 750, height: 440 },
  states: [
    {
      id: "unknown",
      name: "原请求仍待确认",
      condition: "重开时回执保持unknown",
      expected:
        "自动只读核对一次，未知继续保留原ID，放弃需说明仅忘本机记录；不重新保存",
      render: () => <Example />,
    },
    {
      id: "committed",
      name: "原请求已提交",
      condition: "原回执committed",
      expected: "解除未知身份、重新读取目录；凭据和草稿原文未持久化",
      render: () => <Example mode="committed" />,
    },
    {
      id: "rejected",
      name: "原请求未提交",
      condition: "原回执rejected",
      expected: "不会执行原保存，返回明确结果并刷新目录",
      render: () => <Example mode="rejected" />,
    },
    {
      id: "restart",
      name: "回执读取需重启",
      condition: "读取返回restart",
      expected: "保持原身份并展示重启指引，不替换成重复保存",
      render: () => <Example mode="restart" />,
    },
  ],
} satisfies CatalogEntry
