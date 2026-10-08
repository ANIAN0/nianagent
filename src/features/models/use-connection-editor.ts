import { useRetainedWrite } from "@/lib/operations/use-retained-write"
import { recheckConfigurationRecoveryStore } from "@/lib/operations/configuration-recovery-store"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import type { SettingsConfirmation } from "@/components/operations/settings-confirmation"
import {
  connectionErrors,
  type ModelConnection,
  type ModelDefinition,
  type ModelService,
} from "./model-types"
import {
  readSettingsWriteReceipt,
  unknownWrite,
  writeIsUnknown,
} from "@/lib/operations/settings-write-recovery"
import type { ConnectionEditorProps } from "./connection-editor"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"

export type ModelCheckState = {
  text: string
  error?: boolean
  issue?: FeedbackDescription
}
type SaveAttempt = {
  operation: "save"
  operationRequestId: string
  targetId: string
  connection: ModelConnection
}
type RetainedSave = {
  attempt: SaveAttempt
  draft: ModelConnection
  baseline: ModelConnection
  issue: FeedbackDescription
}
const retainedSaves = new WeakMap<ModelService, Map<string, RetainedSave>>()
type AccountUncertainty = {
  draft: ModelConnection
  baseline: ModelConnection
  issue: FeedbackDescription
}
// Logout has no write receipt. This owner retains only an unresolved account
// read requirement across panel navigation; it never certifies the old write.
const unresolvedAccounts = new WeakMap<
  ModelService,
  Map<string, AccountUncertainty>
>()
export function mergeAccountSnapshot(
  draft: ModelConnection,
  saved: ModelConnection
): ModelConnection {
  return {
    ...draft,
    account: saved.account,
    keySaved: saved.keySaved,
    accountOperationBusy: saved.accountOperationBusy,
    issue: saved.issue,
    revision: saved.revision,
  }
}

