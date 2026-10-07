import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { LiveConversationView } from "@/features/conversation/live-conversation-view"
import { useLiveConversation } from "@/features/conversation/use-live-conversation"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  createExecutionEnvironment,
  type ExecutionScenario,
} from "./conversation-execution-service"

const connections: ModelConnection[] = [
  {
    id: "execution",
    name: "隔离执行示例",
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
        name: "执行示例模型",
        api: "openai-completions",
        reasoning: true,
        input: ["text"],
        supportedThinkingLevels: ["off", "low"],
      },
      {
        id: "compact",
        name: "简洁示例模型",
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        supportedThinkingLevels: ["off"],
      },
    ],
  },
]
const explainSettings = () =>
  notifyComposer("执行场景使用隔离模型目录，不打开真实模型设置。")

/** Providers and data drivers surround the complete formal conversation. */
export function ConversationExecutionExample({
  scenario,
}: {
  scenario: ExecutionScenario
}) {
  const [environment] = useState(() => createExecutionEnvironment(scenario))
  const [selected, setSelected] = useState<string | undefined>(environment.id)
  const [positions] = useState(
    () => new Map<string, ConversationReadingPosition>()
  )
  const chat = useLiveConversation(selected, environment.service)
  const driver = useSyncExternalStore(
    environment.subscribe,
    environment.getDriver
  )
  useEffect(() => () => environment.dispose(), [environment])
  useEffect(() => {
    const driveFromReading = (event: KeyboardEvent) => {
      if (
        !selected ||
        event.repeat ||
        event.isComposing ||
        !event.ctrlKey ||
        !event.altKey
      )
        return
      if (event.key === "F9") {
        event.preventDefault()
        environment.advance()
      } else if (event.key === "F10") {
        event.preventDefault()
        environment.finishReply()
      }
    }
    window.addEventListener("keydown", driveFromReading)
    return () => window.removeEventListener("keydown", driveFromReading)
  }, [environment, selected])
  const snapshot = chat.snapshots[environment.id]
  const draft = chat.drafts[environment.id] ?? environment.draft
  const data = useMemo<HomeData>(
    () => ({
      workspaces: [
        {
          id: environment.workspaceId,
          name: "执行示例",
          path: environment.cwd,
        },
      ],
      conversations: [],
      models: ["execution/demo", "execution/compact"],
      modelLabels: {
        "execution/demo": "执行示例模型",
        "execution/compact": "简洁示例模型",
      },
      modelThinking: {
        "execution/demo": ["off", "low"],
        "execution/compact": ["off"],
      },
      modelInputs: {
        "execution/demo": ["text"],
        "execution/compact": ["text"],
      },
      modelCatalog: {
        status: "ready",
        items: connections[0].models.map((model) => ({
          value: `execution/${model.id}`,
          name: model.name,
          connection: "隔离执行示例",
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
  const canDrive = !!selected && !!snapshot
  return (
    <SessionServiceContext value={environment.session}>
      <PermissionServiceContext value={environment.permission}>
        <MaterialServiceContext value={environment.materials}>
          <ExtensionServiceContext value={environment.extensions}>
            <CommandServiceContext value={environment.command}>
              <div className="flex h-svh min-h-0 flex-col bg-background text-foreground">
                <div className="min-h-0 flex-1">
                  {selected ? (
                    <LiveConversationView
                      key={selected}
                      id={selected}
                      title="查看执行过程与真实工具结果"
                      workspacePath={environment.cwd}
                      snapshot={snapshot}
                      readIssue={chat.readIssues[selected]}
                      readPending={chat.readPending[selected]}
                      actionIssue={chat.actionIssues[selected]}
                      draftError={chat.draftErrors[selected]}
                      receiptIssue={chat.receiptIssues[selected]}
                      pending={chat.pending[selected]}
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
                        environment.refresh()
                        chat.reload()
                      }}
                      onSaveDraft={() => chat.change(selected, draft)}
                      onReconcile={() => action(chat.reconcile(selected))}
                      onCleanReceipt={() => chat.cleanReceipt(selected)}
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
                      onQueueMode={(mode) => chat.queueMode(selected, mode)}
                      onOpenSettings={explainSettings}
                    />
                  ) : (
                    <Empty className="h-full">
                      <EmptyHeader>
                        <EmptyTitle>已离开会话</EmptyTitle>
                        <EmptyDescription>
                          返回后继续阅读原内容、展开选择与下一稿。
                        </EmptyDescription>
                      </EmptyHeader>
                      <Button
                        variant="outline"
                        onClick={() => setSelected(environment.id)}
                      >
                        返回会话
                      </Button>
                    </Empty>
                  )}
                </div>
                <details className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">演示控制</summary>
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canDrive || snapshot?.phase !== "running"}
                      onClick={() => environment.failReply()}
                    >
                      令本次回复失败
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canDrive || !driver.canAdvance}
                      onClick={() => environment.advance()}
                    >
                      {driver.nextLabel}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canDrive || !driver.canFinish}
                      onClick={() => environment.finishReply()}
                    >
                      直接结束回复
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!selected}
                      onClick={() => setSelected(undefined)}
                    >
                      离开会话
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!selected}
                      onClick={() => setSelected(environment.id)}
                    >
                      返回会话
                    </Button>
                    <span>
                      Ctrl+Alt+F9 下一步；Ctrl+Alt+F10
                      结束回复，可保持工具内焦点。
                    </span>
                    <span>
                      隔离手动数据，不运行模型、工具或真实写操作；重置沿组件库整页重置。
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
