import { RefreshCw } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { Button } from "@/components/ui/button"
import { ConnectionFields } from "./connection-fields"
import type { ModelService } from "./model-types"
import type { useConnectionEditor } from "./use-connection-editor"

export function ConnectionServiceFields({
  state,
  service,
  onClose,
}: {
  state: ReturnType<typeof useConnectionEditor>
  service: ModelService
  onClose: () => void
}) {
  const {
    draft,
    providers,
    errors,
    busy,
    change,
    setConfirm,
    providersFailure,
    reloadProviders,
    saveUnknown,
    saveConflict,
    discoveryBlocked,
    discover,
    discoveryFailure,
    candidates,
    askLeave,
  } = state
  return (
    <section
      className="model-section model-connection-config"
      aria-labelledby="service-heading"
    >
      <div className="model-section-head items-center">
        <h3 id="service-heading">服务信息</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={
            !!busy ||
            saveUnknown ||
            saveConflict ||
            discoveryBlocked ||
            (draft.kind === "subscription" && !draft.account?.loggedIn)
          }
          onClick={discover}
        >
          <RefreshCw
            data-icon="inline-start"
            className={busy === "test" ? "motion-safe:animate-spin" : ""}
          />
          {busy === "test"
            ? "正在读取…"
            : draft.kind === "subscription"
              ? "读取 Pi 模型目录"
              : "测试连接并获取模型"}
        </Button>
      </div>
      <ConnectionFields
        onReloadConnection={() => askLeave(onClose)}
        onRevealKey={
          service.revealKey && draft.revision !== undefined && !saveUnknown
            ? async (signal) =>
                (await service.revealKey!(draft.id, draft.revision!, signal))
                  .apiKey
            : undefined
        }
        value={draft}
        providers={providers}
        errors={errors}
        disabled={!!busy}
        onChange={change}
        onClearKey={(action) =>
          setConfirm({
            title: "清除已保存密钥？",
            description: "保存连接后不再使用当前密钥；取消编辑仍保留原配置。",
            label: "清除密钥",
            destructive: true,
            action,
          })
        }
      />
      {providersFailure && (
        <OperationFeedback
          notify={false}
          title="无法读取订阅提供者"
          {...providersFailure}
          actions={
            <RecoveryAction
              issue={providersFailure}
              onRetry={reloadProviders}
              onReload={reloadProviders}
              labels={{ retry: "重新读取" }}
            />
          }
        />
      )}
      {discoveryFailure && (
        <OperationFeedback
          title={
            discoveryFailure.code === "cancelled"
              ? "测试已取消"
              : candidates
                ? "推荐模型调用失败"
                : "未能读取模型目录"
          }
          {...discoveryFailure}
          actions={
            <RecoveryAction
              issue={discoveryFailure}
              onRetry={discover}
              onReload={discover}
              disabled={!!busy || saveUnknown}
              labels={{ retry: "重新测试", reload: "重新读取模型" }}
            />
          }
        />
      )}
    </section>
  )
}