export function useConnectionEditor({
  initial,
  connections,
  service,
  onSaved,
  onAccountSaved,
  onClose,
  registerLeave,
}: ConnectionEditorProps) {
  const retained = retainedSaves.get(service)?.get(initial.id)
  const retainedAccount = unresolvedAccounts.get(service)?.get(initial.id)
  const [baseline, setBaseline] = useState(
    retained?.baseline ?? retainedAccount?.baseline ?? initial
  )
  const [draft, setDraft] = useState(() =>
    structuredClone(retained?.draft ?? retainedAccount?.draft ?? initial)
  )
  const [attempted, setAttempted] = useState(false)
  const [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState("")
  const [waitingToLeave, setWaitingToLeave] = useState(false)
  const [saveFailure, setSaveFailure] = useState<
    FeedbackDescription | undefined
  >(retained?.issue)
  const [discoveryFailure, setDiscoveryFailure] =
    useState<FeedbackDescription>()
  const [accountFailure, setAccountFailure] = useState<
    FeedbackDescription | undefined
  >(retainedAccount?.issue)
  const accountUnresolved = useRef(!!retainedAccount)
  const accountConflictRef = useRef(false)
  const [accountUnknown, setAccountUnknown] = useState(!!retainedAccount)
  const [providersFailure, setProvidersFailure] =
    useState<FeedbackDescription>()
  const [result, setResult] = useState("")
  const [candidates, setCandidates] = useState<ModelDefinition[]>()
  const [checks, setChecks] = useState<Record<string, ModelCheckState>>({})
  const [confirm, setConfirm] = useState<SettingsConfirmation>()
  const [oauth, setOauth] = useState(false)
  const [providers, setProviders] = useState<{ id: string; name: string }[]>()
  const [providerLoad, setProviderLoad] = useState(0)
  const form = useRef<HTMLFormElement>(null)
  const request = useRef<AbortController | null>(null)
  const latest = useRef({ draft, baseline })
  useLayoutEffect(() => {
    latest.current = { draft, baseline }
  }, [draft, baseline])
  const submitted = useRef<SaveAttempt | null>(retained?.attempt ?? null)
  const { hasUnresolved, remember, clearAttempt } = useRetainedWrite<
    ModelService,
    SaveAttempt,
    RetainedSave
  >({
    submitted: submitted,
    service,
    recordKey: initial.id,
    records: retainedSaves,
    identity: (a) => ({
      operation: a.operation,
      operationRequestId: a.operationRequestId,
      targetId: a.targetId,
      revision: a.connection.revision,
    }),
    snapshot: (attempt: SaveAttempt, issue) => ({
      attempt,
      ...structuredClone(latest.current),
      issue,
    }),
  })

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const errors = attempted ? connectionErrors(draft, connections, testing) : {}
  const active = connections.some((value) => value.id === initial.id)
  const saveUnknown = hasUnresolved
  const accountConflict =
    accountFailure?.code === "account_revision_changed" ||
    accountFailure?.code === "account_connection_missing"
  const accountBlocked = accountUnknown || accountConflict
  const saveConflict = !saveUnknown && saveFailure?.recovery === "reload"
  const saveBlocked =
    saveFailure?.severity !== "info" &&
    (saveFailure?.recovery === "restart" || saveFailure?.recovery === "none")
  const discoveryBlocked =
    discoveryFailure?.severity !== "info" &&
    (discoveryFailure?.recovery === "restart" ||
      discoveryFailure?.recovery === "none")

  function rememberAccount(issue: FeedbackDescription) {
    accountUnresolved.current = true
    setAccountUnknown(true)
    let records = unresolvedAccounts.get(service)
    if (!records) {
      records = new Map()
      unresolvedAccounts.set(service, records)
    }
    records.set(initial.id, { ...structuredClone(latest.current), issue })
  }
  function clearAccountUncertainty() {
    accountUnresolved.current = false
    accountConflictRef.current = false
    setAccountUnknown(false)
    unresolvedAccounts.get(service)?.delete(initial.id)
  }
  function recoverStorage() {
    if (service.evidence === "demo" || recheckConfigurationRecoveryStore())
      setSaveFailure(undefined)
  }
  useEffect(() => {
    if (!service.providers || draft.kind !== "subscription") return
    const controller = new AbortController()
    setProvidersFailure(undefined)
    void service
      .providers(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setProviders(items)
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setProvidersFailure(feedbackFromError(reason, "无法读取订阅提供者。"))
      })
    return () => controller.abort()
  }, [service, providerLoad, draft.kind])
  useEffect(
    () => () => {
      request.current?.abort()
      request.current = null
      const accountRecord = unresolvedAccounts.get(service)?.get(initial.id)
      if (accountRecord)
        unresolvedAccounts.get(service)?.set(initial.id, {
          ...accountRecord,
          ...structuredClone(latest.current),
        })
      const attempt = submitted.current
      if (attempt) {
        const records = retainedSaves.get(service)
        const record = records?.get(initial.id)
        if (record)
          records?.set(initial.id, {
            ...record,
            ...structuredClone(latest.current),
          })
      }
    },
    [service, initial.id]
  )
  const askLeave = useCallback<LeaveGuard>(
    (action) => {
      if (busy) {
        setWaitingToLeave(true)
        return
      }
      if (dirty || saveUnknown || accountUnknown)
        setConfirm({
          title:
            saveUnknown || accountUnknown
              ? "离开连接配置？"
              : "放弃未保存更改？",
          description: saveUnknown
            ? "保存结果仍待核对。草稿和原操作会保留；离开不会撤销可能已完成的保存。"
            : accountUnknown
              ? "当前登录状态尚未读取。草稿和核对入口会保留；离开不会撤销退出登录。"
              : "当前连接与模型的修改尚未保存。",
          label: saveUnknown || accountUnknown ? "离开配置" : "放弃更改",
          destructive: !saveUnknown && !accountUnknown,
          action,
        })
      else action()
    },
    [dirty, busy, saveUnknown, accountUnknown]
  )
  useEffect(() => {
    registerLeave?.(askLeave)
    return () => registerLeave?.(null)
  }, [askLeave, registerLeave])
  useEffect(() => {
    if (!dirty && !saveUnknown && !accountUnknown) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, saveUnknown, accountUnknown])
  function change(patch: Partial<ModelConnection>) {
    setDraft((value) => ({ ...value, ...patch }))
    setDiscoveryFailure(undefined)
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
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(kind)
    setWaitingToLeave(false)
    if (kind === "test") setDiscoveryFailure(undefined)
    if (kind === "account" || kind === "account-read")
      setAccountFailure(undefined)
    try {
      await action(controller.signal)
    } catch (reason) {
      if (request.current !== controller) return
      const issue = feedbackFromError(reason, "操作未完成，当前输入已保留。")
      if (kind === "save" || kind === "receipt") {
        if (
          submitted.current &&
          (controller.signal.aborted || writeIsUnknown(issue))
        ) {
          const unknown = controller.signal.aborted
            ? unknownWrite("保存等待已取消，提交结果仍待核对。")
            : issue
          remember(submitted.current, unknown)
          setSaveFailure(unknown)
        } else {
          if (kind === "receipt" && submitted.current)
            remember(submitted.current, issue)
          setSaveFailure(issue)
        }
      } else if (kind === "test") {
        setDiscoveryFailure(issue)
        setResult("")
      } else if (kind === "account" || kind === "account-read") {
        if (
          kind === "account-read" ||
          controller.signal.aborted ||
          writeIsUnknown(issue)
        ) {
          rememberAccount(
            controller.signal.aborted
              ? unknownWrite(
                  "退出等待已中止，请读取当前登录状态；这不确认原退出请求的结果。"
                )
              : issue
          )
        } else clearAccountUncertainty()
        setAccountFailure(issue)
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy("")
      }
    }
  }
  function cancelRequest() {
    if (busy !== "test" && busy !== "check") return
    request.current?.abort()
    setCandidates(undefined)
    if (busy === "check")
      setChecks((old) =>
        Object.fromEntries(
          Object.entries(old).map(([id, item]) => [
            id,
            item.text === "正在检查…" ? { text: "检查已取消。" } : item,
          ])
        )
      )
    else {
      setDiscoveryFailure(undefined)
      setResult("连接测试已取消，草稿已保留。")
    }
  }
  function acceptAccount(
    saved: ModelConnection,
    issue?: FeedbackDescription,
    preserveDraft = false
  ) {
    setOauth(false)
    clearAccountUncertainty()
    setAccountFailure(issue)
    if (active || issue) {
      setDraft((value) =>
        preserveDraft
          ? mergeAccountSnapshot(value, saved)
          : structuredClone(saved)
      )
      setBaseline(saved)
      onAccountSaved?.(saved)
      if (!preserveDraft) {
        setCandidates(undefined)
        setResult("")
        setChecks({})
        setSaveFailure(undefined)
      }
    } else onSaved(saved)
  }
  function startAuthorization() {
    if (
      request.current ||
      accountUnresolved.current ||
      accountConflictRef.current ||
      saveUnknown ||
      saveConflict ||
      !validate()
    )
      return false
    setOauth(true)
    return true
  }
  function updateAccount(account: NonNullable<ModelConnection["account"]>) {
    if (
      request.current ||
      accountUnresolved.current ||
      accountConflictRef.current ||
      saveUnknown ||
      saveConflict
    )
      return
    setOauth(false)
    if (!account.loggedIn)
      rememberAccount(unknownWrite("正在等待退出登录结果。"))
    void run("account", async (signal) => {
      const saved =
        service.auth && !account.loggedIn
          ? await service.auth.logout(draft.id, signal)
          : await service.save(
              { ...(active ? baseline : draft), account },
              signal
            )
      signal.throwIfAborted()
      acceptAccount(saved, undefined, true)
    })
  }
  function readAccountState() {
    if (request.current || saveUnknown || saveConflict) return
    void run("account-read", async (signal) => {
      const items = await service.list(signal)
      signal.throwIfAborted()
      const saved = items.find((item) => item.id === initial.id)
      if (!saved || saved.kind !== "subscription" || !saved.account) {
        clearAccountUncertainty()
        accountConflictRef.current = true
        setAccountFailure({
          code: "account_connection_missing",
          severity: "warning",
          recovery: "reload",
          message:
            "当前订阅连接已删除或变更。草稿保留，请返回连接目录；此次读取没有确认原退出请求。",
        })
        return
      }
      if (typeof saved.accountOperationBusy !== "boolean") {
        throw {
          issue: {
            code: "host_version",
            recovery: "restart",
            severity: "error",
            summary:
              "当前桌面服务无法确认账号操作是否结束，请更新并重启 Moon。再次读取登录值不能确认原退出已停止。",
          },
        }
      }
      if (saved.accountOperationBusy === true) {
        const issue: FeedbackDescription = {
          code: "account_operation_pending",
          recovery: "check",
          severity: "warning",
          message:
            "账号清理仍在进行，当前登录值不能确认原退出已停止。请稍后核对当前登录状态；不会再次退出或启动授权。",
        }
        setDraft((current) =>
          mergeAccountSnapshot(current, {
            ...saved,
            revision: latest.current.baseline.revision,
          })
        )
        rememberAccount(issue)
        setAccountFailure(issue)
        return
      }
      if (saved.revision !== latest.current.baseline.revision) {
        clearAccountUncertainty()
        accountConflictRef.current = true
        setDraft((current) =>
          mergeAccountSnapshot(current, {
            ...saved,
            revision: latest.current.baseline.revision,
          })
        )
        onAccountSaved?.(saved)
        setAccountFailure({
          code: "account_revision_changed",
          severity: "warning",
          recovery: "reload",
          message: `当前账号${saved.account.loggedIn ? "仍显示已登录" : "显示未登录"}，连接配置也已变化。草稿保留，请返回目录读取最新配置；没有确认原退出请求。`,
        })
        return
      }
      acceptAccount(
        saved,
        {
          code: "account_state_checked",
          severity: "info",
          recovery: "none",
          message: `已读取当前登录状态：${saved.account.loggedIn ? "已登录" : "未登录"}，账号操作已结束。这是当前状态，不是原退出请求的回执；其余草稿保留。`,
        },
        true
      )
    })
  }
  function save() {
    if (
      request.current ||
      accountUnresolved.current ||
      accountConflictRef.current ||
      saveUnknown ||
      saveConflict ||
      saveBlocked ||
      !validate()
    )
      return
    const captured = structuredClone(draft)
    const attempt: SaveAttempt = {
      operation: "save",
      operationRequestId: crypto.randomUUID(),
      targetId: draft.id,
      connection: captured,
    }
    submitted.current = attempt
    try {
      remember(attempt, unknownWrite("正在等待此连接的保存结果。"))
    } catch (reason) {
      submitted.current = null
      setSaveFailure(
        feedbackFromError(reason, "无法保存原请求恢复记录，未发起连接保存。")
      )
      return
    }
    setSaveFailure(undefined)
    void run("save", async (signal) => {
      try {
        const saved = await service.save(
          captured,
          signal,
          attempt.operationRequestId
        )
        signal.throwIfAborted()
        clearAttempt()
        onSaved(saved)
      } catch (reason) {
        const issue = feedbackFromError(reason)
        if (!signal.aborted && !writeIsUnknown(issue)) clearAttempt()
        throw reason
      }
    })
  }
  function checkSaved() {
    const attempt = submitted.current
    if (!attempt) return
    void run("receipt", async (signal) => {
      const receipt = await readSettingsWriteReceipt(
        service.readWriteReceipt,
        attempt,
        signal
      )
      if (receipt.state === "unknown") {
        const issue = unknownWrite(
          "服务仍未确认本次保存。草稿与原请求已保留，请稍后再核对。"
        )
        remember(attempt, issue)
        setSaveFailure(issue)
        return
      }
      if (receipt.state === "rejected") {
        clearAttempt()
        setSaveFailure(
          receipt.issue
            ? feedbackFromError({ issue: receipt.issue })
            : {
                code: "write_rejected",
                message: "本次保存未提交。草稿已保留，可修正后重新保存。",
                recovery: "retry",
              }
        )
        return
      }
      const items = await service.list(signal)
      signal.throwIfAborted()
      const saved = items.find((item) => item.id === attempt.targetId)
      if (
        !saved ||
        (receipt.revision !== undefined && saved.revision !== receipt.revision)
      ) {
        clearAttempt()
        setSaveFailure({
          code: "revision_changed",
          recovery: "reload",
          message:
            "原保存已确认提交，但连接随后又被修改或删除。草稿保留，请返回目录查看最新状态。",
        })
        return
      }
      const current = latest.current.draft
      const laterDraft =
        JSON.stringify(current) !== JSON.stringify(attempt.connection)
      clearAttempt()
      setBaseline(saved)
      if (laterDraft) {
        setDraft({ ...current, revision: saved.revision })
        onAccountSaved?.(saved)
        setSaveFailure({
          code: "write_confirmed",
          severity: "info",
          recovery: "none",
          message: "原保存已确认提交，表单保留后续修改，尚未保存。",
        })
      } else onSaved(saved)
    })
  }
  function discover() {
    if (
      request.current ||
      saveUnknown ||
      saveConflict ||
      discoveryBlocked ||
      !validate(draft.kind === "api")
    )
      return
    const captured = structuredClone(draft)
    void run("test", async (signal) => {
      setCandidates(undefined)
      setResult("")
      const found = await service.discover(captured, signal)
      signal.throwIfAborted()
      setChecks({})
      setCandidates(found)
      setDraft((current) => ({
        ...current,
        models: current.models.map((model) => {
          const candidate = found.find((item) => item.id === model.id)
          if (!candidate) return model
          return {
            ...model,
            reasoning: model.reasoning ?? candidate.reasoning,
            contextWindow: model.contextWindow ?? candidate.contextWindow,
            maxTokens: model.maxTokens ?? candidate.maxTokens,
            thinkingLevelMap:
              model.thinkingLevelMap ?? candidate.thinkingLevelMap,
            metadata: candidate.metadata,
          }
        }),
      }))
      setResult(
        service.evidence === "demo"
          ? `示例目录返回 ${found.length} 个候选模型；未调用真实模型服务。`
          : draft.kind === "subscription"
            ? `已读取 Pi 目录中的 ${found.length} 个候选模型；请检查模型以验证账号调用权限。`
            : `目录请求成功，发现 ${found.length} 个候选模型；请检查模型以验证推理调用。`
      )
    })
  }
  function checkModel(model: ModelDefinition) {
    if (
      request.current ||
      busy ||
      saveUnknown ||
      !validate(draft.kind === "api")
    )
      return
    setChecks((values) => ({ ...values, [model.id]: { text: "正在检查…" } }))
    void run("check", async (signal) => {
      try {
        await service.check(draft, model, signal)
        signal.throwIfAborted()
        setChecks((values) => ({
          ...values,
          [model.id]: {
            text:
              service.evidence === "demo"
                ? "示例检查通过 · 未调用真实模型"
                : "可用 · Pi 调用成功",
          },
        }))
      } catch (reason) {
        if (!signal.aborted)
          setChecks((values) => ({
            ...values,
            [model.id]: {
              error: true,
              text: "模型检查未完成",
              issue: feedbackFromError(reason, "无法完成模型检查。"),
            },
          }))
      }
    })
  }
  return {
    baseline,
    draft,
    setDraft,
    attempted,
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
    reloadProviders: () => setProviderLoad((value) => value + 1),
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
    validate,
    askLeave,
    cancelRequest,
    acceptAccount,
    updateAccount,
    save,
    checkSaved,
    discover,
    checkModel,
    onClose,
  }
}
