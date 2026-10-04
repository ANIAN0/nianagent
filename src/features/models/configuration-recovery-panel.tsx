import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { Button } from "@/components/ui/button"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import {
  SettingsConfirmDialog,
  type SettingsConfirmation,
} from "./settings-confirmation"
import {
  readSettingsWriteReceipt,
  unknownWrite,
} from "./settings-write-recovery"
import {
  finishConfigurationAttempt,
  recheckConfigurationRecoveryStore,
  useConfigurationRecoveries,
  type ConfigurationRecovery,
} from "./configuration-recovery-store"
import type { AuthState, WriteReceipt } from "./model-contract.generated"
function requestLabel(record: ConfigurationRecovery) {
  const labels: Record<ConfigurationRecovery["operation"], string> = {
    save: "模型连接的原保存请求",
    remove: "模型连接的原删除请求",
    mcpSave: "MCP 服务的原保存请求",
    mcpRemove: "MCP 服务的原删除请求",
    extensionConfigure: "扩展的原配置请求",
    authStart: "模型连接的原授权任务",
  }
  return labels[record.operation]
}
type Service<O extends WriteReceipt["operation"]> = {
  evidence?: "demo"
  readWriteReceipt?: (
    operation: O,
    id: string,
    signal?: AbortSignal
  ) => Promise<WriteReceipt>
  auth?: {
    poll(id: string, signal: AbortSignal): Promise<AuthState>
    cancel(id: string): Promise<void>
  }
}
export function ConfigurationRecoveryPanel<
  O extends WriteReceipt["operation"],
