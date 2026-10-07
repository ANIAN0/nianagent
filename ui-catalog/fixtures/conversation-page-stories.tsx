import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { LiveConversationView } from "@/features/conversation/live-conversation-view"
import { useLiveConversation } from "@/features/conversation/use-live-conversation"
import { queueOperationIssueKey } from "@/features/conversation/queue-operation-recovery"
import type { ConversationReadingPosition } from "@/features/conversation/conversation-list"
import { SessionServiceContext } from "@/features/session/session-service"
import { PermissionServiceContext } from "@/features/conversation/permissions/permission-service"
import { MaterialServiceContext } from "@/features/materials/material-service"
import { ExtensionServiceContext } from "@/features/extensions/extension-service"
import { CommandServiceContext } from "@/features/conversation/controls/command-service"
import type { HomeData } from "@/features/home/home-types"
import type { ModelConnection } from "@/features/models/model-types"
import { notifyComposer } from "@/components/composer/composer-notification"
import { Button } from "@/components/ui/button"
import {
  createConversationPageEnvironment,
  type ConversationPageScenario,
} from "./conversation-page-service"

const connections: ModelConnection[] = [
  {
    id: "page",
    name: "隔离整页示例",
    kind: "api",
    endpoint: "https://example.invalid",
    credential: "none",
    keySaved: false,
    apiKey: "",
    environmentVariable: "",
    headers: "{}",
    models: [
      {
        id: "demo",
        name: "文本示例模型",
        api: "openai-completions",
        reasoning: true,
        input: ["text"],
        supportedThinkingLevels: ["off", "low"],
      },
      {
        id: "vision",
        name: "图片示例模型",
        api: "openai-completions",
        reasoning: false,
        input: ["text", "image"],
        supportedThinkingLevels: ["off"],
      },
    ],
  },
]
const explainSettings = () =>
  notifyComposer("整页会话示例使用隔离模型目录，不打开真实模型设置。")

