import { useRef, useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { homeData } from "../../../../ui-catalog/fixtures/home"
import { RpcRequestRejected } from "@/features/models/model-service"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { QueueDock, type QueueDockProps } from "./queue-dock"
import { ComposerAuxiliaryBar } from "./composer-auxiliary-bar"
import { ComposerPanelProvider } from "@/features/home/composer-panel-context"
import type { Material } from "@/features/home/home-types"
import { MaterialServiceContext } from "@/features/materials/material-service"
import {
  exampleMaterials,
  exampleMaterialService,
} from "@/features/materials/material-catalog-fixtures"

type Failure =
  | "edit"
  | "edit-unknown"
  | "edit-same-unknown"
  | "edit-unknown-failed"
  | "edit-retired-confirmed"
  | "edit-retired-other"
  | "recover-error"
  | "remove"
  | "remove-unknown"
  | "deliver"
  | "deliver-unknown"
  | "mode"
  | "mode-unknown"
  | "store"
function Example({
  count,
  running = true,
  failure,
}: {
  count: number
  running?: boolean
  failure?: Failure
}) {
  const [items, setItems] = useState<QueueDockProps["items"]>(() =>
    Array.from({ length: count }, (_, i) => ({
      id: String(i),
      status: failure === "edit-same-unknown" && i === 0 ? "failed" : "pending",
      error:
        failure === "store" && i === 0
          ? "EPERM / rename：待处理消息提交失败"
          : undefined,
      draft: {
        workspaceId: homeData.workspaces[0].id,
        text: ["补充检查深色主题和键盘操作", "随后整理本次变更说明"][i],
        model: homeData.models[0],
        thinking: "中等",
        materials: i === 0 ? [exampleMaterials[0]] : [],
        session: { toolIds: [], instructionScope: "all" },
      },
    }))
  )
  const [mode, setMode] = useState<"single" | "all">("single")
  const [revision, setRevision] = useState(1)
  const [retiredItems, setRetiredItems] = useState<
    NonNullable<QueueDockProps["retiredItems"]>
  >([])
  const [notice, setNotice] = useState("")
  const [issue, setIssue] = useState<FeedbackDescription | undefined>(() =>
    failure === "store"
      ? {
          code: "queue_store_failed",
          message:
            "未能保存待处理消息，消息与修改文字仍然保留。请关闭占用配置文件的程序后重新交付。",
          details: "操作：待处理消息提交\n文件系统错误：EPERM / rename",
          recovery: "retry",
        }
      : undefined
  )
  const [issues, setIssues] = useState<
    Record<string, FeedbackDescription | undefined>
  >(() =>
    failure === "remove"
      ? {
          "queue-remove:0": {
            code: "operation_failed",
            message: "未能移除这条消息，原消息仍在队列中。",
            recovery: "retry",
          },
        }
      : failure === "deliver"
        ? {
            "queue-deliver:0": {
              code: "operation_failed",
              message: "未能交付这条消息，请重试。原文与附件已保留。",
              recovery: "retry",
            },
          }
        : failure === "mode"
          ? {
              mode: {
                code: "operation_failed",
                message: "交付设置未能保存，请重新选择交付数量。",
                recovery: "retry",
              },
            }
          : failure === "remove-unknown"
            ? {
                "queue-remove:0": {
                  code: "result_unknown",
                  message: "尚未确认这条消息是否已移除，请核对原消息。",
                  recovery: "check",
                },
              }
            : failure === "deliver-unknown"
              ? {
                  "queue-deliver:0": {
                    code: "result_unknown",
                    message: "尚未确认这条消息是否已交付，请核对原消息。",
                    recovery: "check",
                  },
                }
              : failure === "mode-unknown"
                ? {
                    mode: {
                      code: "result_unknown",
                      message: "尚未确认交付设置是否已保存，请先核对。",
                      recovery: "check",
                    },
                  }
                : {}
  )
  const attempts = useRef(0)
  const recoveryAttempts = useRef(0)
  const pendingEdit = useRef<{
    id: string
    text: string
    materials?: Material[]
    revision?: number
    clientEditId?: string
  } | null>(null)
  const clearIssue = (key: string) =>
    setIssues((old) => ({ ...old, [key]: undefined }))
  const update = (
    id: string,
    text: string,
    materials?: Material[],
    originalRevision?: number,
    clientEditId?: string,
    status: "pending" | "failed" = "pending"
  ) => {
    setItems((old) =>
      old.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              editBaseRevision: originalRevision,
              editRequestId: clientEditId,
              draft: {
                ...item.draft,
                text,
                materials: materials ?? item.draft.materials,
              },
            }
          : item
      )
    )
    setRevision((current) => current + 1)
  }
  return (
    <MaterialServiceContext.Provider value={exampleMaterialService}>
      <ComposerPanelProvider>
        <div className="p-4">
          <QueueDock
            cwd="H:/工作区/moon"
            revision={revision}
            retiredItems={retiredItems}
            items={items}
            running={running}
            deliveryMode={mode}
            issue={issue}
            issues={issues}
            onEdit={async (
              id,
              text,
              materials,
              originalRevision,
              clientEditId
            ) => {
              attempts.current += 1
              if (failure === "edit" && attempts.current === 1)
                throw new RpcRequestRejected(
                  "未能保存消息，请重试。修改文字已保留。"
                )
              if (
                (failure === "edit-unknown" ||
                  failure === "edit-same-unknown" ||
                  failure === "edit-unknown-failed" ||
                  failure === "edit-retired-confirmed" ||
                  failure === "edit-retired-other" ||
                  failure === "recover-error") &&
                attempts.current === 1
              ) {
                pendingEdit.current = {
                  id,
                  text,
                  materials,
                  revision: originalRevision,
                  clientEditId,
                }
                throw Object.assign(new Error("响应未确认"), {
                  issue: {
                    code: "result_unknown",
                    summary: "暂时无法确认编辑结果，请核对原消息。",
                    recovery: "check",
                    severity: "warning",
                  },
                })
              }
              update(id, text, materials, originalRevision, clientEditId)
            }}
            onRemove={(id) => {
              setItems((old) => old.filter((item) => item.id !== id))
              clearIssue(`queue-remove:${id}`)
            }}
            onSendNow={(id) => {
              setItems((old) => old.filter((item) => item.id !== id))
              clearIssue(`queue-deliver:${id}`)
              setIssue(undefined)
              setNotice(running ? "已补充当前工作" : "已开始处理这条消息")
            }}
            onCheck={() => {
              if (pendingEdit.current) {
                if (
                  failure === "edit-retired-confirmed" ||
                  failure === "edit-retired-other" ||
                  failure === "recover-error"
                ) {
                  const pending = pendingEdit.current
                  setRetiredItems([
                    {
                      id: pending.id,
                      clientRequestId: "catalog-original-request",
                      status: "delivered",
                      editBaseRevision: pending.revision,
                      editRequestId:
                        failure === "edit-retired-confirmed"
                          ? pending.clientEditId
                          : "catalog-other-client-edit",
                    },
                  ])
                  setItems((old) =>
                    old.filter((item) => item.id !== pending.id)
                  )
                  setRevision((current) => current + 1)
                  pendingEdit.current = null
                  setNotice("只读确认原项已交付（展示）")
                  return
                }
                update(
                  pendingEdit.current.id,
                  pendingEdit.current.text,
                  pendingEdit.current.materials,
                  pendingEdit.current.revision,
                  pendingEdit.current.clientEditId,
                  failure === "edit-unknown-failed" ? "failed" : "pending"
                )
                pendingEdit.current = null
              }
              if (
                failure === "remove-unknown" ||
                failure === "deliver-unknown"
              ) {
                setItems((old) => old.filter((item) => item.id !== "0"))
                clearIssue(
                  failure === "remove-unknown"
                    ? "queue-remove:0"
                    : "queue-deliver:0"
                )
              }
              if (failure === "mode-unknown") {
                setMode("all")
                clearIssue("mode")
              }
              setNotice("已重新读取队列状态")
            }}
            onRecoverEdit={async (text, materials) => {
              recoveryAttempts.current += 1
              if (failure === "recover-error" && recoveryAttempts.current === 1)
                throw new Error(
                  "输入框草稿保存失败；排队编辑的文字和材料仍保留，请重试。"
                )
              setNotice(
                `已保留修改到输入框（展示）：${text} · ${materials?.length ?? 0}份材料`
              )
            }}
          />
          <ComposerAuxiliaryBar
            deliveryMode={mode}
            queuedCount={items.length}
            onDeliveryModeChange={(value) => {
              setMode(value)
              clearIssue("mode")
            }}
            modeIssue={issues.mode}
            onCheckMode={() => {
              setMode("all")
              clearIssue("mode")
              setNotice("交付设置已核对（展示）")
            }}
          />
          <p role="status">{notice}</p>
        </div>
      </ComposerPanelProvider>
    </MaterialServiceContext.Provider>
  )
}
export default {
  id: "queue-dock",
  name: "排队消息",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/queue-dock.tsx",
  description:
    "贴合输入卡上沿的排队消息，提供编辑、移除与立即补充；失败反馈归对应消息，交付操作固定在输入辅助栏。",
  boundary:
    "父级持有队列、交付模式和操作错误；组件按session/item保留完整编辑副本、原revision和未知payload，ACK后清除。目录服务隔离，不写正式用户数据。",
  inputs: [
    "items:{id,draft,status,error}[]、running、busy、deliveryMode",
    "issue: 队列存储反馈；issues: queue-remove:{id}/queue-deliver:{id}；onCheck: 只读核对；mode 反馈由 ComposerAuxiliaryBar 显示。",
  ],
  events: [
    "onEdit(id,text,materials,originalRevision,clientEditId)、onRemove(id)、onSendNow(id)、onCheck()；onRecoverEdit(text,materials,recoveryKey) 在目标持久保存后 resolve。",
    "编辑Enter保存、Shift+Enter换行、Escape取消；共享IME/修饰键/重复保护。未知结果只有核对动作，不再次提交；原版本和编辑请求身份匹配权威回执后结束编辑。",
  ],
  composition: [
    "Button",
    "QueueEditEditor",
    "Field",
    "Popover",
    "MaterialPreviewDialog",
    "OperationFeedback",
  ],
  consumers: ["ConversationComposer dock"],
  viewport: { width: 800, height: 480 },
  states: [
    {
      id: "edit-unknown-failed",
      name: "编辑已保存而交付失败",
      condition:
        "编辑响应丢失，读取到同 clientEditId 和原 revision 的 failed 原项。",
      expected:
        "确认编辑已保存并结束冻结；交付失败仍归该队列消息，能继续处理。",
      render: () => <Example count={1} failure="edit-unknown-failed" />,
    },
    {
      id: "recover-error",
      name: "保留到输入框未能保存",
      condition: "原项已离开且无法确认编辑，保留到输入框首次持久保存失败。",
      expected:
        "原编辑文字和材料继续保留，就近提示保存失败；重试成功后才清除源副本。",
      render: () => <Example count={1} failure="recover-error" />,
    },
    {
      id: "edit-retired-confirmed",
      name: "编辑提交后原项已交付",
      condition:
        "编辑回执丢失，随后只读返回同原revision和clientEditId的终态回执。",
      expected: "确认该编辑已提交并清除本地副本，不再次发送或编辑。",
      render: () => <Example count={1} failure="edit-retired-confirmed" />,
    },
    {
      id: "edit-retired-other",
      name: "原项离开且编辑未能确认",
      condition:
        "只读终态回执有相同原revision，但editRequestId属于另一客户端编辑。",
      expected:
        "如实说明无法确认这份编辑，保留文字和材料；仅用户明确保留到输入框或放弃编辑后清副本，不重发。",
      render: () => <Example count={1} failure="edit-retired-other" />,
    },
    {
      id: "paused",
      name: "停止后继续",
      condition: "当前工作停止，队列仍有未处理消息",
      expected: "仍可编辑、移除或发送，不会成为无法处理的残留",
      render: () => <Example count={2} running={false} />,
    },
    {
      id: "single",
      name: "单条",
      condition: "只有一条排队消息",
      expected: "内容直接展开，交付数量设置仍然可达",
      render: () => <Example count={1} />,
    },
    {
      id: "multiple",
      name: "多条折叠",
      condition: "两条消息",
      expected: "计数可展开，模式作用于下次交付，清空后隐藏",
      render: () => <Example count={2} />,
    },
    {
      id: "edit-error",
      name: "编辑保存失败",
      condition: "编辑文字后保存，首次保存明确失败；再次保存成功",
      expected: "草稿不丢失，失败只归编辑行，读取到更新才结束编辑",
      render: () => <Example count={1} failure="edit" />,
    },
    {
      id: "edit-unknown",
      name: "编辑结果待确认",
      condition: "首次编辑保存未收到确定结果",
      expected:
        "草稿保留且禁重存，只读核对；读取到原版本和编辑请求身份对应的回执后结束编辑",
      render: () => <Example count={1} failure="edit-unknown" />,
    },
    {
      id: "edit-same-unknown",
      name: "同文编辑不能误认旧回执",
      condition:
        "失败消息保持原文保存，首次返回未知，核对才读取到新版本 pending",
      expected:
        "旧同文 props 不关闭编辑；未知反馈可见且禁写，核对到对应请求身份后才结束",
      render: () => <Example count={1} failure="edit-same-unknown" />,
    },
    {
      id: "remove-error",
      name: "移除失败",
      condition: "第一条消息的移除失败",
      expected: "反馈在对应行，只重试移除该消息，另一条消息不报错",
      render: () => <Example count={2} failure="remove" />,
    },
    {
      id: "remove-unknown",
      name: "移除结果待确认",
      condition: "移除原请求已接受但回执未确认",
      expected: "不重复移除，只核对原消息；读取到原项已移除后结束警告",
      render: () => <Example count={2} failure="remove-unknown" />,
    },
    {
      id: "deliver-error",
      name: "交付失败",
      condition: "第一条消息交付失败，原文与附件保留",
      expected: "反馈在对应行，只有重试交付动作；消息列表保持展开",
      render: () => <Example count={2} failure="deliver" />,
    },
    {
      id: "deliver-unknown",
      name: "交付结果待确认",
      condition: "交付原请求已接受但回执未确认",
      expected: "不重复交付，只核对原消息；读取到原项已交付后结束警告",
      render: () => <Example count={2} failure="deliver-unknown" />,
    },
    {
      id: "mode-error",
      name: "交付设置失败",
      condition: "交付设置未能保存",
      expected: "反馈与交付控件同处，重新选择后清除本设置错误",
      render: () => <Example count={1} failure="mode" />,
    },
    {
      id: "mode-unknown",
      name: "交付设置待确认",
      condition: "设置保存回执未确认",
      expected: "反馈与控件同处且暂禁重选，只读核对成功后恢复选择",
      render: () => <Example count={1} failure="mode-unknown" />,
    },
    {
      id: "store-error",
      name: "队列存储失败",
      condition: "服务存储错误与消息项同源错误同时存在",
      expected:
        "同一问题只有队列主反馈，技术信息折叠到诊断详情，不逐项重复显示",
      render: () => <Example count={2} failure="store" />,
    },
  ],
} satisfies CatalogEntry