>({
  service,
  operations,
  onResolved,
  recoveries,
}: {
  service: Service<O>
  operations: readonly (O | "authStart")[]
  onResolved(): void
  recoveries?: ConfigurationRecovery[]
}) {
  const { records: all, issue: storageIssue } = useConfigurationRecoveries(
    service.evidence === "demo"
  )
  const records = (recoveries ?? all).filter((record) =>
    operations.includes(record.operation as O | "authStart")
  )
  const identity = records
    .map((record) => `${record.operation}:${record.operationRequestId}`)
    .join("|")
  const [feedback, setFeedback] = useState<Record<string, FeedbackDescription>>(
    {}
  )
  const [busy, setBusy] = useState<string[]>([])
  const [notice, setNotice] = useState("")
  const [finalIssue, setFinalIssue] = useState<FeedbackDescription>()
  const [confirmation, setConfirmation] = useState<SettingsConfirmation>()
  const requests = useRef(new Map<string, AbortController>())
  const checked = useRef(new Set<string>())
  const latest = useRef({ records, onResolved, service })
  // Event/effect consumers see a committed owner, never a render-time mutation.
  useLayoutEffect(() => {
    latest.current = { records, onResolved, service }
  }, [records, onResolved, service])
  const check = useCallback(
    async (record: ConfigurationRecovery, cancelAuth = false) => {
      const id = `${record.operation}:${record.operationRequestId}`
      if (requests.current.has(id)) return
      const controller = new AbortController()
      requests.current.set(id, controller)
      setBusy([...requests.current.keys()])
      try {
        if (record.operation === "authStart") {
          if (!service.auth)
            throw {
              issue: {
                code: "host_version",
                summary: "当前服务不支持原授权核对，请更新并重启 Moon。",
                recovery: "restart",
                severity: "error",
              },
            }
          if (cancelAuth) await service.auth.cancel(record.operationRequestId)
          const result = await service.auth.poll(
            record.operationRequestId,
            controller.signal
          )
          controller.signal.throwIfAborted()
          if (result.id !== record.operationRequestId)
            throw {
              issue: {
                code: "result_unknown",
                severity: "warning",
                recovery: "check",
                summary: "服务返回的授权任务身份不一致，请保留原记录。",
              },
            }
          if (
            result.issue?.recovery === "check" ||
            result.status === "pending"
          ) {
            setFeedback((old) => ({
              ...old,
              [id]: result.issue
                ? feedbackFromError({ issue: result.issue })
                : unknownWrite("原授权尚未结束，可核对或结束同一个原任务。"),
            }))
            return
          }
          finishConfigurationAttempt(
            record.operation,
            record.operationRequestId,
            service.evidence === "demo"
          )
          setFinalIssue(
            result.issue
              ? feedbackFromError({ issue: result.issue })
              : result.status === "error"
                ? {
                    code: "authorization_failed",
                    severity: "error",
                    recovery: "none",
                    message: result.error || "原授权未完成，任务已结束。",
                  }
                : undefined
          )
          setNotice("原授权任务已结束；没有再次启动授权。")
        } else {
          const receipt = await readSettingsWriteReceipt(
            service.readWriteReceipt,
            record as ConfigurationRecovery & { operation: O },
            controller.signal
          )
          controller.signal.throwIfAborted()
          if (receipt.state === "unknown") {
            setFeedback((old) => ({
              ...old,
              [id]: unknownWrite(
                "服务仍未确认原设置请求，请稍后核对。不会重复执行原写入。"
              ),
            }))
            return
          }
          finishConfigurationAttempt(
            record.operation,
            record.operationRequestId,
            service.evidence === "demo"
          )
          setFinalIssue(
            receipt.issue
              ? feedbackFromError({ issue: receipt.issue })
              : undefined
          )
          setNotice(
            `${requestLabel(record)}已确认${receipt.state === "committed" ? "提交" : "未提交"}。草稿原文未保存，凭据需重新填写。`
          )
        }
        if (!controller.signal.aborted) latest.current.onResolved()
      } catch (reason) {
        if (!controller.signal.aborted)
          setFeedback((old) => ({
            ...old,
            [id]: feedbackFromError(
              reason,
              "暂时无法核对原设置请求，请保留恢复记录。"
            ),
          }))
      } finally {
        if (requests.current.get(id) === controller) {
          requests.current.delete(id)
          setBusy([...requests.current.keys()])
        }
      }
    },
    [service]
  )
  useEffect(() => {
    for (const record of latest.current.records) {
      const id = `${record.operation}:${record.operationRequestId}`
      if (!checked.current.has(id)) {
        checked.current.add(id)
        void check(record)
      }
    }
    // IDs are the authority for this read-only recovery pass.
  }, [identity, check])
  useEffect(() => {
    const owned = requests.current
    const ownedChecks = checked.current
    return () => {
      for (const request of owned.values()) request.abort()
      owned.clear()
      ownedChecks.clear()
    }
  }, [service])
  if (!records.length && !storageIssue && !notice) return null
  return (
    <div className="flex flex-col gap-3">
      {storageIssue && (
        <OperationFeedback
          title="设置恢复记录需要处理"
          {...storageIssue}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={recheckConfigurationRecoveryStore}
            >
              重新读取本机恢复记录
            </Button>
          }
        />
      )}
      {records.map((record) => {
        const id = `${record.operation}:${record.operationRequestId}`
        const issue = feedback[id] ?? {
          code: "restoring_configuration",
          severity: "info" as const,
          recovery: "none" as const,
          message:
            "应用已重新打开，正在核对原请求。只保存请求身份，不保存密钥、请求头或草稿原文。",
        }
        return (
          <div key={id} className="flex flex-col gap-2">
            <OperationFeedback
              title={`核对${requestLabel(record)}`}
              {...issue}
              actions={
                <RecoveryAction
                  issue={issue}
                  onCheck={() => void check(record)}
                  onReload={() => void check(record)}
                  onRetry={() => void check(record)}
                  disabled={busy.includes(id)}
                  labels={{
                    check: "核对原请求",
                    reload: "核对原请求",
                    retry: "核对原请求",
                  }}
                />
              }
            />
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">请求身份</summary>
              <dl className="mt-2 grid gap-1 break-all">
                <div>对象 ID：{record.targetId}</div>
                <div>原请求 ID：{record.operationRequestId}</div>
              </dl>
            </details>
            <div className="flex flex-wrap gap-2">
              {record.operation === "authStart" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy.includes(id)}
                  onClick={() => void check(record, true)}
                >
                  结束原授权
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy.includes(id)}
                onClick={() =>
                  setConfirmation({
                    title: "放弃本机恢复记录？",
                    description:
                      "只移除本机保留的请求身份，不取消或撤销原请求；原请求仍可能提交。再次修改会产生新的请求，请先确认原操作结果。",
                    label: "放弃恢复记录",
                    destructive: true,
                    action: () => {
                      finishConfigurationAttempt(
                        record.operation,
                        record.operationRequestId,
                        service.evidence === "demo",
                        true
                      )
                      onResolved()
                    },
                  })
                }
              >
                放弃恢复记录
              </Button>
            </div>
          </div>
        )
      })}
      {notice &&
        (finalIssue ? (
          <OperationFeedback title="原请求已核对" {...finalIssue} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ))}
      <SettingsConfirmDialog
        value={confirmation}
        onCancel={() => setConfirmation(undefined)}
        onConfirm={() => {
          const action = confirmation?.action
          setConfirmation(undefined)
          void action?.()
        }}
      />
    </div>
  )
}
