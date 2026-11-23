import { useState } from "react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { useConnectionEditor } from "./use-connection-editor"
import { ArrowLeft, Plus, LogIn } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConnectionServiceFields } from "./connection-service-fields"
import { ModelDirectory, DiscoveredModels } from "./model-directory"
import { ModelEditor } from "./model-editor"
import { PiAuthorization } from "./pi-authorization"
import { SettingsConfirmDialog } from "@/components/operations/settings-confirmation"
import {
  blankModel,
  type ModelConnection,
  type ModelDefinition,
  type ModelService,
} from "./model-types"

import type { LeaveGuard } from "@/lib/navigation/leave-guard"
export type ConnectionEditorProps = {
  initial: ModelConnection
  connections: ModelConnection[]
  service: ModelService
  onSaved: (connection: ModelConnection) => void
  onAccountSaved?: (connection: ModelConnection) => void
  onClose: () => void
  onReload: () => void
  registerLeave?: (guard: LeaveGuard | null) => void
}
export function ConnectionEditor({
  initial,
  connections,
  service,
  onSaved,
  onAccountSaved,
  onClose,
  onReload,
  registerLeave,
}: ConnectionEditorProps) {
  const state = useConnectionEditor({
    initial,
    connections,
    service,
    onSaved,
    onAccountSaved,
    onClose,
    onReload,
    registerLeave,
  })
  const {
    draft,
    errors,
    setDraft,
    busy,
    dirty,
    active,
    form,
    checks,
    setChecks,
    confirm,
    setConfirm,
    oauth,
    setOauth,
    accountFailure,
    accountUnknown,
    accountBlocked,
    accountConflict,
    readAccountState,
    startAuthorization,
    saveFailure,
    recoverStorage,
    saveUnknown,
    saveConflict,
    saveBlocked,
    waitingToLeave,
    result,
    candidates,
    askLeave,
    cancelRequest,
    acceptAccount,
    updateAccount,
    save,
    checkSaved,
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
          <header className="model-editor-head items-center">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 tabIndex={-1}>
                {active ? initial.name || draft.name : "添加连接"}
              </h2>
              <Badge variant="outline">
                {draft.kind === "subscription" ? "订阅账号" : "自定义服务"}
              </Badge>
            </div>
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
            <ConnectionServiceFields
              state={state}
              service={service}
              onClose={onClose}
            />
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
                    notify={false}
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
                notify={false}
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
                        onReload={() => askLeave(onReload)}
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
                <h3 id="models-heading">
                  {active
                    ? `${initial.name || draft.name} 的模型`
                    : "此连接的模型"}
                </h3>
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
                toolbarAction={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={
                      !!busy ||
                      (draft.kind === "subscription" && !!service.auth)
                    }
                    onClick={() => setTarget({ draft: blankModel() })}
                  >
                    <Plus data-icon="inline-start" />
                    手工添加
                  </Button>
                }
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
        <div className="model-footer-inner">
          <div className="flex flex-wrap items-center gap-3">
            {(busy === "test" || busy === "check") && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={cancelRequest}
              >
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
          </div>
          <div className="model-footer-actions">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={!!busy}
              onClick={() => askLeave(onClose)}
            >
              取消
            </Button>
            <Button
              form="connection-form"
              type="submit"
              size="sm"
              className="h-8"
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
      {oauth && (
        <PiAuthorization
          connection={draft}
          service={service}
          onComplete={acceptAccount}
          onCancelled={acceptAccount}
          onClose={() => {
            setOauth(false)
          }}
        />
      )}
    </div>
  )
}
