import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { AppProviders } from "@/app-providers"
import { useAppNavigation, type AppNavigationHooks } from "@/use-app-navigation"
import { MaintenanceStatus } from "@/features/settings/maintenance-status"
import {
  frontendBlocker,
  useMaintenanceSave,
} from "@/lib/maintenance/maintenance-coordinator"
import { HomeSubmissionHost } from "@/features/home/home-submission-host"
import { PageErrorBoundary } from "@/components/feedback/page-error-boundary"
import { BoundedCache } from "@/lib/bounded-cache"
import { createPermissionService } from "@/features/conversation/permissions/permission-service"
import { createCommandService } from "@/features/conversation/controls/command-service"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { notifyToast } from "@/components/ui/notification-toast"
import { rpcCall } from "@/lib/rpc/client"
import { feedbackFromError } from "@/lib/operation-issue"
import { AppShell } from "@/features/home/app-shell"
import { ConversationArchiveDialog } from "@/features/home/conversation-archive-dialog"
import { ConversationRenameDialog } from "@/features/home/conversation-rename-dialog"
import type { ConversationRowActions } from "@/features/home/conversation-row-menu"
import {
  PluginDeliveryList,
  PluginSessionHost,
} from "@/features/plugins/plugin-workspace"
import { PluginSidebarToggle } from "@/features/plugins/plugin-sidebar"
import { appendPreparedMaterials } from "@/lib/composer/material-service-port"
import { useNavigationBoundaryState } from "@/lib/navigation/navigation-boundary"
import type {
  ComposerData,
  ComposerDraft,
  Conversation,
} from "@/lib/composer/types"
import { thinkingLabels } from "@/lib/composer/model-thinking"
import { modelSelectionId } from "@/features/models/model-types"
import { useModelCatalog } from "@/features/models/use-model-catalog"
import { createSessionService } from "@/features/session/session-service"
import { useWorkspaces } from "@/features/workspaces/use-workspaces"
import {
  useConversationCatalog,
  toHomeConversation,
} from "@/features/conversation/conversation-catalog-service"
import { useLiveConversation } from "@/features/conversation/use-live-conversation"
import { useConversationReadReceipts } from "@/features/conversation/use-conversation-read-receipts"
import { queueOperationIssueKey } from "@/features/conversation/queue-operation-recovery"
import type { ConversationReadingPosition } from "@/features/conversation/conversation-list"
import { useHomeSubmissionController } from "@/features/home/use-home-submission-controller"
import { createMaterialService } from "@/features/materials/material-service"
import { hasRetainedUploadSources } from "@/lib/composer/upload-retry-sources"
import { createExtensionService } from "@/features/extensions/extension-service"

const permissionService = createPermissionService()
const commandService = createCommandService()
const SettingsPage = lazy(() =>
  import("@/features/settings/settings-page").then((m) => ({
    default: m.SettingsPage,
  }))
)
const PluginWorkbench = lazy(() =>
  import("@/features/plugins/plugin-settings").then((m) => ({
    default: m.PluginWorkbench,
  }))
)
const LiveConversationView = lazy(() =>
  import("@/features/conversation/live-conversation-view").then((m) => ({
    default: m.LiveConversationView,
  }))
)

