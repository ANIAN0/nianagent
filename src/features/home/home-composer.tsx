import { MaterialSourcesBridge } from "@/features/materials/material-sources-bridge"
import { PageErrorBoundary } from "@/components/feedback/page-error-boundary"
import { useHomeComposer } from "./use-home-composer"
import type { HomeComposerProps } from "./home-composer.types"
export type { HomeComposerProps } from "./home-composer.types"
import { ComposerNotification } from "@/components/composer/composer-notification"

import "./home.css"

import { ComposerInputCard } from "@/components/composer/composer-input-card"
import { removeComposerMaterial } from "@/features/materials/composer-material-edit"
import { Field, FieldGroup } from "@/components/ui/field"
import { WorkspacePicker } from "./workspace-picker"
import { PromptInput } from "@/components/composer/prompt-input"
import { ComposerToolbar } from "@/components/composer/composer-toolbar"
import { SelectedMaterials } from "@/components/composer/selected-materials"

import { Button } from "@/components/ui/button"

import { composerDisplayMaterials } from "@/components/composer/composer-policy"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { ComposerPanelProvider } from "@/components/composer/composer-panel-context"
import { HomeSubmissionEcho } from "./home-submission-echo"
import { HomeSubmissionNotice } from "./home-submission-notice"

export function HomeComposer(props: HomeComposerProps) {
  const controller = useHomeComposer(props)
  return (
    <PageErrorBoundary>
      <HomeComposerView {...props} controller={controller} />
    </PageErrorBoundary>
  )
}
function HomeComposerView({
  inactive = false,
  draftStore,
  submissionFeedback,
  onCheckSubmission,
  data,
  onWorkspaceAdd,
  onChooseWorkspace,
  onWorkspaceSelect,
  workspaceLoading,
  workspaceError,
  workspaceIssue,
  onWorkspaceRetry,
  controller,
}: HomeComposerProps & { controller: ReturnType<typeof useHomeComposer> }) {
  const {
    models,
    materials,
    tools,
    acceptedSubmission,
    workspaces,
    draft,
    submitting,
    pendingCopy,
    unknownSubmission,
    setWorkspaces,
    change,
    submit,
    checking,
    autoChecking,
    recoveringSubmission,
    sessionId,
    workspacePath,
    submissionFailure,
    checkSubmission,
    anchorRef,
    anchorNode,
    bindAnchor,
    materialController,
    inputRef,
    configLoading,
    canSubmit,
    unsupportedCompact,
    eligibility,
    setResult,
    configFailure,
    saveError,
    setConfigRevision,
    latestDraft,
    setSaveError,
    acknowledgeRestoration,
    result,
  } = controller
  return (
    <section className="home-launch" aria-label="新建工作">
      <MaterialSourcesBridge
        anchorNode={anchorNode}
        {...materialController.sourcePorts}
      />
      <h1 className="mb-3 text-center text-[26px] leading-8 font-medium">
        开始一项工作
      </h1>
      <WorkspacePicker
        key={`workspace:${inactive || acceptedSubmission ? "inactive" : "active"}`}
        workspaces={workspaces}
        value={draft.workspaceId}
        loading={workspaceLoading}
        error={workspaceError}
        issue={workspaceIssue}
        onRetry={onWorkspaceRetry}
        disabled={
          submitting ||
          !!pendingCopy ||
          unknownSubmission ||
          acceptedSubmission ||
          inactive
        }
        onChooseDirectory={
          onChooseWorkspace
            ? async (signal) => {
                const item = await onChooseWorkspace(signal)
                if (!item || signal.aborted) return
                setWorkspaces((items) => [
                  ...items.filter((current) => current.id !== item.id),
                  item,
                ])
                onWorkspaceAdd?.(item)
                change({ workspaceId: item.id })
              }
            : undefined
        }
        onChange={async (workspaceId, signal) => {
          await onWorkspaceSelect?.(workspaceId, signal)
          if (!signal?.aborted) change({ workspaceId })
        }}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <fieldset
          disabled={acceptedSubmission || inactive}
          className="min-w-0 border-0 p-0"
        >
          <ComposerPanelProvider inactive={inactive || acceptedSubmission}>
            {!acceptedSubmission &&
              (!submitting ||
                checking ||
                autoChecking ||
                recoveringSubmission) &&
              (pendingCopy || unknownSubmission) && (
                <HomeSubmissionEcho
                  key={`${sessionId}:${workspacePath}:${pendingCopy?.clientRequestId ?? "unconfirmed"}`}
                  submission={pendingCopy}
                  workspacePath={workspacePath}
                  inactive={inactive}
                  recovering={recoveringSubmission}
                  checking={autoChecking || checking}
                  issue={submissionFailure}
                  onSettings={data.modelCatalog?.onOpenSettings}
                  onCheck={
                    onCheckSubmission ? () => void checkSubmission() : undefined
                  }
                />
              )}
            <FieldGroup>
              <Field>
                <ComposerInputCard
                  ref={bindAnchor}
                  data-workspace-missing={!workspacePath}
                  tabIndex={!workspacePath ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (
                      !workspacePath &&
                      event.target === event.currentTarget &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault()
                      anchorRef.current
                        ?.closest("section")
                        ?.querySelector<HTMLButtonElement>(
                          '[aria-label="选择工作目录"]'
                        )
                        ?.click()
                    }
                  }}
                  onClick={(event) => {
                    if (
                      !workspacePath &&
                      !(event.target as Element).closest("button")
                    )
                      anchorRef.current
                        ?.closest("section")
                        ?.querySelector<HTMLButtonElement>(
                          '[aria-label="选择工作目录"]'
                        )
                        ?.click()
                  }}
                  dropActive={materialController.dropActive}
                  dropDisabledReason={
                    !workspacePath
                      ? "请先选择工作目录"
                      : data.materialsEnabled === false ||
                          acceptedSubmission ||
                          inactive
                        ? "当前暂不能添加附件"
                        : undefined
                  }
                >
                  <PromptInput
                    key={`${sessionId}:${workspacePath}`}
                    inputRef={inputRef}
                    value={draft.text}
                    materials={draft.materials}
                    referenceIdentities={materialController.referenceIdentities}
                    onRetryReference={(id) => void materialController.retry(id)}
                    canRetryReference={(material) =>
                      materialController.canRetry(material.id)
                    }
                    retryLabelReference={(material) =>
                      materialController.retryLabel(material.id)
                    }
                    onRemoveReference={(id) =>
                      change(removeComposerMaterial(draft, id, workspacePath))
                    }
                    cwd={workspacePath}
                    disabled={acceptedSubmission || inactive || !workspacePath}
                    placeholder={
                      !workspacePath ? "选择工作目录后开始工作" : undefined
                    }
                    onReferencesChanged={(text, ids, restored) =>
                      change({
                        text,
                        materials: [
                          ...draft.materials.filter(
                            (item) => !ids.includes(item.id)
                          ),
                          ...restored,
                        ],
                      })
                    }
                    onChange={(text) => change({ text })}
                    onSubmit={submit}
                  />
                  <SelectedMaterials
                    inlineReferences
                    key={`${sessionId}:${workspacePath}:${inactive || acceptedSubmission ? "inactive" : "active"}`}
                    materials={composerDisplayMaterials(
                      draft.materials,
                      draft.model,
                      data.modelInputs
                    )}
                    cwd={workspacePath}
                    onRetry={(id) => void materialController.retry(id)}
                    canRetry={(material) =>
                      !(
                        material.type === "image" &&
                        data.modelInputs &&
                        !data.modelInputs[draft.model]?.includes("image")
                      ) && materialController.canRetry(material.id)
                    }
                    retryLabel={(material) =>
                      materialController.retryLabel(material.id)
                    }
                    onRemove={(id) =>
                      change(removeComposerMaterial(draft, id, workspacePath))
                    }
                  />
                  <ComposerToolbar
                    disabled={acceptedSubmission || inactive}
                    configurationDisabled={
                      submitting || unknownSubmission || acceptedSubmission
                    }
                    configurationDisabledReason={
                      acceptedSubmission
                        ? "正在打开已接收的会话，请稍候。"
                        : inactive
                          ? "当前输入区已离开。"
                          : checking || autoChecking
                            ? "正在核对原消息的接收状态，请稍候。"
                            : submitting
                              ? "正在确认当前发送，确认后可修改会话配置。"
                              : unknownSubmission
                                ? "先检查原消息的发送状态，再修改会话配置。"
                                : undefined
                    }
                    configurationLoading={configLoading}
                    sessionId={sessionId}
                    anchorRef={anchorRef}
                    data={{
                      materialsEnabled: data.materialsEnabled,
                      materials,
                      models,
                      tools,
                      modelLabels: data.modelLabels,
                      modelThinking: data.modelThinking,
                      modelCatalog: data.modelCatalog,
                    }}
                    workspacePath={
                      workspaces.find((item) => item.id === draft.workspaceId)
                        ?.path
                    }
                    draft={draft}
                    canSubmit={canSubmit}
                    sendDisabledReason={
                      checking || autoChecking
                        ? "正在核对原消息的接收状态，请稍候。"
                        : submitting
                          ? "正在确认当前发送，请稍候。"
                          : unknownSubmission
                            ? "请先核对原消息的发送状态。"
                            : acceptedSubmission
                              ? "正在打开已接收的会话，请稍候。"
                              : unsupportedCompact
                                ? "请先打开已有会话，再用 /compact 压缩上下文。"
                                : eligibility.reasonKind === "empty"
                                  ? undefined
                                  : eligibility.reason
                    }
                    onChange={change}
                    onAddMaterial={(item) => {
                      void materialController.prepare(item)
                      setResult("")
                    }}
                    onChooseAttachments={
                      materialController.service
                        ? materialController.choose
                        : undefined
                    }
                    choosingMaterials={materialController.choosing}
                  />
                </ComposerInputCard>
              </Field>
            </FieldGroup>
          </ComposerPanelProvider>
        </fieldset>
      </form>
      {eligibility.hasDraft &&
        eligibility.reasonKind === "model" &&
        !inactive &&
        !acceptedSubmission &&
        !submitting &&
        !pendingCopy &&
        !unknownSubmission &&
        !configLoading &&
        !configFailure &&
        !saveError &&
        !unsupportedCompact &&
        !!workspacePath &&
        !["loading", "error"].includes(
          data.modelCatalog?.status ?? "ready"
        ) && (
          <ComposerNotification
            tone="warning"
            trigger={draft.model}
            message={
              draft.model
                ? "当前所选模型不可用，请在模型菜单中重新选择。"
                : "尚未选择模型，请先在模型菜单中选择可用模型。"
            }
          />
        )}
      {configFailure && (
        <ComposerNotification
          message={configFailure.message}
          trigger={configFailure}
          error
          persistent
          actions={
            <RecoveryAction
              issue={configFailure}
              onReload={() => setConfigRevision((value) => value + 1)}
              onRetry={() => setConfigRevision((value) => value + 1)}
              onCheck={() => setConfigRevision((value) => value + 1)}
              onSettings={data.modelCatalog?.onOpenSettings}
              labels={{ reload: "重新读取配置" }}
            />
          }
        />
      )}
      {saveError && (
        <ComposerNotification
          message={`草稿未保存：${saveError}`}
          error
          persistent
          actions={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                try {
                  draftStore?.write(latestDraft.current)
                  setSaveError("")
                  acknowledgeRestoration(latestDraft.current)
                } catch {
                  /* Keep the draft and its recovery available. */
                }
              }}
            >
              重试保存
            </Button>
          }
        />
      )}
      {submissionFeedback}
      {!submissionFeedback &&
        submissionFailure &&
        !unknownSubmission &&
        !acceptedSubmission &&
        !recoveringSubmission && (
          <HomeSubmissionNotice
            key={`${sessionId}:${submissionFailure.code}:${submissionFailure.message}`}
            message={submissionFailure.message}
            persistent={["reload", "settings", "restart"].includes(
              submissionFailure.recovery ?? ""
            )}
            actions={
              <RecoveryAction
                issue={submissionFailure}
                onReload={() => setConfigRevision((value) => value + 1)}
                onSettings={data.modelCatalog?.onOpenSettings}
                labels={{ reload: "重新读取配置" }}
              />
            }
          />
        )}

      {materialController.feedback && (
        <ComposerNotification
          message={materialController.feedback.message}
          persistent={
            materialController.feedback.recovery === "restart" ||
            materialController.feedback.code === "cancelled"
          }
          actions={
            materialController.feedback.code === "cancelled" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={materialController.recheck}
              >
                重新检查材料
              </Button>
            ) : materialController.feedback.recovery === "restart" ? (
              <RecoveryAction issue={materialController.feedback} />
            ) : undefined
          }
        />
      )}
      {result && <ComposerNotification message={result} />}
    </section>
  )
}
