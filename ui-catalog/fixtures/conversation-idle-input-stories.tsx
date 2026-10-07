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
  createIdleInputEnvironment,
  type IdleInputScenario,
  type ContextReadingScenario,
} from "./conversation-idle-input-service"

const connections: ModelConnection[] = [
  {
    id: "idle",
    name: "隔离输入示例",
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
  notifyComposer("此示例使用隔离模型目录，不打开真实模型设置。")

/** Formal UI and hook own interaction; this wrapper supplies only service ports and drivers. */
export function ConversationIdleInputExample({
  scenario,
}: {
  scenario: IdleInputScenario
}) {
  const [environment] = useState(() => createIdleInputEnvironment(scenario))
  const runningExample = scenario.startsWith("running-")
  const approvalExample = scenario.startsWith("approval-")
  const contextExample = scenario === "context-usage"
  const compactExample =
    scenario === "compact-command" || scenario === "idle-submit"
  const [selected, setSelected] = useState(environment.id)
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
  const compactOperation =
    snapshot?.control?.operation?.kind === "compact"
      ? snapshot.control.operation
      : undefined
  const compactActive =
    !!compactOperation &&
    ["running", "cancelling", "unknown"].includes(compactOperation.status)
  const draft = chat.drafts[selected] ?? environment.draftFor(selected)
  const data = useMemo<HomeData>(
    () => ({
      workspaces: [
        {
          id: environment.workspaceId,
          name: "输入示例",
          path: environment.cwd,
        },
      ],
      conversations: [],
      models: driver.missingModels.includes(selected)
        ? []
        : ["idle/demo", "idle/vision"],
      modelLabels: {
        "idle/demo": "文本示例模型",
        "idle/vision": "图片示例模型",
        "idle/removed": "已移除模型",
      },
      modelThinking: { "idle/demo": ["关闭", "低"], "idle/vision": ["关闭"] },
      modelInputs: { "idle/demo": ["text"], "idle/vision": ["text", "image"] },
      modelCatalog: {
        status: "ready",
        items: connections[0].models.map((model) => ({
          value: `idle/${model.id}`,
          name: model.name,
          connection: "隔离输入示例",
          modelId: model.id,
        })),
        onRetry: () => notifyComposer("隔离模型目录已读取。"),
        onOpenSettings: explainSettings,
      },
      materialsEnabled: true,
      materials: [],
      tools: environment.tools,
    }),
    [environment, driver.missingModels, selected]
  )
  const action = (promise: Promise<unknown>) => {
    void promise.catch(() => undefined)
  }
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
                    title={
                      selected === environment.id
                        ? runningExample
                          ? "运行中继续提出需求"
                          : approvalExample
                            ? "确认 Agent 操作"
                            : contextExample
                              ? "查看上下文用量"
                              : scenario === "compact-command"
                                ? "提交 /compact 并查看结果"
                                : "继续完善项目说明"
                        : "另一个讨论"
                    }
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
                    onReload={() => {
                      environment.allowRecordReload(selected)
                      chat.reload()
                    }}
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
                    onOpenSettings={explainSettings}
                  />
                </div>
                <details className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">演示控制</summary>
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {approvalExample && (
                      <>
                        {(scenario === "approval-extension"
                          ? (["confirm", "select", "input"] as const)
                          : (["tool"] as const)
                        ).map((kind) => (
                          <Button
                            key={kind}
                            size="sm"
                            variant="outline"
                            disabled={
                              snapshot?.phase !== "running" ||
                              !!snapshot.approvals?.length ||
                              driver.approvalToolSession === selected
                            }
                            onClick={() =>
                              environment.requestApproval(selected, kind)
                            }
                          >
                            {kind === "tool"
                              ? "请求执行命令"
                              : kind === "confirm"
                                ? "扩展请求确认"
                                : kind === "select"
                                  ? "扩展请求选择"
                                  : "扩展请求输入"}
                          </Button>
                        ))}
                        {scenario !== "approval-extension" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              snapshot?.phase !== "running" ||
                              !!snapshot.approvals?.length ||
                              driver.approvalToolSession === selected
                            }
                            onClick={() =>
                              environment.requestApproval(
                                selected,
                                "tool",
                                true
                              )
                            }
                          >
                            请求访问外部文件
                          </Button>
                        )}
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
                        {driver.approvalAnswer !== undefined && (
                          <span>已接收的回答：{driver.approvalAnswer}</span>
                        )}
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
                    {(scenario === "submission-rejected" ||
                      scenario === "running-rejected" ||
                      driver.pendingKind === "retry") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!driver.pending}
                        onClick={() => environment.rejectNext()}
                      >
                        明确拒绝本次请求
                      </Button>
                    )}
                    {(scenario === "submission-unknown" ||
                      scenario === "running-unknown") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!driver.unknown || driver.confirmable}
                        onClick={() => environment.allowOriginalReceipt()}
                      >
                        令原消息回执可确认
                      </Button>
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
                    {runningExample && (
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
                    )}
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
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={snapshot?.phase !== "stopping"}
                      onClick={() => environment.stopCompleted(selected)}
                    >
                      确认本次停止完成
                    </Button>
                    {!runningExample && !approvalExample && !contextExample && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={snapshot?.phase !== "running"}
                          onClick={() => environment.fail(selected)}
                        >
                          令本次回复失败
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={snapshot?.phase !== "running"}
                          onClick={() => environment.fail(selected, "long")}
                        >
                          令回复失败（长原因）
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={snapshot?.phase !== "running"}
                          onClick={() => environment.fail(selected, "settings")}
                        >
                          令所选模型不可用
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!driver.missingModels.includes(selected)}
                          onClick={() => environment.restoreModels(selected)}
                        >
                          恢复示例模型目录
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={snapshot?.phase !== "running"}
                          onClick={() => environment.fail(selected, "reload")}
                        >
                          令会话记录保存失败
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSelected(
                          selected === environment.id
                            ? environment.otherId
                            : environment.id
                        )
                      }
                    >
                      {selected === environment.id
                        ? "切到另一个会话"
                        : "返回原会话"}
                    </Button>
                    {contextExample && (
                      <>
                        {(
                          [
                            ["current", "发布当前读数"],
                            ["history", "恢复历史读数"],
                            ["awaiting", "改为用量待更新"],
                            ["unavailable", "改为无对应读数"],
                            ["zero", "发布有效零读数"],
                            ["overflow", "发布超容量读数"],
                          ] satisfies [ContextReadingScenario, string][]
                        ).map(([kind, label]) => (
                          <Button
                            key={kind}
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              environment.showContextReading(selected, kind)
                            }
                          >
                            {label}
                          </Button>
                        ))}
                      </>
                    )}
                    {(scenario === "auxiliary-visibility" ||
                      contextExample) && (
                      <>
                        {!contextExample && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              environment.showUsage(selected, true)
                            }
                          >
                            展示有效历史用量
                          </Button>
                        )}
                        {!contextExample && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              environment.showUsage(selected, false)
                            }
                          >
                            改为无对应读数
                          </Button>
                        )}
                        {!contextExample && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              environment.showQueue(selected, true)
                            }
                          >
                            展示待处理消息
                          </Button>
                        )}
                        {!contextExample && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              environment.showQueue(selected, false)
                            }
                          >
                            清空演示待处理列表
                          </Button>
                        )}

                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!compactActive}
                          onClick={() =>
                            environment.finishCompact(selected, "failed")
                          }
                        >
                          结束演示压缩请求
                        </Button>
                      </>
                    )}
                    {compactExample && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!compactActive}
                          onClick={() =>
                            environment.finishCompact(selected, "completed")
                          }
                        >
                          完成压缩并发布示例摘要
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!compactActive}
                          onClick={() =>
                            environment.finishCompact(selected, "failed")
                          }
                        >
                          令压缩失败
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={compactOperation?.status !== "running"}
                          onClick={() =>
                            environment.loseCompactResponse(selected)
                          }
                        >
                          令压缩结果待确认
                        </Button>
                      </>
                    )}
                    <span>
                      {runningExample
                        ? "隔离内存服务；接收、补充边界和终态由这里驱动，不运行真实模型。组件库重置清除本次演示。"
                        : "隔离内存服务；发送、压缩及继续请求的结果由这里驱动，压缩摘要为示例内容，不运行真实模型。模型目录恢复只恢复可用选择；重新读取只恢复保存结果。组件库重置清除本次演示。"}
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
