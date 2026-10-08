import { useSessionConfiguration } from "./use-session-configuration"
import type { SessionConfigProps } from "./session-config.types"
export type { SessionConfigProps } from "./session-config.types"
import { HoverHint } from "@/components/feedback/hover-hint"

import {
  ChevronDown,
  SlidersHorizontal,
  Puzzle,
  LoaderCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"

import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"

import { Skeleton } from "@/components/ui/skeleton"
import { ExtensionConfig } from "@/features/extensions/extension-config"

import { ToolPicker } from "@/components/composer/tool-picker"
import { InstructionScopePicker } from "@/components/composer/instruction-scope-picker"

export function SessionConfig(props: SessionConfigProps) {
  return (
    <SessionConfigPanel
      key={`${props.sessionId ?? "preview"}:${props.workspacePath}`}
      {...props}
    />
  )
}
function SessionConfigPanel({
  loading = false,
  extensionService: suppliedExtensions,
  disabled = false,
  disabledReason = "当前操作完成后可修改会话配置。",
  sessionId,
  tools,
  value,
  workspacePath,
  onChange,
}: SessionConfigProps) {
  const {
    applied,
    open,
    changeOpen,
    preventDismiss,
    handleEscape,
    selectTab,
    closeAutoFocus,
    requestBusy,
    extensionOpen,
    activeTab,
    toolPicker,
    extensionService,
    setExtensionOpen,
    reloadCandidate,
    refreshCapabilities,
    phase,
    feedback,
    unavailableSelected,
    displayTools,
    toolsChanged,
    pending,
    updatePending,
    catalog,
    submissionBlocked,
    retrySubmissionReady,
    retrySubmission,
    checkSubmission,
    changed,
    apply,
  } = useSessionConfiguration({
    loading,
    extensionService: suppliedExtensions,
    disabled,
    disabledReason,
    sessionId,
    tools,
    value,
    workspacePath,
    onChange,
  })

  const trigger = (
    <Button
      type="button"
      size="composer"
      variant="composer"
      className="moon-composer-selector"
      aria-label="打开会话配置"
      disabled={disabled}
    >
      {loading ? (
        <LoaderCircle
          className="animate-spin"
          data-icon="inline-start"
          aria-label="正在读取会话配置"
        />
      ) : (
        <SlidersHorizontal data-icon="inline-start" />
      )}
      <span
        data-hint-label
        className="hidden @sm:inline"
        role={applied ? "status" : undefined}
      >
        {applied ? "配置已应用" : "会话配置"}
      </span>
      <ChevronDown data-icon="inline-end" />
    </Button>
  )
  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        {disabled ? (
          <HoverHint
            disabled
            label="会话配置"
            content={loading ? undefined : disabledReason}
          >
            {trigger}
          </HoverHint>
        ) : (
          <HoverHint
            content={loading ? undefined : applied ? "配置已应用" : "会话配置"}
            onlyWhenTruncated="[data-hint-label]"
            suppressed={open}
          >
            <DialogTrigger asChild>{trigger}</DialogTrigger>
          </HoverHint>
        )}
        <DialogContent
          onCloseAutoFocus={closeAutoFocus}
          showCloseButton={!requestBusy && !extensionOpen}
          onInteractOutside={preventDismiss}
          onEscapeKeyDown={handleEscape}
          className="flex h-[560px] max-h-[calc(100dvh-32px)] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[640px] [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4"
        >
          {extensionOpen && extensionService && (
            <ExtensionConfig
              embedded
              open
              onOpenChange={setExtensionOpen}
              service={extensionService}
              onConfigured={() => void refreshCapabilities()}
            />
          )}
          <div className={extensionOpen ? "hidden" : "contents"}>
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle className="text-base leading-6">
                会话配置
                {phase === "refreshing" && (
                  <LoaderCircle
                    className="ml-2 inline size-3.5 animate-spin"
                    aria-label="正在重新读取会话配置"
                  />
                )}
              </DialogTitle>
              <DialogDescription className="sr-only">
                选择会话可用工具与AGENTS.md加载范围。应用成功后保存到当前会话。
              </DialogDescription>
            </DialogHeader>
            {phase === "loading" ? (
              <div
                className="flex flex-1 flex-col gap-4 px-6 py-4"
                role="status"
                aria-label="正在读取会话配置"
              >
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <p className="text-xs text-muted-foreground">
                  正在读取工具与AGENTS.md…
                </p>
              </div>
            ) : phase === "load-error" ? (
              <div className="moon-scrollbar min-h-0 flex-1 overflow-auto px-6 py-4">
                {feedback && (
                  <OperationFeedback
                    notify={false}
                    density="compact"
                    title={
                      feedback.code === "cancelled"
                        ? "读取已取消"
                        : "无法读取会话配置"
                    }
                    {...feedback}
                    actions={
                      <RecoveryAction
                        variant="ghost"
                        issue={feedback}
                        onRetry={() => void reloadCandidate()}
                        onReload={() => void reloadCandidate()}
                        onCheck={() => void reloadCandidate()}
                        labels={{ retry: "重新读取" }}
                      />
                    }
                  />
                )}
              </div>
            ) : (
              <fieldset
                disabled={phase === "saving" || phase === "refreshing"}
                className="flex min-h-0 flex-1 flex-col border-0 p-0"
              >
                {unavailableSelected.length > 0 && (
                  <div className="mx-6 mb-3">
                    <OperationFeedback
                      notify={false}
                      density="compact"
                      title="所选工具不可用"
                      message={`请取消选择后应用：${unavailableSelected
                        .map(
                          (id) =>
                            displayTools.find((tool) => tool.id === id)?.name ??
                            id
                        )
                        .join("、")}`}
                      severity="warning"
                    />
                  </div>
                )}
                <Tabs
                  value={activeTab}
                  onValueChange={selectTab}
                  className="min-h-0 flex-1 gap-4 px-6"
                >
                  <div className="flex shrink-0 items-center justify-between gap-3">
                    <TabsList aria-label="会话配置分类" className="shrink-0">
                      <TabsTrigger value="tools">
                        工具{" "}
                        {toolsChanged && (
                          <span
                            aria-label="已修改"
                            className="size-[5px] rounded-full bg-primary"
                          />
                        )}
                      </TabsTrigger>
                      <TabsTrigger value="instructions">AGENTS.md</TabsTrigger>
                    </TabsList>
                    {extensionService && activeTab === "tools" && (
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setExtensionOpen(true)}
                      >
                        <Puzzle data-icon="inline-start" />
                        管理扩展
                      </Button>
                    )}
                  </div>
                  <TabsContent
                    forceMount
                    value="tools"
                    className="flex min-h-0 flex-col gap-3 pb-4 data-[state=inactive]:hidden"
                  >
                    <ToolPicker
                      ref={toolPicker}
                      canRestoreFocus={
                        activeTab === "tools" &&
                        !extensionOpen &&
                        phase !== "saving" &&
                        phase !== "refreshing"
                      }
                      tools={displayTools}
                      value={pending.toolIds}
                      onChange={(toolIds) =>
                        updatePending({ ...pending, toolIds })
                      }
                    />
                  </TabsContent>
                  <TabsContent
                    forceMount
                    value="instructions"
                    className="flex min-h-0 flex-col pb-4 data-[state=inactive]:hidden"
                  >
                    <InstructionScopePicker
                      instructions={catalog?.instructions}
                      value={pending.instructionScope}
                      onChange={(instructionScope) =>
                        updatePending({ ...pending, instructionScope })
                      }
                    />
                  </TabsContent>
                </Tabs>
              </fieldset>
            )}
            {feedback && phase !== "load-error" && (
              <div className="moon-scrollbar max-h-[45%] shrink-0 overflow-auto px-6 pb-3">
                <OperationFeedback
                  notify={false}
                  density="compact"
                  title={
                    phase === "refresh-error"
                      ? feedback.code === "cancelled"
                        ? "重新读取已取消"
                        : "无法重新读取会话配置"
                      : submissionBlocked
                        ? "保存结果待核对"
                        : feedback.code === "session_revision_conflict"
                          ? "当前会话配置已更新"
                          : feedback.code === "configuration_confirmed"
                            ? "配置已确认保存"
                            : feedback.code === "cancelled"
                              ? "应用已取消"
                              : "配置未能保存"
                  }
                  {...feedback}
                  actions={
                    feedback.recovery === "restart" ? (
                      <RecoveryAction issue={feedback} variant="ghost" />
                    ) : submissionBlocked ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={phase === "checking" || phase === "saving"}
                        onClick={() =>
                          void (retrySubmissionReady
                            ? retrySubmission()
                            : checkSubmission())
                        }
                      >
                        {phase === "checking"
                          ? "正在核对…"
                          : retrySubmissionReady
                            ? "按原版本重试"
                            : "核对配置"}
                      </Button>
                    ) : feedback.code !== "configuration_confirmed" ? (
                      <RecoveryAction
                        variant="ghost"
                        issue={feedback}
                        onRetry={() => void refreshCapabilities()}
                        onReload={() => void refreshCapabilities()}
                        onCheck={() => void refreshCapabilities()}
                        labels={{
                          retry:
                            phase === "refresh-error"
                              ? "重新读取"
                              : "读取当前会话已保存配置",
                          reload:
                            phase === "refresh-error"
                              ? "重新读取"
                              : "读取当前会话已保存配置",
                          check: "核对配置",
                        }}
                      />
                    ) : undefined
                  }
                />
              </div>
            )}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4">
              {submissionBlocked && (
                <p
                  role="status"
                  className="mr-auto text-xs text-muted-foreground"
                >
                  {phase === "saving"
                    ? "正在保存，请稍候…"
                    : retrySubmissionReady
                      ? "重试仅使用上次提交，后续修改不会一起发送。"
                      : "关闭不会撤销提交，重开后可继续核对。"}
                </p>
              )}
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={requestBusy}
                  className="h-9 w-[72px]"
                >
                  {submissionBlocked ? "关闭" : "取消"}
                </Button>
              </DialogClose>
              <Button
                type="button"
                className="h-9 w-[72px]"
                disabled={
                  phase !== "ready" ||
                  feedback?.recovery === "restart" ||
                  (feedback?.code === "session_revision_conflict" &&
                    feedback.recovery === "reload") ||
                  unavailableSelected.length > 0 ||
                  !changed
                }
                onClick={() => void apply()}
              >
                {phase === "saving" ? "应用中…" : "应用"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
