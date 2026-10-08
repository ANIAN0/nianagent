import { ConfigurationRecoveryPanel } from "@/components/operations/configuration-recovery-panel"
import {
  retainConfigurationAttempt,
  finishConfigurationAttempt,
  useConfigurationRecoveries,
} from "@/lib/operations/configuration-recovery-store"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import { SettingsConfirmDialog } from "@/components/operations/settings-confirmation"
import {
  readSettingsWriteReceipt,
  unknownWrite,
  writeIsUnknown,
} from "@/lib/operations/settings-write-recovery"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { McpServerList, type McpRowFailure } from "./mcp-server-list"
import { McpServerEditor } from "./mcp-server-editor"
import {
  createMcpService,
  type McpServer,
  type McpService,
} from "./mcp-service"

type WriteAttempt = {
  operation: "mcpSave" | "mcpRemove"
  operationRequestId: string
  targetId: string
  server: McpServer
  enabled?: boolean
}
type Unresolved = {
  attempt: WriteAttempt
  issue: FeedbackDescription
  open?: boolean
}
const unresolvedWrites = new WeakMap<McpService, Map<string, Unresolved>>()
type Listing = {
  service?: McpService
  servers: McpServer[]
  loaded: boolean
  loading: boolean
  error?: FeedbackDescription
}
export type McpSettingsProps = {
  service?: McpService
  cwd?: string
  registerLeave?: (guard: LeaveGuard | null) => void
}

