import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AppShell } from "@/features/home/app-shell"
import { HomeComposer } from "@/features/home/home-composer"
import {
  NavigationBoundaryContext,
  useNavigationBoundaryState,
} from "@/features/home/navigation-boundary"
import type { HomeData, HomeDraft } from "@/features/home/home-types"
import { thinkingLabels } from "@/features/home/model-thinking"
import { modelSelectionId } from "@/features/models/model-types"
import { useModelCatalog } from "@/features/models/use-model-catalog"
import type { LeaveGuard } from "@/features/models/connection-editor"
import {
  createSessionService,
  SessionServiceContext,
  consumeHomeSession,
} from "@/features/session/session-service"
import { useWorkspaces } from "@/features/workspaces/use-workspaces"
import {
  useConversationCatalog,
  toHomeConversation,
} from "@/features/conversation/conversation-catalog-service"
import { useLiveConversation } from "@/features/conversation/use-live-conversation"
import { LiveConversationView } from "@/features/conversation/live-conversation-view"
import type { ConversationReadingPosition } from "@/features/conversation/conversation-list"

const ModelSettingsPage = lazy(() =>
  import("@/features/models/model-settings-page").then((module) => ({
    default: module.ModelSettingsPage,
  }))
)
const selectedKey = "moon.conversation.selected.v1"
function restoreSelection() {
  try {
    return localStorage.getItem(selectedKey) || undefined
  } catch {
    return undefined
  }
}
export default function App() {
  const navigation = useNavigationBoundaryState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(restoreSelection)
  const [sessionService] = useState(createSessionService)
  const [homeDraft, setHomeDraft] = useState<{
    key: number
    workspaceId?: string
    draft?: HomeDraft
  }>({ key: 0 })
  const saveHomeDraft = useCallback(
    (draft: HomeDraft) => setHomeDraft((previous) => ({ ...previous, draft })),
    []
  )
  const [positions] = useState(
    () => new Map<string, ConversationReadingPosition>()
  )
  const models = useModelCatalog(() =>
    navigation.run(() => setSettingsOpen(true))
  )
  const workspaces = useWorkspaces()
  const catalog = useConversationCatalog()
  const chat = useLiveConversation(selected)
  const settingsGuard = useRef<LeaveGuard | null>(null)
  const registerSettingsLeave = useCallback((guard: LeaveGuard | null) => {
    settingsGuard.current = guard
  }, [])
  const [notice, setNotice] = useState("")
  function leaveSettings(action: () => void) {
    navigation.run(() => {
      const leave = () =>
        navigation.run(() => {
          setSettingsOpen(false)
          action()
        })
      if (settingsOpen && settingsGuard.current) settingsGuard.current(leave)
      else leave()
    })
  }
  function selectConversation(id?: string) {
    setSelected(id)
    setNotice("")
    try {
      if (id) localStorage.setItem(selectedKey, id)
      else localStorage.removeItem(selectedKey)
    } catch {
      /* In-memory navigation remains available. */
    }
  }
  const current = selected ? chat.snapshots[selected] : undefined
  const metadata = catalog.conversations.find((item) => item.id === selected)
  const markRead = catalog.markRead
  useEffect(() => {
    if (
      !selected ||
      !current ||
      !metadata?.unread ||
      settingsOpen ||
      document.visibilityState === "hidden"
    )
      return
    if (
      metadata.runId !== current.runId ||
      metadata.status !==
        (current.phase === "interrupted" ? "idle" : current.phase)
    )
      return
    void markRead(selected, metadata.revision).catch((error) =>
      setNotice(error instanceof Error ? error.message : String(error))
    )
  }, [selected, current, metadata, markRead, settingsOpen])
  const data: HomeData = {
    workspaces: workspaces.items,
    conversations: catalog.conversations.map(toHomeConversation),
    ...models.data,
    materials: [],
    materialsEnabled: false,
    tools: [],
  }
  const selectedConnection = models.connections.find(
    (item) => item.id === current?.connectionId
  )
  const selectedModel = selectedConnection?.models.find(
    (item) => item.id === current?.providerModelId
  )
  const currentDraft: HomeDraft = (selected && chat.drafts[selected]) || {
    sessionId: selected,
    workspaceId: current?.workspaceId ?? metadata?.workspaceId ?? "",
    text: "",
    model:
      selectedConnection && selectedModel
        ? modelSelectionId(selectedConnection, selectedModel)
        : (current?.modelId ?? ""),
    thinking: thinkingLabels[current?.thinking ?? "off"] ?? "",
    materials: [],
    session: { toolIds: [], instructionScope: "all" },
  }
  async function submitHome(draft: HomeDraft, signal?: AbortSignal) {
    const id = draft.sessionId ?? crypto.randomUUID()
    const workspace = workspaces.items.find(
      (item) => item.id === draft.workspaceId
    )
    if (!workspace || workspace.available === false)
      throw new Error("工作目录不可用，请重新选择工作区。")
    const saved = await sessionService.read(id, signal)
    const configuration =
      saved ??
      (await sessionService.apply(
        { sessionId: id, cwd: workspace.path, ...draft.session },
        signal
      ))
    signal?.throwIfAborted()
    if (configuration.unavailableToolIds.length)
      throw new Error("请在会话配置中取消不可用工具后再发送。")
    const accepted = await chat.send(id, draft, models.connections, signal)
    if (!accepted.inputAccepted)
      throw new Error(accepted.error || "消息未能开始，请检查模型配置后重试。")
    signal?.throwIfAborted()
    consumeHomeSession(workspace.path)
    selectConversation(id)
    void catalog.refresh(true)
    return ""
  }
  function action(operation: Promise<unknown>) {
    void operation
      .then(() => catalog.refresh(true))
      .catch(() => {
        /* Per-session hook retains the error next to its composer. */
      })
  }
  return (
    <NavigationBoundaryContext.Provider value={navigation}>
      <SessionServiceContext.Provider value={sessionService}>
        <AppShell
          data={data}
          activeConversationId={selected}
          historyState={catalog.historyState}
          historyError={catalog.historyError}
          onHistoryRetry={() => void catalog.refresh()}
          onSettings={() => navigation.run(() => setSettingsOpen(true))}
          onSelectConversation={(item) =>
            leaveSettings(() => selectConversation(item.id))
          }
          onNew={(workspaceId) =>
            leaveSettings(() => {
              selectConversation()
              setHomeDraft((value) => ({ key: value.key + 1, workspaceId }))
            })
          }
        >
          {(models.error || notice) && (
            <Alert
              variant="destructive"
              className="shrink-0 rounded-none border-x-0 border-t-0"
            >
              <AlertDescription>{notice || models.error}</AlertDescription>
            </Alert>
          )}
          {settingsOpen && (
            <Suspense
              fallback={
                <div role="status" className="p-8">
                  正在打开设置…
                </div>
              }
            >
              <ModelSettingsPage
                service={models.service}
                onReturn={() => navigation.run(() => setSettingsOpen(false))}
                onConnectionsChange={models.update}
                registerLeave={registerSettingsLeave}
              />
            </Suspense>
          )}
          <div
            className={settingsOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"}
          >
            {selected ? (
              <LiveConversationView
                id={selected}
                title={metadata?.title ?? "正在读取会话"}
                workspacePath={metadata?.cwd}
                snapshot={current}
                error={chat.errors[selected]}
                pending={chat.pending[selected]}
                data={data}
                draft={currentDraft}
                positions={positions}
                onChange={(draft) => chat.change(selected, draft)}
                onSend={(draft) =>
                  action(chat.send(selected, draft, models.connections))
                }
                onStop={() => action(chat.stop(selected))}
                onContinue={() =>
                  action(chat.retry(selected, currentDraft, models.connections))
                }
                onReload={chat.reload}
              />
            ) : workspaces.loading ? (
              <div
                role="status"
                aria-label="正在读取工作区"
                className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-8 pt-24"
              >
                <Skeleton className="mx-auto h-8 w-44" />
                <Skeleton className="h-28 w-full rounded-2xl" />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {workspaces.error && (
                  <Alert
                    variant="destructive"
                    className="mx-auto mt-6 max-w-3xl"
                  >
                    <AlertDescription>
                      {workspaces.error}
                      <Button
                        variant="link"
                        size="sm"
                        onClick={workspaces.refresh}
                      >
                        重新读取
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                <HomeComposer
                  key={homeDraft.key}
                  data={data}
                  initialDraft={
                    homeDraft.draft ?? {
                      workspaceId:
                        homeDraft.workspaceId ?? workspaces.selectedId,
                    }
                  }
                  onDraftChange={saveHomeDraft}
                  onSubmit={submitHome}
                  onChooseWorkspace={workspaces.choose}
                  onWorkspaceSelect={workspaces.select}
                  workspaceLoading={workspaces.loading}
                  workspaceError={workspaces.error}
                  onWorkspaceRetry={workspaces.refresh}
                />
              </div>
            )}
          </div>
        </AppShell>
      </SessionServiceContext.Provider>
    </NavigationBoundaryContext.Provider>
  )
}
