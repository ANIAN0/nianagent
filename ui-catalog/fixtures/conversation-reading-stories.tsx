import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { LiveConversationView } from "@/features/conversation/live-conversation-view"
import { useLiveConversation } from "@/features/conversation/use-live-conversation"
import type { ConversationReadingPosition } from "@/features/conversation/conversation-list"
import { SessionServiceContext } from "@/features/session/session-service"
import { PermissionServiceContext } from "@/features/conversation/permissions/permission-service"
import { MaterialServiceContext } from "@/features/materials/material-service"
import { ExtensionServiceContext } from "@/features/extensions/extension-service"
import { CommandServiceContext } from "@/features/conversation/controls/command-service"
import type { ComposerData } from "@/lib/composer/types"
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
  createReadingEnvironment,
  type ReadingScenario,
} from "./conversation-reading-service"

const connections: ModelConnection[] = [
  {
    id: "reading",
    name: "隔离阅读示例",
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
        name: "阅读示例模型",
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
  notifyComposer("阅读场景使用隔离模型目录，不打开真实模型设置。")

/** Only data and environment controls live here; the entire reading UI is formal. */
export function ConversationReadingExample({
  scenario,
}: {
  scenario: ReadingScenario
}) {
  const [environment] = useState(() => createReadingEnvironment(scenario))
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
  const snapshot = chat.snapshots[environment.id]
  const draft = chat.drafts[environment.id] ?? environment.draft
  const data = useMemo<ComposerData>(
    () => ({
      workspaces: [
        {
          id: environment.workspaceId,
          name: "阅读示例",
          path: environment.cwd,
        },
      ],
      conversations: [],
      models: ["reading/demo", "reading/compact"],
      modelLabels: {
        "reading/demo": "阅读示例模型",
        "reading/compact": "简洁示例模型",
      },
      modelThinking: {
        "reading/demo": ["off", "low"],
        "reading/compact": ["off"],
      },
      modelInputs: { "reading/demo": ["text"], "reading/compact": ["text"] },
      modelCatalog: {
        status: "ready",
        items: connections[0].models.map((model) => ({
          value: `reading/${model.id}`,
          name: model.name,
          connection: "隔离阅读示例",
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
                  {selected ? (
                    <LiveConversationView
                      key={selected}
                      id={selected}
                      title={
                        scenario.startsWith("materials")
                          ? "项目材料查看讨论"
                          : "项目阅读与定位讨论"
                      }
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
                      onReload={reload}
                      onSaveDraft={() => chat.change(selected, draft)}
                      onReconcile={() => action(chat.reconcile(selected))}
                      onCleanReceipt={() => chat.cleanReceipt(selected)}
                      onOpenSettings={explainSettings}
                    />
                  ) : (
                    <Empty className="h-full">
                      <EmptyHeader>
                        <EmptyTitle>已离开会话</EmptyTitle>
                        <EmptyDescription>
                          返回后继续阅读原内容与草稿。
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
                    {scenario === "initial-read-recovery" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={driver.readState !== "held" || !selected}
                        onClick={() => environment.failRead()}
                      >
                        使首次读取失败
                      </Button>
                    )}
                    {scenario === "cached-read-recovery" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canDrive}
                        onClick={() => {
                          environment.failRead()
                          chat.reload()
                        }}
                      >
                        使刷新失败
                      </Button>
                    )}
                    {scenario === "streaming-history" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canDrive || driver.streaming}
                          onClick={() => environment.startReply()}
                        >
                          开始回复增长
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canDrive || !driver.streaming}
                          onClick={() => environment.appendReply()}
                        >
                          追加一段回复
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canDrive || !driver.streaming}
                          onClick={() => environment.finishReply()}
                        >
                          结束回复
                        </Button>
                      </>
                    )}
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
                      隔离数据与服务；增长和故障由这里手动触发，不连接真实宿主。
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