export default function App() {
  const navigation = useNavigationBoundaryState()
  const navHooksRef = useRef<AppNavigationHooks>({})
  const nav = useAppNavigation(navigation, navHooksRef)
  const {
    view,
    selected,
    settingsOpen,
    pluginsOpen,
    settingsSection,
    setSettingsSection,
    registerSettingsLeave,
    openSettings,
    openPlugins,
    leaveSettings,
    selectConversation,
  } = nav

  const [archivedOnly, setArchivedOnly] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Conversation | null>(null)
  const [rowActionPending, setRowActionPending] = useState(false)
  const [rowActionIssue, setRowActionIssue] = useState<string | undefined>(
    undefined
  )

  const [sessionService] = useState(createSessionService)
  const [materialService] = useState(createMaterialService)
  useMaintenanceSave(() =>
    hasRetainedUploadSources(materialService)
      ? [
          frontendBlocker(
            "retained-upload-files",
            "仍有粘贴或拖入图片仅保存在窗口中，请完成准备、移除或等待临时源正常过期后再维护。"
          ),
        ]
      : []
  )
  const [extensionService] = useState(createExtensionService)
  const [positions] = useState(
    () => new BoundedCache<string, ConversationReadingPosition>(200)
  )
  const models = useModelCatalog(() => navigation.run(openSettings))
  const workspaces = useWorkspaces()
  const catalog = useConversationCatalog(
    undefined,
    archivedOnly ? "only" : "hide"
  )
  // 相对时间标签每 30 秒重算；条目引用只在目录实际变化时更换，
  // 侧栏列表因此不会被 2 秒轮询整列重渲染。
  const [labelTick, setLabelTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(
      () => setLabelTick((value) => value + 1),
      30000
    )
    return () => window.clearInterval(timer)
  }, [])
  const homeConversations = useMemo(
    () => catalog.conversations.map(toHomeConversation),
    // labelTick 是刻意的刷新信号：每 30 秒重算相对时间标签。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.conversations, labelTick]
  )
  const chat = useLiveConversation(selected, undefined, materialService)
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
  useEffect(() => {
    navHooksRef.current = {
      onBeforeNavigate: homeNavigation.leave,
      onSelectConversation: home.clearNotice,
    }
  })

  const current = selected ? chat.snapshots[selected] : undefined
  const metadata = catalog.conversations.find((item) => item.id === selected)
  const readReceipts = useConversationReadReceipts({
    selected,
    currentRunId: current?.runId,
    currentPhase: current?.phase,
    metadataUnread: metadata?.unread,
    metadataRunId: metadata?.runId,
    metadataStatus: metadata?.status,
    metadataRevision: metadata?.revision,
    settingsOpen: view !== "conversation",
    markRead: catalog.markRead,
  })

  const data: ComposerData = {
    workspaces: workspaces.items,
    conversations: homeConversations,
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
  const currentDraft: ComposerDraft = (selected &&
    (chat.drafts[selected]?.workspaceId
      ? chat.drafts[selected]
      : (home.followingDraft(selected) ?? chat.drafts[selected]))) || {
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
  const retainedHomeSubmissions = Object.values(homeSubmissions).filter(
    (s) =>
      (s.sessionId !== selected || !home.submissionPending[selected]) &&
      (selected ||
        view !== "conversation" ||
        s.sessionId !== visibleHomeSubmission?.sessionId)
  )

  // 行菜单动作；目录动作引用稳定，菜单实例不随会话重渲染抖动。
  const rowActions = useMemo<ConversationRowActions>(
    () => ({
      onTogglePin: (conversation) => {
        void catalog
          .setPinned(conversation.id, !conversation.pinned)
          .then(() => catalog.refresh(true))
          .catch((error) =>
            notifyToast(
              feedbackFromError(error, "置顶状态未能保存。").message,
              { tone: "error" }
            )
          )
      },
      onRename: (conversation) => {
        setRowActionIssue(undefined)
        setRenameTarget(conversation)
      },
      onArchive: (conversation) => {
        setRowActionIssue(undefined)
        setArchiveTarget(conversation)
      },
      onUnarchive: (conversation) => {
        void catalog
          .setArchived(conversation.id, false)
          .then(() => catalog.refresh(true))
          .catch((error) =>
            notifyToast(
              feedbackFromError(error, "恢复会话未能完成。").message,
              { tone: "error" }
            )
          )
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.setPinned, catalog.setArchived, catalog.refresh]
  )
  async function confirmRename(conversation: Conversation, title: string) {
    setRowActionPending(true)
    setRowActionIssue(undefined)
    try {
      await catalog.rename(conversation.id, title)
      setRenameTarget(null)
    } catch (error) {
      setRowActionIssue(
        feedbackFromError(error, "会话重命名未能保存。").message
      )
    } finally {
      setRowActionPending(false)
    }
  }
  async function confirmArchive(conversation: Conversation) {
    setRowActionPending(true)
    setRowActionIssue(undefined)
    try {
      if (conversation.status === "running") {
        const summary = catalog.conversations.find(
          (item) => item.id === conversation.id
        )
        if (!summary?.runId)
          throw new Error("缺少运行标识，请先在会话内停止后再归档。")
        await rpcCall("conversationStop", {
          sessionId: conversation.id,
          runId: summary.runId,
        })
      }
      await catalog.setArchived(conversation.id, true)
      setArchiveTarget(null)
      if (selected === conversation.id) selectConversation(undefined)
      const archivedToastId = `conversation-archived-${conversation.id}`
      notifyToast(`已归档「${conversation.title}」`, {
        id: archivedToastId,
        actions: (
          <>
            <button
              type="button"
              onClick={() => {
                toast.dismiss(archivedToastId)
                void catalog
                  .setArchived(conversation.id, false)
                  .then(() => catalog.refresh(true))
              }}
            >
              撤销
            </button>
            <button
              type="button"
              onClick={() => {
                toast.dismiss(archivedToastId)
                setArchivedOnly(true)
              }}
            >
              查看已归档
            </button>
          </>
        ),
      })
    } catch (error) {
      setRowActionIssue(feedbackFromError(error, "会话归档未能完成。").message)
    } finally {
      setRowActionPending(false)
    }
  }

  return (
    <AppProviders
      permissionService={permissionService}
      commandService={commandService}
      navigation={navigation}
      sessionService={sessionService}
      materialService={materialService}
      extensionService={extensionService}
    >
      <AppShell
        data={data}
        activeConversationId={selected}
        historyState={catalog.historyState}
        historyError={catalog.historyError}
        historyIssue={catalog.historyIssue}
        onHistoryRetry={() => void catalog.refresh()}
        onSettings={() => navigation.run(openSettings)}
        onPlugins={() => navigation.run(openPlugins)}
        onSelectConversation={(item) =>
          leaveSettings(() => selectConversation(item.id))
        }
        onNew={(workspaceId) =>
          leaveSettings(() => {
            if (home.openNewHome(workspaceId)) selectConversation()
          })
        }
        rowActions={rowActions}
        archivedView={archivedOnly}
        onLeaveArchivedView={() => setArchivedOnly(false)}
        activeNav={pluginsOpen ? "plugins" : undefined}
      >
        <MaintenanceStatus />
        {notice && (
          <div className="shrink-0 px-4 py-2">
            <OperationFeedback
              title="首页提示"
              message={notice}
              severity="info"
            />
          </div>
        )}
        {retainedHomeSubmissions.length > 0 && (
          <div className="shrink-0 px-4 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const submission = retainedHomeSubmissions[0]
                if (!submission) return
                leaveSettings(() => {
                  if (
                    home.openHome(
                      submission.draft.workspaceId,
                      submission.sessionId
                    )
                  )
                    selectConversation()
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
              <SettingsPage
                section={settingsSection}
                onSectionChange={setSettingsSection}
                service={models.service}
                onReturn={() => leaveSettings(() => {})}
                onConnectionsChange={models.update}
                registerLeave={registerSettingsLeave}
              />
            </PageErrorBoundary>
          </Suspense>
        )}
        {pluginsOpen && (
          <div className="flex min-h-0 flex-1 flex-col">
            <Suspense
              fallback={
                <div role="status" className="p-8">
                  正在打开插件…
                </div>
              }
            >
              <PageErrorBoundary key="plugins">
                <PluginWorkbench active={pluginsOpen} />
              </PageErrorBoundary>
            </Suspense>
          </div>
        )}
        <div
          className={
            view !== "conversation" ? "hidden" : "flex min-h-0 flex-1 flex-col"
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
                <PluginSessionHost
                  key={selected}
                  snapshot={current}
                  onReload={chat.reload}
                  sessionId={selected}
                  cwd={
                    current?.cwd ??
                    metadata?.cwd ??
                    homeSubmissions[selected]?.cwd ??
                    ""
                  }
                  active={view === "conversation" && !!(current || metadata)}
                  onMaterial={(material) => {
                    const draft = chat.updateDraft(
                      selected,
                      currentDraft,
                      (latest) => ({
                        ...latest,
                        materials: appendPreparedMaterials(latest.materials, [
                          material,
                        ]),
                      })
                    )
                    home.changeFollowingDraft(draft)
                  }}
                >
                  <LiveConversationView
                    key={selected}
                    id={selected}
                    title={
                      metadata?.title ??
                      (homeSubmissions[selected] ? "新会话" : "正在读取会话")
                    }
                    workspacePath={
                      metadata?.cwd ?? homeSubmissions[selected]?.cwd
                    }
                    snapshot={current}
                    data={data}
                    draft={currentDraft}
                    positions={positions}
                    captureNavigation={homeNavigation.capture}
                    headerActions={<PluginSidebarToggle />}
                    renderTurnDeliveries={(records) => (
                      <PluginDeliveryList records={records} />
                    )}
                    status={{
                      readIssue: chat.readIssues[selected],
                      readPending: chat.readPending[selected],
                      actionIssue: chat.actionIssues[selected],
                      draftError: chat.draftErrors[selected],
                      receiptIssue: chat.receiptIssues[selected],
                      readReceiptIssue: readReceipts.issue,
                      pending:
                        chat.pending[selected] ||
                        home.submissionPending[selected],
                      stopPending: chat.stopPending[selected],
                      stopUnconfirmed: chat.stopUnconfirmed[selected],
                      unconfirmed:
                        chat.unconfirmed[selected] ||
                        current?.issue?.code === "result_unknown" ||
                        !!home.submissionEcho(selected),
                      pendingSubmission:
                        chat.submissionEcho(selected) ??
                        home.submissionEcho(selected),
                    }}
                    queue={{
                      issues: chat.queueIssues[selected],
                      recoveryReason: chat.queueRecoveryReason[selected],
                      recoveryRecords: chat.queueRecoveryRecords,
                      operationPendingByRequest:
                        chat.queueOperationPendingByRequest,
                      recoveryIssuesByRequest:
                        chat.queueRecoveryIssuesByRequest[selected],
                      storageIssue: chat.queueStorageIssue,
                      originalRetryAllowed:
                        chat.queueOriginalRetryAllowedByRequest[selected],
                      onRetryOriginal: (record) =>
                        action(
                          chat.retryQueueOriginal(
                            selected,
                            queueOperationIssueKey(record),
                            record.operationRequestId
                          )
                        ),
                      onEdit: (
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
                        ),
                      onItemRead: (itemId, signal) =>
                        chat.queueItemRead(selected, itemId, signal),
                      onRemove: (itemId) =>
                        action(chat.queueRemove(selected, itemId)),
                      onDeliver: (itemId) =>
                        action(chat.queueDeliver(selected, itemId)),
                    }}
                    actions={{
                      onChange: (draft) => {
                        chat.change(selected, draft)
                        home.changeFollowingDraft(draft)
                      },
                      onSend: (draft, delivery) =>
                        action(
                          chat.send(
                            selected,
                            draft,
                            models.connections,
                            undefined,
                            undefined,
                            delivery
                          )
                        ),
                      onStop: () => action(chat.stop(selected)),
                      onContinue: () =>
                        action(
                          chat.retry(selected, currentDraft, models.connections)
                        ),
                      onReload: chat.reload,
                      onOpenSettings: openSettings,
                      onRecoverDraft: (draft) =>
                        chat.adoptRecoveredDraft(selected, draft),
                      onSaveDraft: () => chat.saveDraft(selected),
                      onCleanReceipt: () => chat.cleanReceipt(selected),
                      onRetryReadReceipt: readReceipts.retry,
                      onReconcile: () =>
                        action(
                          home.submissionEcho(selected)
                            ? home.checkHomeSubmission(selected, false)
                            : chat.reconcile(selected)
                        ),
                      onOpenConversation: (id) => {
                        leaveSettings(() => selectConversation(id))
                        void catalog.refresh(true)
                      },
                    }}
                  />
                </PluginSessionHost>
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
            settingsOpen={view !== "conversation"}
            selected={selected}
            workspaces={workspaces}
          />
        </div>
      </AppShell>
      <ConversationRenameDialog
        conversation={renameTarget}
        pending={rowActionPending}
        issue={rowActionIssue}
        onRename={confirmRename}
        onClose={() => setRenameTarget(null)}
      />
      <ConversationArchiveDialog
        conversation={archiveTarget}
        pending={rowActionPending}
        issue={rowActionIssue}
        onConfirm={confirmArchive}
        onClose={() => setArchiveTarget(null)}
      />
    </AppProviders>
  )
}
