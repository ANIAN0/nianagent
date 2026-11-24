import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
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
import { GitBranch } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { notifyToast } from "@/components/ui/notification-toast"
import { feedbackFromError } from "@/lib/operation-issue"
import { AppShell } from "@/features/home/app-shell"
import { ConversationArchiveDialog } from "@/features/home/conversation-archive-dialog"
import { ConversationRenameDialog } from "@/features/home/conversation-rename-dialog"
import {
  conversationHasPending,
  conversationIsRunning,
} from "@/features/home/conversation-history-layout"
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
  waitForArchiveReady,
} from "@/features/conversation/conversation-catalog-service"
import { ConversationLoading } from "@/features/conversation/conversation-loading"
import { buildLineageGraph } from "@/features/conversation/lineage-graph"
import { useSessionValue } from "@/features/conversation/session-value-store"

const ConversationLineageCanvas = lazy(() =>
  import("@/features/conversation/conversation-lineage-canvas").then((m) => ({
    default: m.ConversationLineageCanvas,
  }))
)
import { useLiveConversation } from "@/features/conversation/use-live-conversation"
import { useConversationReadReceipts } from "@/features/conversation/use-conversation-read-receipts"
import { queueOperationIssueKey } from "@/features/conversation/queue-operation-recovery"
import type { ConversationReadingPosition } from "@/features/conversation/conversation-list"
import { useHomeSubmissionController } from "@/features/home/use-home-submission-controller"
import { createMaterialService } from "@/features/materials/material-service"
import { hasRetainedUploadSources } from "@/lib/composer/upload-retry-sources"
import { createExtensionService } from "@/features/extensions/extension-service"
import { isRemoteWeb } from "@/lib/rpc/remote-transport"

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
const loadLiveConversationView = () =>
  import("@/features/conversation/live-conversation-view").then((m) => ({
    default: m.LiveConversationView,
  }))
const LiveConversationView = lazy(loadLiveConversationView)

function SecondaryViewLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden p-6 max-md:pt-16"
    >
      <Skeleton className="h-6 w-28 shrink-0" />
      <Skeleton className="h-10 w-80 max-w-full shrink-0" />
      {[1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-14 w-full max-w-3xl shrink-0" />
      ))}
    </div>
  )
}

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
    openGeneralSettings,
    openArchivedSettings,
    openPlugins,
    leaveSettings,
    selectConversation,
  } = nav

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
  const catalog = useConversationCatalog()
  // 相对时间标签每 30 秒重算；条目引用只在目录实际变化时更换，
  // 避免轮询反复触发侧栏列表整列重渲染。
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

  const data: ComposerData = {
    workspaces: workspaces.items,
    conversations: homeConversations,
    ...models.data,
    materials: [],
    materialsEnabled: true,
    tools: [],
  }
  const retainedHomeSubmissions = Object.values(homeSubmissions).filter(
    (s) =>
      (s.sessionId !== selected || !home.submissionPending[selected]) &&
      (selected ||
        view !== "conversation" ||
        s.sessionId !== visibleHomeSubmission?.sessionId)
  )

  const archiving = useRef(new Set<string>())
  const currentSelection = useRef(selected)
  useLayoutEffect(() => {
    currentSelection.current = selected
  }, [selected])
  const { setArchived, refresh: refreshCatalog } = catalog
  const archiveConversation = useCallback(
    async (conversation: Conversation, confirmed: boolean) => {
      const { id, title, runId } = conversation
      if (archiving.current.has(id)) return
      archiving.current.add(id)
      if (confirmed) {
        setRowActionPending(true)
        setRowActionIssue(undefined)
      }
      try {
        if (confirmed && runId) await waitForArchiveReady(id, runId)
        await setArchived(id, true, runId)
        if (confirmed) setArchiveTarget(null)
        if (currentSelection.current === id) selectConversation(undefined)
        void refreshCatalog(true)
        const toastId = `conversation-archived-${id}`
        notifyToast(`已归档「${title}」`, {
          id: toastId,
          actions: (
            <>
              <button
                type="button"
                onClick={() => {
                  toast.dismiss(toastId)
                  void setArchived(id, false)
                    .then(() => refreshCatalog(true))
                    .catch((error) =>
                      notifyToast(
                        feedbackFromError(error, "撤销归档未能完成。").message,
                        { tone: "error" }
                      )
                    )
                }}
              >
                撤销
              </button>
              {!isRemoteWeb() && (
                <button
                  type="button"
                  onClick={() => {
                    toast.dismiss(toastId)
                    navigation.run(openArchivedSettings)
                  }}
                >
                  查看已归档
                </button>
              )}
            </>
          ),
        })
      } catch (error) {
        void refreshCatalog(true)
        const message = feedbackFromError(error, "会话归档未能完成。").message
        if (confirmed) setRowActionIssue(message)
        else notifyToast(message, { tone: "error" })
      } finally {
        archiving.current.delete(id)
        if (confirmed) setRowActionPending(false)
      }
    },
    [
      setArchived,
      refreshCatalog,
      selectConversation,
      navigation,
      openArchivedSettings,
    ]
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
        if (
          conversationIsRunning(conversation) ||
          conversationHasPending(conversation)
        ) {
          setRowActionIssue(undefined)
          setArchiveTarget(conversation)
        } else void archiveConversation(conversation, false)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.setPinned, catalog.refresh, archiveConversation]
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
        activeConversationId={pluginsOpen ? undefined : selected}
        historyState={catalog.historyState}
        historyError={catalog.historyError}
        historyIssue={catalog.historyIssue}
        onHistoryRetry={() => void catalog.refresh()}
        onSettings={() => navigation.run(openGeneralSettings)}
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
        activeNav={pluginsOpen ? "plugins" : undefined}
        hideNavigation={settingsOpen}
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
          <Suspense fallback={<SecondaryViewLoading label="正在打开设置" />}>
            <PageErrorBoundary key="settings">
              <SettingsPage
                section={settingsSection}
                onSectionChange={setSettingsSection}
                service={models.service}
                onReturn={() => leaveSettings(() => {})}
                onConnectionsChange={models.update}
                registerLeave={registerSettingsLeave}
                workspaces={workspaces}
                pendingConversations={homeConversations.filter(
                  conversationHasPending
                )}
                onOpenConversation={(id) =>
                  leaveSettings(() => selectConversation(id))
                }
                onUnarchived={() => void catalog.refresh(true)}
              />
            </PageErrorBoundary>
          </Suspense>
        )}
        {pluginsOpen && (
          <div className="flex min-h-0 flex-1 flex-col">
            <Suspense fallback={<SecondaryViewLoading label="正在打开插件" />}>
              <PageErrorBoundary key="plugins">
                <PluginWorkbench
                  active={pluginsOpen}
                  onReturn={() => leaveSettings(() => {})}
                />
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
            <Suspense fallback={<ConversationLoading />}>
              <PageErrorBoundary key={selected}>
                <SelectedConversation
                  selected={selected}
                  view={view}
                  chat={chat}
                  home={home}
                  data={data}
                  models={models}
                  catalog={catalog}
                  positions={positions}
                  openSettings={openSettings}
                  leaveSettings={leaveSettings}
                  selectConversation={selectConversation}
                />
              </PageErrorBoundary>
            </Suspense>
          ) : null}
          <HomeSubmissionHost
            preloadConversation={loadLiveConversationView}
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
        onConfirm={(conversation) =>
          void archiveConversation(conversation, true)
        }
        onClose={() => {
          if (!rowActionPending) setArchiveTarget(null)
        }}
      />
    </AppProviders>
  )
}

function renderTurnDeliveries(
  records: import("@/contracts/rpc.generated").ExtensionPresentation[]
) {
  return <PluginDeliveryList records={records} />
}

