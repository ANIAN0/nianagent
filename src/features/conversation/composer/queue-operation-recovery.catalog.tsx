import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { QueueOperationRecovery } from "./queue-operation-recovery"
import type { QueueOperationRecord } from "../queue-operation-recovery"

function Example({
  allowed = false,
  multiple = false,
  storage = false,
}: {
  allowed?: boolean
  multiple?: boolean
  storage?: boolean
}) {
  const [records, setRecords] = useState<QueueOperationRecord[]>(
    storage
      ? []
      : [
          {
            sessionId: "catalog",
            operationRequestId: "original-remove",
            operation: "conversationQueueRemove",
            revision: 7,
            itemId: "departed-message",
          },
          ...(multiple
            ? [
                {
                  sessionId: "catalog",
                  operationRequestId: "original-mode",
                  operation: "conversationQueueMode" as const,
                  revision: 6,
                  mode: "all" as const,
                },
              ]
            : []),
        ]
  )
  const [checked, setChecked] = useState(false)
  const [storageIssue, setStorageIssue] = useState(storage)
  return (
    <div className="p-4">
      <QueueOperationRecovery
        records={records}
        retryAllowed={
          checked && allowed
            ? Object.fromEntries(
                records.map((record) => [record.operationRequestId, true])
              )
            : {}
        }
        storageIssue={
          storageIssue
            ? {
                code: "queue_recovery_storage",
                message: "本机恢复记录暂时无法读取，原记录保留。",
                severity: "warning",
                recovery: "reload",
              }
            : undefined
        }
        onCheck={() => {
          setChecked(true)
          setStorageIssue(false)
          if (!allowed) setRecords([])
        }}
        onRestore={(record) =>
          setRecords((current) =>
            current.filter(
              (item) => item.operationRequestId !== record.operationRequestId
            )
          )
        }
      />
      {!records.length && !storageIssue && (
        <p role="status" className="text-sm text-muted-foreground">
          演示核对完成，已清理对应原操作。
        </p>
      )}
    </div>
  )
}

export default {
  id: "queue-operation-recovery",
  name: "原队列操作恢复",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/queue-operation-recovery.tsx",
  description: "完整输入组件底部按原请求身份保留队列写入的核对入口。",
  boundary:
    "只展示冻结的原操作元数据；不按当前队列猜测提交结果，不自行修改队列或重新生成请求。",
  inputs: [
    "records：原请求、原版本、目标或交付模式。",
    "retryAllowed：后端明确允许恢复的原请求；checking/restoring独立禁用对应动作。",
  ],
  events: [
    "onCheck只读原回执。onRestore精确交回原记录，由父级恢复同请求身份与原输入。",
  ],
  composition: ["OperationFeedback", "Button"],
  consumers: [
    "LiveConversationView → ConversationComposer → ComposerAuxiliaryBar",
  ],
  viewport: { width: 560, height: 350 },
  states: [
    {
      id: "departed",
      name: "原消息已离开队列",
      condition: "列表中已无原消息，回执仍未知。",
      expected: "核对入口仍保留，未获得许可不显示恢复。",
      render: () => <Example />,
    },
    {
      id: "missing",
      name: "明确允许恢复原操作",
      condition: "演示核对返回missing并明确许可。",
      expected: "先核对再出现恢复；恢复只移除对应演示原请求。",
      render: () => <Example allowed />,
    },
    {
      id: "multiple",
      name: "多个原请求",
      condition: "移除与交付设置分别待确认。",
      expected: "逐对象核对与恢复，诊断详情保留各自身份。",
      render: () => <Example allowed multiple />,
    },
    {
      id: "storage",
      name: "本机恢复记录不可读",
      condition: "只读本机存储故障。",
      expected: "有明确重新读取入口，不静默覆盖或发送新队列写入。",
      render: () => <Example storage />,
    },
  ],
} satisfies CatalogEntry
