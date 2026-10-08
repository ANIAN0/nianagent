import { HomeSubmissionHost } from "@/features/home/home-submission-host"
import { PageErrorBoundary } from "@/components/feedback/page-error-boundary"
import { BoundedCache } from "@/lib/bounded-cache"
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import {
  createPermissionService,
  PermissionServiceContext,
} from "@/features/conversation/permissions/permission-service"
const permissionService = createPermissionService()
import {
  createCommandService,
  CommandServiceContext,
} from "@/features/conversation/controls/command-service"
const commandService = createCommandService()
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AppShell } from "@/features/home/app-shell"

import {
  NavigationBoundaryContext,
  useNavigationBoundaryState,
} from "@/lib/navigation/navigation-boundary"
import type { ComposerData, ComposerDraft } from "@/lib/composer/types"
import { thinkingLabels } from "@/lib/composer/model-thinking"
import { modelSelectionId } from "@/features/models/model-types"
import { useModelCatalog } from "@/features/models/use-model-catalog"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import {
  createSessionService,
  SessionServiceContext,
} from "@/features/session/session-service"
import { useWorkspaces } from "@/features/workspaces/use-workspaces"
import {
  useConversationCatalog,
  toHomeConversation,
} from "@/features/conversation/conversation-catalog-service"
import { useLiveConversation } from "@/features/conversation/use-live-conversation"
import { queueOperationIssueKey } from "@/features/conversation/queue-operation-recovery"
import type { ConversationReadingPosition } from "@/features/conversation/conversation-list"

import { useHomeSubmissionController } from "@/features/home/use-home-submission-controller"
import {
  createMaterialService,
  MaterialServiceContext,
} from "@/features/materials/material-service"

import {
  createExtensionService,
  ExtensionServiceContext,
} from "@/features/extensions/extension-service"

