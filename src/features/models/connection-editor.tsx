import { useState } from "react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { useConnectionEditor } from "./use-connection-editor"
import { ArrowLeft, Plus, RefreshCw, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConnectionFields } from "./connection-fields"
import { ModelDirectory, DiscoveredModels } from "./model-directory"
import { ModelEditor } from "./model-editor"
import { PiAuthorization } from "./pi-authorization"
import { SubscriptionAuthorization } from "./subscription-authorization"
import { SettingsConfirmDialog } from "./settings-confirmation"
import {
  blankModel,
  type ModelConnection,
  type ModelDefinition,
  type ModelService,
} from "./model-types"

export type LeaveGuard = (action: () => void) => void
export type ConnectionEditorProps = {
  initial: ModelConnection
  connections: ModelConnection[]
  service: ModelService
  onSaved: (connection: ModelConnection) => void
  onAccountSaved?: (connection: ModelConnection) => void
  onClose: () => void
  registerLeave?: (guard: LeaveGuard | null) => void
}
export function ConnectionEditor({
  initial,
  connections,
  service,
  onSaved,
  onAccountSaved,
  onClose,
  registerLeave,
}: ConnectionEditorProps) {
  const state = useConnectionEditor({
    initial,
    connections,
    service,
    onSaved,
    onAccountSaved,
    onClose,
    registerLeave,
  })
  const {
    draft,
    setDraft,
    busy,
    dirty,
    errors,
    active,
    form,
    checks,
    setChecks,
    confirm,
    setConfirm,
    oauth,
    setOauth,
    providers,
    providersFailure,
    reloadProviders,
    accountFailure,
    accountUnknown,
    accountBlocked,
    accountConflict,
    readAccountState,
    startAuthorization,
    saveFailure,
    recoverStorage,
    discoveryFailure,
    saveUnknown,
    saveConflict,
    saveBlocked,
    discoveryBlocked,
    waitingToLeave,
    result,
    candidates,
    change,
    askLeave,
    cancelRequest,
    acceptAccount,
    updateAccount,
    save,
    checkSaved,
    discover,
    checkModel,
  } = state
  const [target, setTarget] = useState<{
    draft: ModelDefinition
    originalId?: string
  }>()
  return (
    <div className="model-editor">
      <div className="model-scroll">
        <div className="model-page">
          <Button
            variant="ghost"
            className="model-back"
            disabled={!!busy}
            onClick={() => askLeave(onClose)}
          >
            <ArrowLeft />
            连接目录
          </Button>
          <header className="model-editor-head">
            <div>
              <h2 tabIndex={-1}>{active ? initial.name : "添加连接"}</h2>
              <p>
                {active
                  ? "编辑服务与此连接下的模型"
                  : "连接服务后，可测试并加入模型"}
              </p>
            </div>
            <span>
              {draft.kind === "subscription" ? "订阅账号" : "自定义服务"}
            </span>
          </header>
          <form
            ref={form}
            id="connection-form"
            aria-label="连接配置"
            aria-busy={!!busy}
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
            className="model-form"
          >
            <section
              className="model-section model-connection-config"
              aria-labelledby="service-heading"
            >
              <div className="model-section-head">
                <div>
                  <h3 id="service-heading">服务信息</h3>
                  <p>填写服务地址与凭据；测试不保存修改。</p>
                </div>
              </div>
              <ConnectionFields
                onReloadConnection={() => askLeave(onClose)}
                onRevealKey={
                  service.revealKey &&
                  draft.revision !== undefined &&
                  !saveUnknown
                    ? async (signal) =>
                        (
                          await service.revealKey!(
                            draft.id,
                            draft.revision!,
                            signal
                          )
                        ).apiKey
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
                    description:
                      "保存连接后不再使用当前密钥；取消编辑仍保留原配置。",
                    label: "清除密钥",
                    destructive: true,
                    action,
                  })
                }
              />
              {providersFailure && (
                <OperationFeedback
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
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
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
                    className={
                      busy === "test" ? "motion-safe:animate-spin" : ""
                    }
                  />
                  {busy === "test"
                    ? "正在读取…"
                    : draft.kind === "subscription"
                      ? "读取 Pi 模型目录"
                      : "测试连接并获取模型"}
                </Button>
              </div>
              {discoveryFailure && (
                <OperationFeedback
                  title={
                    discoveryFailure.code === "cancelled"
                      ? "测试已取消"
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
            {draft.kind === "subscription" && (
              <section className="model-section">
                <div className="model-section-head">
                  <div>
                    <h3>订阅账号</h3>
                    <p>
                      {draft.account
                        ? `${draft.account.name} · ${draft.account.plan}`
                        : "使用订阅服务账号授权"}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {draft.account?.loggedIn
                    ? "已登录"
                    : "尚未登录或登录已失效，此连接的模型暂不可用。"}
                </p>
                {accountFailure && (
                  <OperationFeedback
                    title={
                      accountUnknown
                        ? "账号状态待核对"
                        : accountFailure.code === "account_state_checked"
                          ? "当前登录状态"
                          : "账号操作未完成"
                    }
                    {...accountFailure}
                    actions={
                      <RecoveryAction
                        issue={accountFailure}
                        onCheck={readAccountState}
                        onRetry={readAccountState}
                        onReload={
                          accountConflict
                            ? () => askLeave(onClose)
                            : readAccountState
                        }
                        disabled={!!busy}
                        labels={{
                          check: "核对当前登录状态",
                          retry: "读取当前登录状态",
                          reload: accountConflict
                            ? "返回连接目录"
                            : "读取当前登录状态",
                        }}
                        onSettings={() =>
                          document
                            .getElementById("subscription-provider")
                            ?.focus()
                        }
                      />
                    }
                  />
                )}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !!busy || accountBlocked || saveUnknown || saveConflict
                    }
                    onClick={() => {
                      if (draft.account?.loggedIn)
                        setConfirm({
                          title: "退出登录？",
                          description:
                            "退出后此连接模型不可用，重新登录可恢复。",
                          label: "退出登录",
                          destructive: true,
                          action: () =>
                            updateAccount({
                              ...draft.account!,
                              loggedIn: false,
                            }),
                        })
                      else startAuthorization()
                    }}
                  >
                    <LogIn />
                    {draft.account?.loggedIn
                      ? "退出登录"
                      : draft.account
                        ? "重新登录"
                        : "开始授权"}
                  </Button>
                </div>
              </section>
            )}
            {saveFailure && (
              <OperationFeedback
                title={
                  saveUnknown
                    ? "保存结果待核对"
                    : saveFailure.code === "write_confirmed"
                      ? "原保存已确认"
                      : "未能保存连接"
                }
                {...saveFailure}
                severity={saveUnknown ? "warning" : saveFailure.severity}
                actions={
                  <>
                    {saveFailure.code === "recovery_storage_unavailable" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={recoverStorage}
                      >
                        重新读取本机恢复记录
                      </Button>
                    ) : (
                      <RecoveryAction
                        issue={saveFailure}
                        onCheck={checkSaved}
                        onReload={() => askLeave(onClose)}
                        onRetry={save}
                        disabled={!!busy}
                        labels={{
                          check: "核对保存结果",
                          reload: "返回连接目录",
                          retry: "重新保存",
                        }}
                      />
                    )}
                  </>
                }
              />
            )}
            {result && (
              <section
                className="model-section"
                aria-labelledby="test-result-heading"
              >
                <div className="model-section-head">
                  <h3 id="test-result-heading">
                    {candidates ? "测试结果" : "操作状态"}
                  </h3>
                </div>
                <p role="status" className="text-sm">
                  {result}
                </p>
                {candidates && (
                  <DiscoveredModels
                    key={result}
                    models={candidates}
                    existing={draft.models}
                    busy={!!busy}
                    onAdd={(models) =>
                      setDraft((value) => ({
                        ...value,
                        models: [...value.models, ...models],
                      }))
                    }
                  />
                )}
              </section>
            )}
            <section className="model-section" aria-labelledby="models-heading">
              <div className="model-section-head">
                <div>
                  <h3 id="models-heading">
                    {active ? `${initial.name} 的模型` : "此连接的模型"}
                  </h3>
                  <p>
                    修改加入连接草稿，保存连接后生效。检查模型会发起真实短请求，可能产生费用。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !!busy || (draft.kind === "subscription" && !!service.auth)
                  }
                  onClick={() => setTarget({ draft: blankModel() })}
                >
                  <Plus />
                  手工添加
                </Button>
              </div>
              <ModelDirectory
                onConfigureConnection={() =>
                  (
                    document.getElementById("connection-key") ??
                    document.getElementById("connection-endpoint")
                  )?.focus()
                }
                readOnly={draft.kind === "subscription" && !!service.auth}
                models={draft.models}
                busy={!!busy || saveUnknown || saveConflict}
                checks={checks}
                onEdit={(model) =>
                  setTarget({
                    draft: structuredClone(model),
                    originalId: model.id,
                  })
                }
                onRemove={(model) =>
                  setConfirm({
                    title: "移除模型？",
                    description: `“${model.name}”将从此连接草稿中移除，保存连接后生效。`,
                    label: "移除模型",
                    destructive: true,
                    action: () => {
                      setChecks({})
                      setDraft((value) => ({
                        ...value,
                        models: value.models.filter(
                          (item) => item.id !== model.id
                        ),
                      }))
                    },
                  })
                }
                onCheck={checkModel}
              />
            </section>
          </form>
        </div>
      </div>
      <footer className="model-footer">
        {(busy === "test" || busy === "check") && (
          <Button variant="outline" onClick={cancelRequest}>
            取消请求
          </Button>
        )}
        <p role="status">
          {busy
            ? waitingToLeave
              ? "请等待保存完成；连接测试可取消后离开。"
              : busy === "save"
                ? "正在保存连接…"
                : busy === "receipt"
                  ? "正在核对原保存，不会重复提交…"
                  : busy === "account-read"
                    ? "正在读取当前登录状态…"
                    : "正在请求服务…"
            : saveUnknown
              ? "原保存结果仍待核对，当前草稿已保留。"
              : Object.keys(errors).length
                ? "请修正表单中标出的字段。"
                : dirty
                  ? "有未保存的修改。"
                  : "尚无未保存的修改。"}
        </p>
        <div>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => askLeave(onClose)}
          >
            取消
          </Button>
          <Button
            form="connection-form"
            type="submit"
            disabled={
              !!busy ||
              accountBlocked ||
              saveUnknown ||
              saveConflict ||
              saveBlocked ||
              !dirty
            }
          >
            {busy === "save" ? "正在保存…" : "保存连接"}
          </Button>
        </div>
      </footer>
      {target && (
        <ModelEditor
          initial={target.draft}
          originalId={target.originalId}
          existing={draft.models}
          connectionName={draft.name}
          onClose={() => setTarget(undefined)}
          onSave={(model) => {
            setChecks({})
            setDraft((value) => ({
              ...value,
              models: target.originalId
                ? value.models.map((item) =>
                    item.id === target.originalId ? model : item
                  )
                : [...value.models, model],
            }))
            setTarget(undefined)
          }}
        />
      )}
      <SettingsConfirmDialog
        value={confirm}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          const action = confirm?.action
          setConfirm(undefined)
          void action?.()
        }}
      />
      {oauth && service.auth && (
        <PiAuthorization
          connection={draft}
          service={service}
          onComplete={acceptAccount}
          onCancelled={acceptAccount}
          onClose={() => {
            setOauth(false)
            onClose()
          }}
        />
      )}
      {oauth && !service.auth && (
        <SubscriptionAuthorization
          name={draft.name}
          service={service}
          onComplete={updateAccount}
          onClose={() => setOauth(false)}
        />
      )}
    </div>
  )
}