/** 只放数据与服务端口；整页会话 UI 与 hook 均为正式实现。 */
export function ConversationPageExample({
  scenario,
}: {
  scenario: ConversationPageScenario
}) {
  const [environment] = useState(() =>
    createConversationPageEnvironment(scenario)
  )
  const runningExample = scenario === "page-running"
  const recoveryExample = scenario === "page-recovery"
  const readyExample = scenario === "page-ready"
  const [selected, setSelected] = useState<string>(environment.sourceId)
  const [positions] = useState(
    () => new Map<string, ConversationReadingPosition>()
  )
  const chat = useLiveConversation(selected, environment.service)
  const driver = useSyncExternalStore(
    environment.subscribe,
    environment.getDriver
  )
  useEffect(() => () => environment.dispose(), [environment])
  const snapshot = chat.snapshots[selected]
  const draft = chat.drafts[selected] ?? environment.draftFor(selected)
  const data = useMemo<HomeData>(
    () => ({
      workspaces: [
        {
          id: environment.workspaceId,
          name: "整页示例",
          path: environment.cwd,
        },
      ],
      conversations: [],
      models: ["page/demo", "page/vision"],
      modelLabels: {
        "page/demo": "文本示例模型",
        "page/vision": "图片示例模型",
      },
      modelThinking: { "page/demo": ["off", "low"], "page/vision": ["off"] },
      modelInputs: { "page/demo": ["text"], "page/vision": ["text", "image"] },
      modelCatalog: {
        status: "ready",
        items: connections[0].models.map((model) => ({
          value: `page/${model.id}`,
          name: model.name,
          connection: "隔离整页示例",
          modelId: model.id,
        })),
        onRetry: () => notifyComposer("隔离模型目录已可用。"),
        onOpenSettings: explainSettings,
      },
      materialsEnabled: true,
      materials: [],
      tools: environment.tools,
    }),
    [environment]
  )
  const action = (result: Promise<unknown>) => {
    void result.catch(() => undefined)
  }
  const titleFor = () => {
    if (selected === environment.derivedId) return environment.derivedTitle
    if (selected === environment.otherId) return "另一个讨论"
    if (runningExample) return "运行中继续提出需求"
    if (recoveryExample) return "会话恢复与草稿保留讨论"
    if (readyExample) return "整页会话组合讨论"
    return "长内容阅读与窄窗继续"
  }
  const reload = () => {
    environment.recoverRead()
    chat.reload()
  }
  const canDrive = !!selected && !!snapshot && driver.readState === "available"
  return (
    <SessionServiceContext value={environment.session}>
      <PermissionServiceContext value={environment.permission}>
        <MaterialServiceContext value={environment.materials}>
          <ExtensionServiceContext value={environment.extensions}>
            <CommandServiceContext value={environment.command}>
              <div className="flex h-svh min-h-0 flex-col bg-background text-foreground">
                <div className="min-h-0 flex-1">
                  <LiveConversationView
                    key={selected}
                    id={selected}
                    title={titleFor()}
                    workspacePath={environment.cwd}
                    snapshot={snapshot}
                    readIssue={chat.readIssues[selected]}
                    readPending={chat.readPending[selected]}
                    actionIssue={chat.actionIssues[selected]}
                    draftError={chat.draftErrors[selected]}
                    receiptIssue={chat.receiptIssues[selected]}
                    queueIssues={chat.queueIssues[selected]}
                    queueRecoveryReason={chat.queueRecoveryReason[selected]}
                    queueRecoveryRecords={chat.queueRecoveryRecords.filter(
                      (value) => value.sessionId === selected
                    )}
                    queueRecoveryIssuesByRequest={
                      chat.queueRecoveryIssuesByRequest[selected]
                    }
                    queueOriginalRetryAllowed={
                      chat.queueOriginalRetryAllowedByRequest[selected]
                    }
                    queueStorageIssue={chat.queueStorageIssue}
                    queueOperationPendingByRequest={
                      chat.queueOperationPendingByRequest
                    }
                    pending={chat.pending[selected]}
                    stopPending={chat.stopPending[selected]}
                    stopUnconfirmed={chat.stopUnconfirmed[selected]}
                    pendingSubmission={chat.submissionEcho(selected)}
                    unconfirmed={chat.unconfirmed[selected]}
                    data={data}
                    draft={draft}
                    positions={positions}
                    controlService={environment.controls}
                    onChange={(value) => chat.change(selected, value)}
                    onRecoverDraft={(value) =>
                      chat.adoptRecoveredDraft(selected, value)
                    }
                    onSend={(value, delivery) =>
                      action(
                        chat.send(
                          selected,
                          value,
                          connections,
                          undefined,
                          undefined,
                          delivery
                        )
                      )
                    }
                    onStop={() => action(chat.stop(selected))}
                    onContinue={() =>
                      action(chat.retry(selected, draft, connections))
                    }
                    onReload={
                      recoveryExample && selected === environment.sourceId
                        ? reload
                        : chat.reload
                    }
                    onSaveDraft={() => chat.saveDraft(selected)}
                    onReconcile={() => action(chat.reconcile(selected))}
                    onCleanReceipt={() => chat.cleanReceipt(selected)}
                    onQueueMode={(mode) =>
                      chat.queueMode(selected, mode).catch(() => undefined)
                    }
                    onQueueEdit={(
                      itemId,
                      text,
                      materials,
                      revision,
                      clientEditId
                    ) =>
                      chat.queueEdit(
                        selected,
                        itemId,
                        text,
                        materials,
                        revision,
                        clientEditId
                      )
                    }
                    onQueueRemove={(itemId) =>
                      action(chat.queueRemove(selected, itemId))
                    }
                    onQueueDeliver={(itemId) =>
                      action(chat.queueDeliver(selected, itemId))
                    }
                    onRetryQueueOriginal={(record) =>
                      action(
                        chat.retryQueueOriginal(
                          selected,
                          queueOperationIssueKey(record),
                          record.operationRequestId
                        )
                      )
                    }
                    onOpenConversation={(id) => setSelected(id)}
                    onOpenSettings={explainSettings}
                  />
                </div>
                <details className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">演示控制</summary>
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {recoveryExample && selected === environment.sourceId && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={driver.readState !== "held"}
                        onClick={() => environment.failRead()}
                      >
                        使首次读取失败
                      </Button>
                    )}
                    {readyExample && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            snapshot?.phase !== "running" ||
                            !!snapshot.approvals?.length ||
                            driver.approvalToolSession === selected
                          }
                          onClick={() =>
                            environment.requestApproval(selected, "tool")
                          }
                        >
                          请求执行命令
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={driver.approvalPendingSession !== selected}
                          onClick={() =>
                            environment.acknowledgeApproval(selected)
                          }
                        >
                          确认收到本次决定
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={driver.approvalToolSession !== selected}
                          onClick={() =>
                            environment.completeApprovalTool(selected)
                          }
                        >
                          发布示例工具结果
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!snapshot?.approvals?.length}
                          onClick={() => environment.withdrawApproval(selected)}
                        >
                          撤回当前确认请求
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            environment.showContextReading(selected, true)
                          }
                        >
                          发布当前读数
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            environment.showContextReading(selected, false)
                          }
                        >
                          改为无对应读数
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!driver.compactActive}
                          onClick={() =>
                            environment.finishCompact(selected, "completed")
                          }
                        >
                          完成压缩并发布示例摘要
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!driver.compactActive}
                          onClick={() =>
                            environment.finishCompact(selected, "failed")
                          }
                        >
                          令压缩失败
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!driver.pending}
                      onClick={() => environment.acceptNext()}
                    >
                      {driver.pendingKind === "retry"
                        ? "确认接收继续请求"
                        : "确认接收原消息"}
                    </Button>
                    {recoveryExample && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!driver.pending}
                          onClick={() => environment.rejectNext()}
                        >
                          明确拒绝本次请求
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => environment.armRejectSend()}
                        >
                          令下次发送明确拒绝
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => environment.armUnknownSend()}
                        >
                          令下次发送结果未知
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!driver.unknown || driver.confirmable}
                          onClick={() => environment.allowOriginalReceipt()}
                        >
                          令原消息回执可确认
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!snapshot?.queue?.items.length}
                          onClick={() => environment.armQueueRemoveUnknown()}
                        >
                          令下次移除结果未知
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!driver.queueUnknown}
                          onClick={() => environment.confirmQueueReceipt()}
                        >
                          令原队列操作回执可确认
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        snapshot?.phase !== "running" ||
                        !!snapshot.approvals?.length ||
                        driver.approvalToolSession === selected
                      }
                      onClick={() => environment.generateAnswer(selected)}
                    >
                      生成回复正文
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        snapshot?.phase !== "running" ||
                        !!snapshot.approvals?.length ||
                        driver.approvalToolSession === selected
                      }
                      onClick={() => environment.finish(selected)}
                    >
                      结束本次演示工作
                    </Button>
                    {runningExample && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            snapshot?.phase !== "running" ||
                            !snapshot.queue?.items.some(
                              (item) => item.delivery === "steer"
                            )
                          }
                          onClick={() => environment.deliveryBoundary(selected)}
                        >
                          进入补充交付边界
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={snapshot?.phase !== "stopping"}
                          onClick={() => environment.stopCompleted(selected)}
                        >
                          确认本次停止完成
                        </Button>
                      </>
                    )}
                    {readyExample && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          !driver.derivedReady ||
                          selected === environment.derivedId
                        }
                        onClick={() => setSelected(environment.derivedId)}
                      >
                        打开派生会话
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selected === environment.sourceId}
                      onClick={() => setSelected(environment.sourceId)}
                    >
                      返回原会话
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canDrive}
                      onClick={() =>
                        setSelected(
                          selected === environment.otherId
                            ? environment.sourceId
                            : environment.otherId
                        )
                      }
                    >
                      {selected === environment.otherId
                        ? "切回原会话"
                        : "切到另一个会话"}
                    </Button>
                    <span>
                      隔离数据与服务，不连接真实宿主；接收、审批、压缩、分支和终态由这里驱动，不运行真实模型。
                    </span>
                  </div>
                </details>
              </div>
            </CommandServiceContext>
          </ExtensionServiceContext>
        </MaterialServiceContext>
      </PermissionServiceContext>
    </SessionServiceContext>
  )
}