const ModelSettingsPage = lazy(() =>
  import("@/features/models/model-settings-page").then((module) => ({
    default: module.ModelSettingsPage,
  }))
)
const LiveConversationView = lazy(() =>
  import("@/features/conversation/live-conversation-view").then((module) => ({
    default: module.LiveConversationView,
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
  const [materialService] = useState(createMaterialService)
  const [extensionService] = useState(createExtensionService)
  const [positions] = useState(
    () => new BoundedCache<string, ConversationReadingPosition>(200)
  )
  const models = useModelCatalog(() => navigation.run(openSettings))
  const workspaces = useWorkspaces()
  const catalog = useConversationCatalog()
  const chat = useLiveConversation(selected)
  const home = useHomeSubmissionController({
    chat,
    connections: models.connections,
    workspaces,
    sessionService,
    selected,
    selectConversation,
    refreshCatalog: catalog.refresh,
  })
  const { homeSubmissions, visibleHomeSubmission, homeNavigation, notice } =
    home
  const settingsGuard = useRef<LeaveGuard | null>(null)
  const registerSettingsLeave = useCallback((guard: LeaveGuard | null) => {
    settingsGuard.current = guard
  }, [])
  const [readReceiptIssues, setReadReceiptIssues] = useState<
    Record<string, FeedbackDescription | undefined>
  >({})
  const [readReceiptRetry, setReadReceiptRetry] = useState(0)
  const readReceiptAttempts = useRef(new Set<string>())
  const readReceiptLatest = useRef(new Map<string, string>())
  function openSettings() {
    homeNavigation.leave()
    setSettingsOpen(true)
  }
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
    homeNavigation.leave()
    setSelected(id)
    home.clearNotice()
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
  const currentRunId = current?.runId
  const currentPhase = current?.phase
  const metadataUnread = metadata?.unread
  const metadataRunId = metadata?.runId
  const metadataStatus = metadata?.status
  const metadataRevision = metadata?.revision
  useEffect(() => {
    if (
      !selected ||
      !currentRunId ||
      !metadataUnread ||
      metadataRevision === undefined ||
      settingsOpen ||
      document.visibilityState === "hidden"
    )
      return
    if (
      metadataRunId !== currentRunId ||
      metadataStatus !==
        (currentPhase === "interrupted" ? "idle" : currentPhase)
    )
      return
    const identity = `${selected}:${currentRunId}:${metadataRevision}:${readReceiptRetry}`
    if (readReceiptAttempts.current.has(identity)) return
    readReceiptAttempts.current.add(identity)
    readReceiptLatest.current.set(selected, identity)
    void markRead(selected, metadataRevision)
      .then(() => {
        if (readReceiptLatest.current.get(selected) === identity)
          setReadReceiptIssues((all) => ({ ...all, [selected]: undefined }))
      })
      .catch((error) => {
        if (
          readReceiptLatest.current.get(selected) === identity &&
          !(error instanceof Error && error.name === "AbortError")
        )
          setReadReceiptIssues((all) => ({
            ...all,
            [selected]: feedbackFromError(
              error,
              "本次阅读状态未能保存，会话内容仍可使用。"
            ),
          }))
      })
  }, [
    selected,
    currentRunId,
    currentPhase,
    metadataUnread,
    metadataRunId,
    metadataStatus,
    metadataRevision,
    markRead,
    settingsOpen,
    readReceiptRetry,
  ])
  const data: ComposerData = {
    workspaces: workspaces.items,
    conversations: catalog.conversations.map(toHomeConversation),
    ...models.data,
    materials: [],
    materialsEnabled: true,
    tools: [],
  }
  const selectedConnection = models.connections.find(
    (item) => item.id === current?.connectionId
  )
  const selectedModel = selectedConnection?.models.find(
    (item) => item.id === current?.providerModelId
  )
  const currentDraft: ComposerDraft = (selected && chat.drafts[selected]) || {
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
  function action(operation: Promise<unknown>) {
    void operation
      .then(() => catalog.refresh(true))
      .catch(() => {
        /* Per-session hook retains the error next to its composer. */
      })
  }
  return (
    <PermissionServiceContext.Provider value={permissionService}>
      <CommandServiceContext.Provider value={commandService}>
        <NavigationBoundaryContext.Provider value={navigation}>
          <SessionServiceContext.Provider value={sessionService}>
            <MaterialServiceContext.Provider value={materialService}>
              <ExtensionServiceContext.Provider value={extensionService}>
                <AppShell
                  data={data}
                  activeConversationId={selected}
                  historyState={catalog.historyState}
                  historyError={catalog.historyError}
                  historyIssue={catalog.historyIssue}
                  onHistoryRetry={() => void catalog.refresh()}
                  onSettings={() => navigation.run(openSettings)}
                  onSelectConversation={(item) =>
                    leaveSettings(() => selectConversation(item.id))
                  }
                  onNew={(workspaceId) =>
                    leaveSettings(() => {
                      selectConversation()
                      home.openHome(workspaceId)
                    })
                  }
                >
                  {notice && (
                    <div className="shrink-0 px-4 py-2">
                      <OperationFeedback
                        title="首页提交已确认"
                        message={notice}
                        severity="info"
                      />
                    </div>
                  )}
                  {Object.values(homeSubmissions).some(
                    (submission) =>
                      submission.sessionId !== selected &&
                      (selected ||
                        settingsOpen ||
                        submission.sessionId !==
                          visibleHomeSubmission?.sessionId)
                  ) && (
                    <div className="shrink-0 px-4 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const submission = Object.values(
                            homeSubmissions
                          ).find(
                            (item) =>
                              item.sessionId !== selected &&
                              (selected ||
                                settingsOpen ||
                                item.sessionId !==
                                  visibleHomeSubmission?.sessionId)
                          )
                          if (!submission) return
                          leaveSettings(() => {
                            selectConversation()
                            home.openHome(submission.draft.workspaceId)
                          })
                        }}
                      >
                        有首页提交待处理 · 返回原输入
                      </Button>
                    </div>
                  )}
                  {settingsOpen && (
                    <Suspense
                      fallback={
                        <div role="status" className="p-8">
                          正在打开设置…
                        </div>
                      }
                    >
                      <PageErrorBoundary key="settings">
                        <ModelSettingsPage
                          service={models.service}
                          onReturn={() =>
                            navigation.run(() => setSettingsOpen(false))
                          }
                          onConnectionsChange={models.update}
                          registerLeave={registerSettingsLeave}
                        />
                      </PageErrorBoundary>
                    </Suspense>
                  )}
                  <div
                    className={
                      settingsOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"
                    }
                  >
                    {selected ? (
                      <Suspense
                        fallback={
                          <div
                            role="status"
                            className="p-8 text-sm text-muted-foreground"
                          >
                            正在打开会话…
                          </div>
                        }
                      >
                        <PageErrorBoundary key={selected}>
                          <LiveConversationView
                            key={selected}
                            id={selected}
                            title={
                              metadata?.title ??
                              (homeSubmissions[selected]
                                ? "新会话"
                                : "正在读取会话")
                            }
                            workspacePath={
                              metadata?.cwd ?? homeSubmissions[selected]?.cwd
                            }
                            snapshot={current}
                            readIssue={chat.readIssues[selected]}
                            readPending={chat.readPending[selected]}
                            actionIssue={chat.actionIssues[selected]}
                            draftError={chat.draftErrors[selected]}
                            receiptIssue={chat.receiptIssues[selected]}
                            onCleanReceipt={() => chat.cleanReceipt(selected)}
                            queueIssues={chat.queueIssues[selected]}
                            queueRecoveryReason={
                              chat.queueRecoveryReason[selected]
                            }
                            queueRecoveryRecords={chat.queueRecoveryRecords}
                            queueOperationPendingByRequest={
                              chat.queueOperationPendingByRequest
                            }
                            queueRecoveryIssuesByRequest={
                              chat.queueRecoveryIssuesByRequest[selected]
                            }
                            queueStorageIssue={chat.queueStorageIssue}
                            queueOriginalRetryAllowed={
                              chat.queueOriginalRetryAllowedByRequest[selected]
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
                            readReceiptIssue={
                              metadataUnread
                                ? readReceiptIssues[selected]
                                : undefined
                            }
                            onRetryReadReceipt={() =>
                              setReadReceiptRetry((value) => value + 1)
                            }
                            pending={chat.pending[selected]}
                            stopPending={chat.stopPending[selected]}
                            stopUnconfirmed={chat.stopUnconfirmed[selected]}
                            data={data}
                            draft={currentDraft}
                            positions={positions}
                            onChange={(draft) => {
                              chat.change(selected, draft)
                              home.changeFollowingDraft(draft)
                            }}
                            onSend={(draft, delivery) =>
                              action(
                                chat.send(
                                  selected,
                                  draft,
                                  models.connections,
                                  undefined,
                                  undefined,
                                  delivery
                                )
                              )
                            }
                            onStop={() => action(chat.stop(selected))}
                            onContinue={() =>
                              action(
                                chat.retry(
                                  selected,
                                  currentDraft,
                                  models.connections
                                )
                              )
                            }
                            onReload={chat.reload}
                            onOpenSettings={openSettings}
                            onRecoverDraft={(draft) =>
                              chat.adoptRecoveredDraft(selected, draft)
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
                            onSaveDraft={() => chat.saveDraft(selected)}
                            unconfirmed={chat.unconfirmed[selected]}
                            pendingSubmission={
                              chat.submissionEcho(selected) ??
                              home.submissionEcho(selected)
                            }
                            onReconcile={() => action(chat.reconcile(selected))}
                            onOpenConversation={(id) => {
                              leaveSettings(() => selectConversation(id))
                              void catalog.refresh(true)
                            }}
                            captureNavigation={homeNavigation.capture}
                          />
                        </PageErrorBoundary>
                      </Suspense>
                    ) : null}
                    {!selected && workspaces.initialLoading && (
                      <div
                        role="status"
                        aria-label="正在读取工作区"
                        className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-8 pt-24"
                      >
                        <Skeleton className="mx-auto h-8 w-44" />
                        <Skeleton className="h-28 w-full rounded-2xl" />
                      </div>
                    )}
                    <HomeSubmissionHost
                      home={home}
                      data={data}
                      unconfirmed={chat.unconfirmed}
                      settingsOpen={settingsOpen}
                      selected={selected}
                      workspaces={workspaces}
                    />
                  </div>
                </AppShell>
              </ExtensionServiceContext.Provider>
            </MaterialServiceContext.Provider>
          </SessionServiceContext.Provider>
        </NavigationBoundaryContext.Provider>
      </CommandServiceContext.Provider>
    </PermissionServiceContext.Provider>
  )
}