function SelectedConversation({
  selected,
  view,
  chat,
  home,
  data,
  models,
  catalog,
  positions,
  openSettings,
  leaveSettings,
  selectConversation,
}: {
  selected: string
  view: ReturnType<typeof useAppNavigation>["view"]
  chat: ReturnType<typeof useLiveConversation>
  home: ReturnType<typeof useHomeSubmissionController>
  data: ComposerData
  models: ReturnType<typeof useModelCatalog>
  catalog: ReturnType<typeof useConversationCatalog>
  positions: BoundedCache<string, ConversationReadingPosition>
  openSettings: ReturnType<typeof useAppNavigation>["openSettings"]
  leaveSettings: ReturnType<typeof useAppNavigation>["leaveSettings"]
  selectConversation: ReturnType<typeof useAppNavigation>["selectConversation"]
}) {
  const { homeSubmissions, homeNavigation } = home
  const homeEcho = home.submissionEcho(selected)
  const refresh = catalog.refresh
  const openConversation = useCallback(
    (id: string) => {
      leaveSettings(() => selectConversation(id))
      void refresh(true)
    },
    [leaveSettings, refresh, selectConversation]
  )
  const current = useSessionValue(chat.snapshotStore, selected)
  const storedDraft = useSessionValue(chat.draftStore, selected)
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

  const selectedConnection = models.connections.find(
    (item) => item.id === current?.connectionId
  )
  const selectedModel = selectedConnection?.models.find(
    (item) => item.id === current?.providerModelId
  )
  const currentDraft: ComposerDraft = (selected &&
    (storedDraft?.workspaceId
      ? storedDraft
      : (home.followingDraft(selected) ?? storedDraft))) || {
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
  const [lineageOpen, setLineageOpen] = useState(false)
  const lineageCount = useMemo(() => {
    const graph = buildLineageGraph(selected, catalog.conversations)
    return graph?.nodes.length ?? 1
  }, [selected, catalog.conversations])

  if (lineageOpen) {
    return (
      <Suspense fallback={<SecondaryViewLoading label="正在打开分支关系" />}>
        <ConversationLineageCanvas
          key={selected}
          sessionId={selected}
          onReturn={() => setLineageOpen(false)}
          onOpenConversation={(id) => {
            setLineageOpen(false)
            openConversation(id)
          }}
        />
      </Suspense>
    )
  }

  return (
    <PluginSessionHost
      key={selected}
      snapshot={current}
      onReload={chat.reload}
      sessionId={selected}
      cwd={
        current?.cwd ?? metadata?.cwd ?? homeSubmissions[selected]?.cwd ?? ""
      }
      active={view === "conversation" && !!(current || metadata)}
      onMaterial={(material) => {
        const draft = chat.updateDraft(selected, currentDraft, (latest) => ({
          ...latest,
          materials: appendPreparedMaterials(latest.materials, [material]),
        }))
        home.changeFollowingDraft(draft)
      }}
    >
      <LiveConversationView
        key={selected}
        id={selected}
        title={metadata?.title}
        workspacePath={metadata?.cwd ?? homeSubmissions[selected]?.cwd}
        snapshot={current}
        data={data}
        draft={currentDraft}
        positions={positions}
        captureNavigation={homeNavigation.capture}
        headerActions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size={lineageCount > 1 ? "sm" : "icon-sm"}
                  aria-label="打开分支关系画板"
                  onClick={() => setLineageOpen(true)}
                >
                  <GitBranch />
                  {lineageCount > 1 && (
                    <span className="text-xs tabular-nums">{lineageCount}</span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>分支关系画板</TooltipContent>
            </Tooltip>
            <PluginSidebarToggle />
          </>
        }
        renderTurnDeliveries={renderTurnDeliveries}
        status={{
          readIssue: chat.readIssues[selected],
          readPending: chat.readPending[selected],
          actionIssue: chat.actionIssues[selected],
          draftError: chat.draftErrors[selected],
          receiptIssue: chat.receiptIssues[selected],
          readReceiptIssue: readReceipts.issue,
          pending: !!(
            chat.pending[selected] || home.submissionPending[selected]
          ),
          checkingReceipt:
            chat.pending[selected] === "reconcile" ||
            !!(homeEcho && home.submissionPending[selected]),
          stopPending: chat.stopPending(current),
          stopUnconfirmed: chat.stopUnconfirmed(current),
          unconfirmed:
            chat.unconfirmed[selected] ||
            current?.issue?.code === "result_unknown" ||
            !!homeEcho,
          pendingSubmission: chat.submissionEcho(selected) ?? homeEcho,
        }}
        queue={{
          issues: chat.queueIssues[selected],
          recoveryReason: chat.queueRecoveryReason[selected],
          recoveryRecords: chat.queueRecoveryRecords,
          operationPendingByRequest: chat.queueOperationPendingByRequest,
          recoveryIssuesByRequest: chat.queueRecoveryIssuesByRequest[selected],
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
          onEdit: (itemId, text, materials, revision, clientEditId) =>
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
          onRemove: (itemId) => action(chat.queueRemove(selected, itemId)),
          onDeliver: (itemId) => action(chat.queueDeliver(selected, itemId)),
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
            action(chat.retry(selected, currentDraft, models.connections)),
          onReload: chat.reload,
          onOpenSettings: openSettings,
          onRecoverDraft: (draft) => chat.adoptRecoveredDraft(selected, draft),
          onSaveDraft: () => chat.saveDraft(selected),
          onCleanReceipt: () => chat.cleanReceipt(selected),
          onRetryReadReceipt: readReceipts.retry,
          onReconcile: () =>
            action(
              home.submissionEcho(selected)
                ? home.checkHomeSubmission(selected, false)
                : chat.reconcile(selected)
            ),
          onOpenConversation: openConversation,
        }}
      />
    </PluginSessionHost>
  )
}
