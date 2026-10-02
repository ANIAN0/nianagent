import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Plus, RefreshCw, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConnectionFields } from "./connection-fields"
import { ModelDirectory, DiscoveredModels } from "./model-directory"
import { ModelEditor } from "./model-editor"
import { PiAuthorization } from "./pi-authorization"
import { SubscriptionAuthorization } from "./subscription-authorization"
import {
  SettingsConfirmDialog,
  type SettingsConfirmation,
} from "./settings-confirmation"
import {
  blankModel,
  connectionErrors,
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
  const [baseline, setBaseline] = useState(initial)
  const [draft, setDraft] = useState(() => structuredClone(initial))
  const [attempted, setAttempted] = useState(false)
  const [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [result, setResult] = useState("")
  const [candidates, setCandidates] = useState<ModelDefinition[]>()
  const [checks, setChecks] = useState<
    Record<string, { error?: boolean; text: string }>
  >({})
  const [target, setTarget] = useState<{
    draft: ModelDefinition
    originalId?: string
  }>()
  const [confirm, setConfirm] = useState<SettingsConfirmation>()
  const [oauth, setOauth] = useState(false)
  const [providers, setProviders] = useState<{ id: string; name: string }[]>()
  useEffect(() => {
    if (!service.providers) return
    const controller = new AbortController()
    service
      .providers(controller.signal)
      .then(setProviders)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "提供者读取失败。"
          )
      })
    return () => controller.abort()
  }, [service])
  const form = useRef<HTMLFormElement>(null)
  const request = useRef<AbortController | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const errors = attempted ? connectionErrors(draft, connections, testing) : {}
  const active = connections.some((value) => value.id === initial.id)
  const askLeave = useCallback<LeaveGuard>(
    (action) => {
      if (busy) {
        setError("请先取消当前请求，或等待保存完成后离开。")
        return
      }
      if (dirty)
        setConfirm({
          title: "放弃未保存更改？",
          description: "当前连接与模型的修改尚未保存。",
          label: "放弃更改",
          destructive: true,
          action,
        })
      else action()
    },
    [dirty, busy]
  )
  useEffect(() => {
    registerLeave?.(askLeave)
    return () => registerLeave?.(null)
  }, [askLeave, registerLeave])
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  function change(patch: Partial<ModelConnection>) {
    setDraft((value) => ({ ...value, ...patch }))
    setError("")
    setResult("")
    setCandidates(undefined)
    setChecks({})
  }
  function validate(test = false) {
    setAttempted(true)
    setTesting(test)
    const found = connectionErrors(draft, connections, test)
    if (Object.keys(found).length) {
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus()
      )
      return false
    }
    return true
  }
  async function run(
    kind: string,
    action: (signal: AbortSignal) => Promise<void>
  ) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(kind)
    setError("")
    try {
      await action(controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "操作失败，请重试。"
        )
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy("")
      }
    }
  }
  function cancelRequest() {
    request.current?.abort()
    setChecks({})
    setResult("请求已取消，草稿已保留。")
    setCandidates(undefined)
  }
  function acceptAccount(saved: ModelConnection) {
    setOauth(false)
    if (active) {
      setDraft((value) => ({
        ...value,
        account: saved.account,
        issue: saved.issue,
        revision: saved.revision,
      }))
      setBaseline(saved)
      onAccountSaved?.(saved)
    } else onSaved(saved)
  }
  function updateAccount(account: NonNullable<ModelConnection["account"]>) {
    setOauth(false)
    if (service.auth && !account.loggedIn) {
      void run("account", async (signal) =>
        acceptAccount(await service.auth!.logout(draft.id, signal))
      )
      return
    }
    void run("account", async (signal) => {
      const saved = await service.save(
        { ...(active ? baseline : draft), account },
        signal
      )
      if (active) {
        setDraft((value) => ({ ...value, account }))
        setBaseline(saved)
        onAccountSaved?.(saved)
        setResult(account.loggedIn ? "账号已登录。" : "已退出登录。")
      } else onSaved(saved)
    })
  }
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
              if (validate())
                void run("save", async (signal) => {
                  onSaved(await service.save(draft, signal))
                })
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
                onRevealKey={
                  service.revealKey && draft.revision !== undefined
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
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !!busy ||
                    (draft.kind === "subscription" && !draft.account?.loggedIn)
                  }
                  onClick={() => {
                    if (validate(draft.kind === "api"))
                      void run("test", async (signal) => {
                        setCandidates(undefined)
                        setResult("")
                        const found = await service.discover(draft, signal)
                        signal.throwIfAborted()
                        setChecks({})
                        setCandidates(found)
                        setDraft((current) => ({
                          ...current,
                          models: current.models.map((model) => {
                            const candidate = found.find(
                              (item) => item.id === model.id
                            )
                            if (!candidate) return model
                            return {
                              ...model,
                              reasoning: model.reasoning ?? candidate.reasoning,
                              contextWindow:
                                model.contextWindow ?? candidate.contextWindow,
                              maxTokens: model.maxTokens ?? candidate.maxTokens,
                              thinkingLevelMap:
                                model.thinkingLevelMap ??
                                candidate.thinkingLevelMap,
                              metadata: candidate.metadata,
                            }
                          }),
                        }))
                        setResult(
                          draft.kind === "subscription"
                            ? `已读取 Pi 目录中的 ${found.length} 个候选模型；请使用“检查模型”验证账号的实际调用权限。`
                            : `目录请求成功，发现 ${found.length} 个候选模型；请使用“检查模型”验证推理调用。`
                        )
                      })
                  }}
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
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!!busy}
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
                      else if (validate()) setOauth(true)
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
                readOnly={draft.kind === "subscription" && !!service.auth}
                models={draft.models}
                busy={!!busy}
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
                onCheck={(model) => {
                  setChecks((values) => ({
                    ...values,
                    [model.id]: { text: "正在检查…" },
                  }))
                  void run("check", async (signal) => {
                    try {
                      await service.check(draft, model, signal)
                      signal.throwIfAborted()
                      setChecks((values) => ({
                        ...values,
                        [model.id]: {
                          text: service.auth
                            ? "可用 · Pi 调用成功"
                            : "可用 · 模拟检查通过",
                        },
                      }))
                    } catch (reason) {
                      if (!signal.aborted)
                        setChecks((values) => ({
                          ...values,
                          [model.id]: {
                            error: true,
                            text: `不可用 · ${reason instanceof Error ? reason.message : "检查失败"}`,
                          },
                        }))
                    }
                  })
                }}
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
        <p
          role={error ? "alert" : "status"}
          className={error ? "text-destructive" : ""}
        >
          {error ||
            (Object.keys(errors).length
              ? "请修正表单中标出的字段。"
              : dirty
                ? "有未保存的修改。"
                : "尚无未保存的修改。")}
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
            disabled={!!busy || !dirty}
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