export function McpSettings({
  service: supplied,
  cwd,
  registerLeave,
}: McpSettingsProps) {
  const [fallback] = useState(createMcpService)
  const service = supplied || fallback
  const recovery = useConfigurationRecoveries(service.evidence === "demo")
  const restoredNames = recovery.records
    .filter((record) => ["mcpSave", "mcpRemove"].includes(record.operation))
    .map((record) => record.targetId)
  const [listing, setListing] = useState<Listing>({
    servers: [],
    loaded: false,
    loading: true,
  })
  const [query, setQuery] = useState("")
  const [editor, setEditor] = useState<{
    service: McpService
    initial?: McpServer
  }>()
  const [confirmation, setConfirmation] = useState<{
    service: McpService
    server: McpServer
    error?: FeedbackDescription
    open?: boolean
  }>()
  const [rows, setRows] = useState<{
    service?: McpService
    failures: Record<string, McpRowFailure>
  }>({ failures: {} })
  const [pending, setPending] = useState<{
    service?: McpService
    names: string[]
  }>({ names: [] })
  const [leaveNotice, setLeaveNotice] = useState(false)
  const [, refreshRetained] = useState(0)
  const guard = useRef<LeaveGuard | null>(null)
  const requests = useRef(new Map<string, AbortController>())
  const listRequest = useRef<AbortController | null>(null)
  const activeEditor = editor?.service === service ? editor : undefined
  const retained = unresolvedWrites.get(service)
  const retainedRemoval = [...(retained?.values() ?? [])].find(
    (item) => item.attempt.operation === "mcpRemove"
  )
  const activeConfirmation =
    confirmation?.service === service
      ? confirmation
      : retainedRemoval
        ? {
            service,
            server: retainedRemoval.attempt.server,
            error: retainedRemoval.issue,
            open: retainedRemoval.open ?? false,
          }
        : undefined
  const activeListing = listing.service === service ? listing : undefined
  const busyNames = pending.service === service ? pending.names : []
  const rowFailures = {
    ...(rows.service === service ? rows.failures : {}),
    ...Object.fromEntries(
      [...(retained?.values() ?? [])]
        .filter((record) => record.attempt.operation === "mcpSave")
        .map((record) => [
          record.attempt.targetId,
          { ...record.issue, enabled: !!record.attempt.enabled },
        ])
    ),
  }
  function remember(record: Unresolved) {
    retainConfigurationAttempt(
      {
        operation: record.attempt.operation,
        operationRequestId: record.attempt.operationRequestId,
        targetId: record.attempt.targetId,
        revision: record.attempt.server.revision,
      },
      service.evidence === "demo"
    )
    let records = unresolvedWrites.get(service)
    if (!records) {
      records = new Map()
      unresolvedWrites.set(service, records)
    }
    records.set(record.attempt.targetId, record)
    refreshRetained((value) => value + 1)
  }
  function clearAttempt(name: string) {
    const current = unresolvedWrites.get(service)?.get(name)?.attempt
    if (current)
      finishConfigurationAttempt(
        current.operation,
        current.operationRequestId,
        service.evidence === "demo"
      )
    unresolvedWrites.get(service)?.delete(name)
    refreshRetained((value) => value + 1)
  }
  const leave = useCallback<LeaveGuard>((action) => {
    if (requests.current.size) {
      setLeaveNotice(true)
      return
    }
    if (guard.current) guard.current(action)
    else action()
  }, [])
  const storeGuard = useCallback((value: LeaveGuard | null) => {
    guard.current = value
  }, [])
  useEffect(() => {
    registerLeave?.(leave)
    return () => registerLeave?.(null)
  }, [registerLeave, leave])
  const readList = useCallback(() => {
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    void service
      .list(controller.signal)
      .then((servers) => {
        if (controller.signal.aborted || listRequest.current !== controller)
          return
        setListing({ service, servers, loaded: true, loading: false })
      })
      .catch((reason) => {
        if (controller.signal.aborted || listRequest.current !== controller)
          return
        setListing((old) => ({
          service,
          servers: old.service === service ? old.servers : [],
          loaded: old.service === service && old.loaded,
          loading: false,
          error: feedbackFromError(reason, "无法读取 MCP 服务。"),
        }))
      })
    return () => {
      controller.abort()
      if (listRequest.current === controller) listRequest.current = null
    }
  }, [service])
  const load = useCallback(() => {
    setListing((old) => ({
      service,
      servers: old.service === service ? old.servers : [],
      loaded: old.service === service && old.loaded,
      loading: true,
    }))
    return readList()
  }, [readList, service])
  // Mount/service changes start an external read; event handlers own loading.
  // Owner-tagged results keep a previous service's data out of the new view.
  useEffect(readList, [readList])
  useEffect(() => {
    const owned = requests.current
    return () => {
      for (const controller of owned.values()) controller.abort()
      owned.clear()
      guard.current = null
    }
  }, [service])
  function publishFailure(attempt: WriteAttempt, issue: FeedbackDescription) {
    if (attempt.operation === "mcpSave")
      setRows((old) => ({
        service,
        failures: {
          ...(old.service === service ? old.failures : {}),
          [attempt.targetId]: { ...issue, enabled: !!attempt.enabled },
        },
      }))
    else
      setConfirmation({
        service,
        server: attempt.server,
        error: issue,
        open: true,
      })
  }
  function clearFailure(name: string) {
    setRows((old) => {
      if (old.service !== service) return old
      const failures = { ...old.failures }
      delete failures[name]
      return { ...old, failures }
    })
  }
  async function mutate(
    server: McpServer,
    kind: "toggle" | "remove",
    enabled?: boolean
  ) {
    const name = server.configuration.name
    if (requests.current.has(name) || retained?.has(name)) return
    const controller = new AbortController()
    requests.current.set(name, controller)
    setPending({ service, names: [...requests.current.keys()] })
    setLeaveNotice(false)
    clearFailure(name)
    const attempt: WriteAttempt = {
      operation: kind === "toggle" ? "mcpSave" : "mcpRemove",
      operationRequestId: crypto.randomUUID(),
      targetId: name,
      server: structuredClone(server),
      enabled,
    }
    try {
      remember({
        attempt,
        issue: unknownWrite("正在等待原操作的提交结果。"),
        open: kind === "remove",
      })
      if (kind === "remove") setConfirmation({ service, server, open: true })
      if (kind === "toggle") {
        const saved = await service.save(
          { ...server.configuration, enabled: !!enabled },
          server.revision,
          controller.signal,
          attempt.operationRequestId
        )
        controller.signal.throwIfAborted()
        if (requests.current.get(name) !== controller) return
        setListing((old) =>
          old.service === service
            ? {
                ...old,
                servers: old.servers.map((item) =>
                  item.configuration.name === name ? saved : item
                ),
              }
            : old
        )
      } else {
        await service.remove(
          name,
          server.revision,
          controller.signal,
          attempt.operationRequestId
        )
        controller.signal.throwIfAborted()
        if (requests.current.get(name) !== controller) return
        setConfirmation(undefined)
        setListing((old) =>
          old.service === service
            ? {
                ...old,
                servers: old.servers.filter(
                  (item) => item.configuration.name !== name
                ),
              }
            : old
        )
      }
      clearAttempt(name)
      load()
    } catch (reason) {
      if (requests.current.get(name) !== controller) return
      const issue = controller.signal.aborted
        ? unknownWrite("已取消等待，原操作的最终结果仍待核对。")
        : feedbackFromError(
            reason,
            kind === "toggle" ? "未能保存启用状态。" : "未能删除服务。"
          )
      if (writeIsUnknown(issue))
        remember({ attempt, issue, open: kind === "remove" })
      else clearAttempt(name)
      publishFailure(attempt, issue)
    } finally {
      if (requests.current.get(name) === controller) {
        requests.current.delete(name)
        setPending({ service, names: [...requests.current.keys()] })
      }
    }
  }
  async function checkMutation(name: string) {
    const record = unresolvedWrites.get(service)?.get(name)
    if (!record || requests.current.has(name)) return
    const controller = new AbortController()
    requests.current.set(name, controller)
    setPending({ service, names: [...requests.current.keys()] })
    try {
      const receipt = await readSettingsWriteReceipt(
        service.readWriteReceipt,
        record.attempt,
        controller.signal
      )
      if (requests.current.get(name) !== controller) return
      if (receipt.state === "unknown") {
        const issue = unknownWrite("服务仍未确认原操作，请稍后再次核对。")
        remember({ ...record, issue })
        publishFailure(record.attempt, issue)
        return
      }
      if (receipt.state === "rejected") {
        clearAttempt(name)
        publishFailure(
          record.attempt,
          receipt.issue
            ? feedbackFromError({ issue: receipt.issue })
            : {
                code: "write_rejected",
                recovery: "retry",
                message: "原操作未提交，可再次执行。",
              }
        )
        return
      }
      const servers = await service.list(controller.signal)
      controller.signal.throwIfAborted()
      if (requests.current.get(name) !== controller) return
      setListing({ service, servers, loaded: true, loading: false })
      clearAttempt(name)
      clearFailure(name)
      if (record.attempt.operation === "mcpRemove") setConfirmation(undefined)
    } catch (reason) {
      if (
        !controller.signal.aborted &&
        requests.current.get(name) === controller
      ) {
        const issue = feedbackFromError(reason, "暂时无法核对原操作。")
        remember({ ...record, issue })
        publishFailure(record.attempt, issue)
      }
    } finally {
      if (requests.current.get(name) === controller) {
        requests.current.delete(name)
        setPending({ service, names: [...requests.current.keys()] })
      }
    }
  }
  const deletionName = activeConfirmation?.server.configuration.name
  const deletionUnknown =
    !!deletionName && unresolvedWrites.get(service)?.has(deletionName) === true
  const issue = activeConfirmation?.error
  const confirmDisabled =
    issue?.recovery === "restart" ||
    issue?.recovery === "none" ||
    issue?.recovery === "settings" ||
    issue?.recovery === "reload"
  return (
    <div className="model-scroll">
      {activeEditor ? (
        <McpServerEditor
          key={activeEditor.initial?.configuration.name || "new"}
          initial={activeEditor.initial}
          service={service}
          cwd={cwd}
          registerLeave={storeGuard}
          onClose={() => setEditor(undefined)}
          onSaved={(saved, keepOpen) => {
            clearFailure(saved.configuration.name)
            setListing((old) =>
              old.service === service
                ? {
                    ...old,
                    servers: [
                      ...old.servers.filter(
                        (item) =>
                          item.configuration.name !== saved.configuration.name
                      ),
                      saved,
                    ],
                  }
                : old
            )
            if (!keepOpen) setEditor(undefined)
            load()
          }}
        />
      ) : (
        <>
          {leaveNotice && busyNames.length > 0 && (
            <div className="model-page pb-0">
              <OperationFeedback
                title="请等待当前操作完成"
                message={`正在处理 ${busyNames.join("、")}；完成后可离开设置。`}
                severity="info"
              />
            </div>
          )}
          <div className="model-page pb-0 empty:hidden">
            <ConfigurationRecoveryPanel
              service={service}
              operations={["mcpSave", "mcpRemove"]}
              onResolved={load}
            />
          </div>
          <McpServerList
            servers={activeListing?.servers || []}
            loading={!activeListing || activeListing.loading}
            hasLoaded={activeListing?.loaded}
            error={activeListing?.error?.message || ""}
            errorDetails={activeListing?.error?.details}
            failure={activeListing?.error}
            busyNames={busyNames}
            rowFailures={rowFailures}
            unresolvedNames={[...(retained?.keys() ?? []), ...restoredNames]}
            removalPending={deletionUnknown ? deletionName : undefined}
            query={query}
            onQuery={setQuery}
            onAdd={() => setEditor({ service })}
            onEdit={(initial) => setEditor({ service, initial })}
            onRetry={load}
            onCheckToggle={(server) =>
              void checkMutation(server.configuration.name)
            }
            onRetryToggle={(server, enabled) =>
              void mutate(server, "toggle", enabled)
            }
            onToggle={(server, enabled) =>
              void mutate(server, "toggle", enabled)
            }
            onRemove={(server) => {
              const record = unresolvedWrites
                .get(service)
                ?.get(server.configuration.name)
              setConfirmation({
                service,
                server: record?.attempt.server ?? server,
                error: record?.issue,
                open: true,
              })
            }}
          />
          {[...(retained?.values() ?? [])]
            .filter(
              (record) =>
                record.attempt.operation === "mcpRemove" &&
                !(
                  activeConfirmation?.open !== false &&
                  activeConfirmation?.server.configuration.name ===
                    record.attempt.targetId
                )
            )
            .map((record) => (
              <div key={record.attempt.targetId} className="model-page pt-0">
                <Button
                  variant="outline"
                  onClick={() =>
                    setConfirmation({
                      service,
                      server: record.attempt.server,
                      error: record.issue,
                      open: true,
                    })
                  }
                >
                  核对“{record.attempt.targetId}”的删除结果
                </Button>
              </div>
            ))}
        </>
      )}
      <SettingsConfirmDialog
        value={
          activeConfirmation?.open !== false && activeConfirmation
            ? {
                title: `删除 ${deletionName}？`,
                description:
                  "服务配置和工具将移除；正在执行的会话在本轮结束后生效。已有外部操作不撤销。",
                label: deletionUnknown ? "核对删除结果" : "删除服务",
                destructive: !deletionUnknown,
                action: () => {},
              }
            : undefined
        }
        busy={!!deletionName && busyNames.includes(deletionName)}
        confirmDisabled={confirmDisabled}
        error={issue?.message}
        errorDetails={issue?.details}
        errorTitle={deletionUnknown ? "删除结果待核对" : "未能删除 MCP 服务"}
        errorSeverity={deletionUnknown ? "warning" : issue?.severity}
        errorActions={
          issue ? (
            <RecoveryAction
              issue={issue}
              onReload={load}
              labels={{ reload: "重新读取服务目录" }}
            />
          ) : undefined
        }
        onCancelRequest={() => {
          if (!deletionName) return
          const controller = requests.current.get(deletionName)
          const record = unresolvedWrites.get(service)?.get(deletionName)
          if (record) {
            const issue = unknownWrite(
              "已取消等待原删除，最终结果仍待核对；不会重复删除。"
            )
            remember({ ...record, issue, open: true })
            publishFailure(record.attempt, issue)
          }
          controller?.abort()
        }}
        busyMessage="正在处理原删除…"
        onConfirm={() => {
          if (activeConfirmation)
            void (deletionUnknown
              ? checkMutation(deletionName!)
              : mutate(activeConfirmation.server, "remove"))
        }}
        onCancel={() => {
          if (activeConfirmation && !requests.current.has(deletionName!)) {
            setConfirmation(
              deletionUnknown
                ? { ...activeConfirmation, open: false }
                : undefined
            )
            const record = unresolvedWrites.get(service)?.get(deletionName!)
            if (record) remember({ ...record, open: false })
          }
        }}
      />
    </div>
  )
}
