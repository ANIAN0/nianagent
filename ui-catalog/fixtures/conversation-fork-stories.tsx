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
  createForkEnvironment,
  type ForkScenario,
} from "./conversation-fork-service"

const connections: ModelConnection[] = [
  {
    id: "fork",
    name: "隔离分支示例",
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
        name: "分支示例模型",
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        supportedThinkingLevels: ["off"],
      },
    ],
  },
]

const explainSettings = () =>
  notifyComposer("分支场景使用隔离模型目录，不打开真实模型设置。")

/** 只放数据与演示控制；整个会话 UI 与 hook 均为正式实现。 */
export function ConversationForkExample({
  scenario,
}: {
  scenario: ForkScenario
}) {
  const [environment] = useState(() => createForkEnvironment(scenario))
  const [selected, setSelected] = useState(environment.sourceId)
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
          name: "分支示例",
          path: environment.cwd,
        },
      ],
      conversations: [],
      models: ["fork/demo"],
      modelLabels: { "fork/demo": "分支示例模型" },
      modelThinking: { "fork/demo": ["off"] },
      modelInputs: { "fork/demo": ["text"] },
      modelCatalog: {
        status: "ready",
        items: connections[0].models.map((model) => ({
          value: `fork/${model.id}`,
          name: model.name,
          connection: "隔离分支示例",
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
                      selected === environment.derivedId
                        ? environment.derivedTitle
                        : environment.sourceTitle
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
                    onReload={() => chat.reload()}
                    onSaveDraft={() => chat.change(selected, draft)}
                    onReconcile={() => action(chat.reconcile(selected))}
                    onCleanReceipt={() => chat.cleanReceipt(selected)}
                    onOpenConversation={(id) => setSelected(id)}
                    onOpenSettings={explainSettings}
                  />
                </div>
                <details className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">演示控制</summary>
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selected === environment.sourceId}
                      onClick={() => setSelected(environment.sourceId)}
                    >
                      返回来源会话
                    </Button>
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
                    {scenario === "fork-unknown" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!driver.canConfirm}
                        onClick={() => environment.confirmForkCreated()}
                      >
                        确认分支已创建
                      </Button>
                    )}
                    {scenario === "fork-failed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!driver.canRetry}
                        onClick={() => environment.allowForkRetry()}
                      >
                        允许再次创建分支
                      </Button>
                    )}
                    <span>
                      隔离数据与服务，不连接真实宿主；分支结果只由这里推动。
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
