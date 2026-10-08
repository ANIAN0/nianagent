import { useCallback } from "react"
import { HomeComposer, type HomeComposerProps } from "./home-composer"
import type { ComposerData, ComposerDraft } from "@/lib/composer/types"
import type { useHomeSubmissionController } from "./use-home-submission-controller"
import type { useWorkspaces } from "@/features/workspaces/use-workspaces"
import { persistentHomeDraftStore } from "@/features/conversation/conversation-draft-store"
import { HomeSubmissionFeedback } from "./home-submission-feedback"

function OwnedHomeComposer({
  viewKey,
  onOwnedDraftChange,
  onOwnedSelectionActivity,
  ...props
}: Omit<HomeComposerProps, "onDraftChange" | "onMaterialSelectionActivity"> & {
  viewKey: number
  onOwnedDraftChange: (draft: ComposerDraft, viewKey: number) => void
  onOwnedSelectionActivity: (
    sessionId: string,
    active: boolean,
    viewKey: number
  ) => void
}) {
  const onDraftChange = useCallback(
    (draft: ComposerDraft) => onOwnedDraftChange(draft, viewKey),
    [onOwnedDraftChange, viewKey]
  )
  const onSelectionActivity = useCallback(
    (id: string, active: boolean) =>
      onOwnedSelectionActivity(id, active, viewKey),
    [onOwnedSelectionActivity, viewKey]
  )
  return (
    <HomeComposer
      {...props}
      onDraftChange={onDraftChange}
      onMaterialSelectionActivity={onSelectionActivity}
    />
  )
}
/** 隐藏只改变展示，未完成的首页 owner 仍挂载并完成原稿交接。 */
export function HomeSubmissionHost({
  home,
  data,
  unconfirmed,
  settingsOpen,
  selected,
  workspaces,
}: {
  home: Pick<
    ReturnType<typeof useHomeSubmissionController>,
    | "homeViews"
    | "homeDraft"
    | "homeSubmissions"
    | "visibleHomeSubmission"
    | "acknowledgeHomeRestoration"
    | "homeRestorations"
    | "homeCleanupErrors"
    | "prepareHomeSubmission"
    | "checkHomeSubmission"
    | "saveHomeDraft"
    | "saveHomeSelectionActivity"
    | "submitHome"
    | "retryCleanup"
  >
  data: ComposerData
  unconfirmed: Record<string, boolean>
  settingsOpen: boolean
  selected?: string
  workspaces: Pick<
    ReturnType<typeof useWorkspaces>,
    "choose" | "select" | "loading" | "error" | "issue" | "refresh"
  >
}) {
  const {
    homeViews,
    homeDraft,
    homeSubmissions,
    visibleHomeSubmission,
    acknowledgeHomeRestoration,
    homeRestorations,
    homeCleanupErrors,
    prepareHomeSubmission,
    checkHomeSubmission,
    saveHomeDraft,
    saveHomeSelectionActivity,
    submitHome,
  } = home
  return (
    <>
      {homeViews.map((view) => {
        const inactive =
          settingsOpen || !!selected || view.key !== homeDraft.key
        const ownedSubmission = view.draft?.sessionId
          ? homeSubmissions[view.draft.sessionId]
          : visibleHomeSubmission
        return (
          <div
            key={view.key}
            hidden={inactive}
            className={
              inactive
                ? "hidden"
                : "flex min-h-0 flex-1 flex-col overflow-y-auto"
            }
          >
            <OwnedHomeComposer
              viewKey={view.key}
              inactive={inactive}
              pendingSubmission={ownedSubmission}
              onRestorationPersisted={acknowledgeHomeRestoration}
              restoredSubmission={
                view.draft?.sessionId
                  ? homeRestorations[view.draft.sessionId]
                  : undefined
              }
              submissionFeedback={
                ownedSubmission &&
                homeCleanupErrors[ownedSubmission.sessionId] ? (
                  <HomeSubmissionFeedback
                    message={
                      homeCleanupErrors[ownedSubmission.sessionId].message
                    }
                    pending={
                      homeCleanupErrors[ownedSubmission.sessionId]
                        .waitingMaterials
                    }
                    variant={
                      homeCleanupErrors[ownedSubmission.sessionId]
                        .waitingMaterials
                        ? "default"
                        : "destructive"
                    }
                    actionLabel={
                      homeCleanupErrors[ownedSubmission.sessionId].accepted
                        ? "完成草稿交接"
                        : "恢复原输入"
                    }
                    onRetry={() => home.retryCleanup(ownedSubmission.sessionId)}
                  />
                ) : undefined
              }
              submissionIssue={
                view.key === homeDraft.key ? homeDraft.issue : undefined
              }
              onSubmissionPrepare={prepareHomeSubmission}
              recoverySubmissionIds={Object.entries(homeCleanupErrors)
                .filter(([, cleanup]) => !cleanup.accepted)
                .map(([id]) => id)}
              acceptedSubmissionIds={Object.entries(homeCleanupErrors)
                .filter(([, cleanup]) => cleanup.accepted)
                .map(([id]) => id)}
              draftStore={persistentHomeDraftStore}
              unconfirmedSessionIds={[
                ...new Set([
                  ...Object.keys(unconfirmed),
                  ...Object.keys(homeSubmissions).filter(
                    (id) => !homeCleanupErrors[id]?.accepted
                  ),
                ]),
              ]}
              onCheckSubmission={(id, signal) =>
                checkHomeSubmission(id, true, signal)
              }
              data={data}
              initialDraft={
                view.draft ?? {
                  workspaceId: view.workspaceId,
                }
              }
              onOwnedDraftChange={saveHomeDraft}
              onOwnedSelectionActivity={saveHomeSelectionActivity}
              onSubmit={submitHome}
              onChooseWorkspace={workspaces.choose}
              onWorkspaceSelect={workspaces.select}
              workspaceLoading={workspaces.loading}
              workspaceError={workspaces.error}
              workspaceIssue={workspaces.issue}
              onWorkspaceRetry={workspaces.refresh}
            />
          </div>
        )
      })}
    </>
  )
}
