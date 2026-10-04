import { ConfigurationRecoveryPanel } from "./configuration-recovery-panel"
import {
  retainConfigurationAttempt,
  finishConfigurationAttempt,
  useConfigurationRecoveries,
} from "./configuration-recovery-store"
import "./model-settings.css"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { ConnectionList } from "./connection-list"
import { ConnectionEditor, type LeaveGuard } from "./connection-editor"
import { McpSettings } from "@/features/mcp/mcp-settings"
import type { McpService } from "@/features/mcp/mcp-service"
import { AddConnectionDialog } from "./add-connection-dialog"
import { SettingsConfirmDialog } from "./settings-confirmation"
import {
  readSettingsWriteReceipt,
  unknownWrite,
  writeIsUnknown,
} from "./settings-write-recovery"
import {
  blankConnection,
  credentialLabel,
  type ModelConnection,
  type ModelService,
} from "./model-types"

type DeleteAttempt = {
  operation: "remove"
  operationRequestId: string
  targetId: string
  connection: ModelConnection
}
type Deletion = {
  service: ModelService
  item: ModelConnection
  attempt?: DeleteAttempt
  issue?: FeedbackDescription
  open: boolean
}
const unresolvedDeletions = new WeakMap<ModelService, Map<string, Deletion>>()
export type ModelSettingsPageProps = {
  service: ModelService
  mcpService?: McpService
  onReturn: () => void
  onConnectionsChange?: (connections: ModelConnection[]) => void
  registerLeave?: (guard: LeaveGuard | null) => void
}
export function ModelSettingsPage({
  service,
  mcpService,
  onReturn,
  onConnectionsChange,
  registerLeave,
}: ModelSettingsPageProps) {
  const [listing, setListing] = useState<{
    service?: ModelService
    items: ModelConnection[]
    loading: boolean
    failure?: FeedbackDescription
  }>({ items: [], loading: true })
  const recovery = useConfigurationRecoveries(service.evidence === "demo")
  const restoredIds = recovery.records
    .filter((record) =>
      ["save", "remove", "authStart"].includes(record.operation)
    )
    .map((record) => record.targetId)
  const [section, setSection] = useState<"models" | "mcp">("models")
  const [editor, setEditor] = useState<{
    service: ModelService
    item: ModelConnection
  }>()
  const [adding, setAdding] = useState(false)
  const [deletion, setDeletion] = useState<Deletion | undefined>(
    () => [...(unresolvedDeletions.get(service)?.values() ?? [])][0]
  )
  const [pending, setPending] = useState<{
    service: ModelService
    cancelling: boolean
  }>()
  const [notice, setNotice] = useState("")
  const [listView, setListView] = useState({ query: "", page: 1, size: 10 })
  const publishRef = useRef(onConnectionsChange)
  useEffect(() => {
    publishRef.current = onConnectionsChange
  }, [onConnectionsChange])
  const listRequest = useRef<AbortController | null>(null)
  const request = useRef<AbortController | null>(null)
  const guard = useRef<LeaveGuard | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const storeGuard = useCallback((value: LeaveGuard | null) => {
    guard.current = value
  }, [])
  const leave = useCallback<LeaveGuard>(
    (action) => {
      if (request.current) {
        setDeletion((old) => (old ? { ...old, open: true } : old))
        return
      }
      if (guard.current) guard.current(action)
      else action()
    },
    [setDeletion]
  )
  useEffect(() => {
    registerLeave?.(leave)
    return () => registerLeave?.(null)
  }, [leave, registerLeave])
  const readList = useCallback(() => {
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    void service
      .list(controller.signal)
      .then((items) => {
        if (controller.signal.aborted || listRequest.current !== controller)
          return
        setListing({ service, items, loading: false })
        publishRef.current?.(items)
      })
      .catch((reason) => {
        if (controller.signal.aborted || listRequest.current !== controller)
          return
        setListing((old) => ({
          service,
          items: old.service === service ? old.items : [],
          loading: false,
          failure: feedbackFromError(reason, "无法读取模型连接。"),
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
      items: old.service === service ? old.items : [],
      loading: true,
    }))
    return readList()
  }, [readList, service])
  // Mount/service changes start an external read; event handlers own loading.
  // Owner-tagged results keep a previous service's data out of the new view.
  useEffect(readList, [readList])
  useEffect(
    () => () => {
      request.current?.abort()
      request.current = null
      guard.current = null
    },
    [service]
  )
  const connections = listing.service === service ? listing.items : []
  const activeEditor = editor?.service === service ? editor.item : undefined
  const retainedDeletions = [
    ...(unresolvedDeletions.get(service)?.values() ?? []),
  ]
  const activeDeletion =
    deletion?.service === service ? deletion : retainedDeletions[0]
  const busy = pending?.service === service
  const deletionUnknown = !!activeDeletion?.attempt
  function publish(items: ModelConnection[]) {
    setListing({ service, items, loading: false })
    publishRef.current?.(items)
  }
  function closeEditor(id = activeEditor?.id) {
    setEditor(undefined)
    requestAnimationFrame(() => {
      const target = id
        ? document.getElementById(`model-connection-${id}`)
        : null
      ;(
        target ??
        root.current?.querySelector<HTMLButtonElement>(".model-head button")
      )?.focus()
    })
  }
  function edit(item: ModelConnection) {
    setNotice("")
    setEditor({ service, item })
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(".model-editor-head h2")
        ?.focus({ preventScroll: true })
    )
  }
  function retain(value: Deletion) {
    let records = unresolvedDeletions.get(service)
    if (!records) {
      records = new Map()
      unresolvedDeletions.set(service, records)
    }
    if (value.attempt)
      retainConfigurationAttempt(
        {
          operation: value.attempt.operation,
          operationRequestId: value.attempt.operationRequestId,
          targetId: value.attempt.targetId,
          revision: value.attempt.connection.revision,
        },
        service.evidence === "demo"
      )
    records.set(value.item.id, value)
    setDeletion(value)
  }
  async function remove() {
    if (request.current || !activeDeletion) return
    const original = activeDeletion.item
    const attempt: DeleteAttempt = {
      operation: "remove",
      targetId: original.id,
      operationRequestId: crypto.randomUUID(),
      connection: structuredClone(original),
    }
    const controller = new AbortController()
    request.current = controller
    setPending({ service, cancelling: false })
    try {
      retain({ ...activeDeletion, attempt, issue: undefined })
      await service.remove(
        original.id,
        controller.signal,
        original.revision,
        attempt.operationRequestId
      )
      controller.signal.throwIfAborted()
      if (request.current !== controller) return
      finishConfigurationAttempt(
        attempt.operation,
        attempt.operationRequestId,
        service.evidence === "demo"
      )
      unresolvedDeletions.get(service)?.delete(original.id)
      setDeletion(undefined)
      publish(connections.filter((value) => value.id !== original.id))
      setNotice(`已删除“${original.name}”。`)
    } catch (reason) {
      if (request.current !== controller) return
      const issue = controller.signal.aborted
        ? unknownWrite(
            "删除等待已取消，最终结果仍待核对；已提交的删除不会回滚。"
          )
        : feedbackFromError(reason, "未能删除连接，目录未提前移除。")
      const next = {
        ...activeDeletion,
        attempt: writeIsUnknown(issue) ? attempt : undefined,
        issue,
        open: true,
      }
      if (next.attempt) retain(next)
      else {
        finishConfigurationAttempt(
          attempt.operation,
          attempt.operationRequestId,
          service.evidence === "demo"
        )
        unresolvedDeletions.get(service)?.delete(original.id)
        setDeletion(next)
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setPending(undefined)
      }
    }
  }
  async function checkRemoval() {
    const attempt = activeDeletion?.attempt
    if (request.current || !attempt || !activeDeletion) return
    const controller = new AbortController()
    request.current = controller
    setPending({ service, cancelling: false })
    try {
      const receipt = await readSettingsWriteReceipt(
        service.readWriteReceipt,
        attempt,
        controller.signal
      )
      if (request.current !== controller) return
      if (receipt.state === "unknown") {
        retain({
          ...activeDeletion,
          issue: unknownWrite("服务仍未确认原删除请求，请稍后再次核对。"),
        })
        return
      }
      if (receipt.state === "rejected") {
        finishConfigurationAttempt(
          attempt.operation,
          attempt.operationRequestId,
          service.evidence === "demo"
        )
        unresolvedDeletions.get(service)?.delete(attempt.targetId)
        setDeletion({
          ...activeDeletion,
          attempt: undefined,
          issue: receipt.issue
            ? feedbackFromError({ issue: receipt.issue })
            : {
                code: "write_rejected",
                recovery: "retry",
                message: "原删除请求未提交，可再次删除。",
              },
        })
        return
      }
      const items = await service.list(controller.signal)
      controller.signal.throwIfAborted()
      if (request.current !== controller) return
      publish(items)
      finishConfigurationAttempt(
        attempt.operation,
        attempt.operationRequestId,
        service.evidence === "demo"
      )
      unresolvedDeletions.get(service)?.delete(attempt.targetId)
      setDeletion(undefined)
      setNotice("原删除请求已确认完成，目录已重新读取。")
    } catch (reason) {
      if (request.current === controller && !controller.signal.aborted)
        retain({
          ...activeDeletion,
          issue: feedbackFromError(reason, "暂时无法核对原删除请求。"),
        })
    } finally {
      if (request.current === controller) {
        request.current = null
        setPending(undefined)
      }
    }
  }
  const deletionIssue = activeDeletion?.issue
  const confirmDisabled =
    deletionIssue?.recovery === "restart" ||
    deletionIssue?.recovery === "none" ||
    deletionIssue?.recovery === "settings" ||
    deletionIssue?.recovery === "reload"
  return (
    <section
      ref={root}
      className="model-settings-workspace"
      aria-label="模型设置"
    >
      <header className="model-settings-topbar">
        <h1>设置</h1>
        <Button variant="ghost" onClick={() => leave(onReturn)}>
          <ArrowLeft data-icon="inline-start" />
          返回工作台
        </Button>
      </header>
      <nav className="model-settings-nav" aria-label="设置分区">
        <h2>模型与执行</h2>
        <Button
          variant="ghost"
          aria-current={section === "models" ? "page" : undefined}
          className="w-full justify-start"
          onClick={() => {
            if (section !== "models")
              leave(() => {
                setSection("models")
                closeEditor()
              })
          }}
        >
          模型连接
        </Button>
        <Button
          variant="ghost"
          aria-current={section === "mcp" ? "page" : undefined}
          className="w-full justify-start"
          onClick={() => {
            if (section !== "mcp")
              leave(() => {
                setSection("mcp")
                closeEditor()
              })
          }}
        >
          MCP 服务
        </Button>
      </nav>
      <div className="model-settings-content">
        {section === "mcp" && (
          <McpSettings service={mcpService} registerLeave={storeGuard} />
        )}
        {section === "models" && activeEditor && (
          <ConnectionEditor
            key={activeEditor.id}
            initial={activeEditor}
            connections={connections}
            service={service}
            registerLeave={storeGuard}
            onClose={() => closeEditor()}
            onAccountSaved={(saved) =>
              publish(
                connections.some((item) => item.id === saved.id)
                  ? connections.map((item) =>
                      item.id === saved.id ? saved : item
                    )
                  : [...connections, saved]
              )
            }
            onSaved={(saved) => {
              const next = connections.some((item) => item.id === saved.id)
                ? connections.map((item) =>
                    item.id === saved.id ? saved : item
                  )
                : [...connections, saved]
              publish(next)
              setNotice(`已保存“${saved.name}”。`)
              const matches = (item: ModelConnection, query: string) =>
                `${item.name} ${item.endpoint} ${credentialLabel(item)}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase())
              const query = matches(saved, listView.query) ? listView.query : ""
              setListView({
                ...listView,
                query,
                page:
                  Math.floor(
                    next
                      .filter((item) => matches(item, query))
                      .findIndex((item) => item.id === saved.id) / listView.size
                  ) + 1,
              })
              closeEditor(saved.id)
            }}
          />
        )}
        {!activeEditor && section === "models" && (
          <div className="model-scroll">
            {notice && (
              <p className="model-page-notice" role="status">
                {notice}
              </p>
            )}
            <div className="model-page pb-0 empty:hidden">
              <ConfigurationRecoveryPanel
                service={service}
                operations={["save", "remove", "authStart"]}
                onResolved={load}
              />
            </div>
            <ConnectionList
              view={listView}
              onViewChange={(patch) =>
                setListView((old) => ({ ...old, ...patch }))
              }
              connections={connections}
              loading={listing.service !== service || listing.loading}
              failure={listing.failure}
              busy={busy}
              blockedIds={[
                ...retainedDeletions.map((record) => record.item.id),
                ...restoredIds,
              ]}
              onRetry={load}
              onAdd={() => setAdding(true)}
              onEdit={edit}
              onRemove={(item) => {
                const retained = unresolvedDeletions.get(service)?.get(item.id)
                setDeletion(
                  retained
                    ? { ...retained, open: true }
                    : { service, item, open: true }
                )
              }}
            />
            {retainedDeletions
              .filter(
                (record) =>
                  !(
                    activeDeletion?.open &&
                    activeDeletion.item.id === record.item.id
                  )
              )
              .map((record) => (
                <div key={record.item.id} className="model-page">
                  <Button
                    variant="outline"
                    onClick={() => setDeletion({ ...record, open: true })}
                  >
                    核对“{record.item.name}”的删除结果
                  </Button>
                </div>
              ))}
          </div>
        )}
      </div>
      <AddConnectionDialog
        open={adding}
        onClose={() => setAdding(false)}
        onChoose={(kind) => {
          setAdding(false)
          edit(blankConnection(kind))
        }}
      />
      <SettingsConfirmDialog
        value={
          activeDeletion?.open
            ? {
                title: deletionUnknown ? "删除结果待核对" : "删除连接？",
                description: `“${activeDeletion.item.name}”及其 ${activeDeletion.item.models.length} 个模型将移除。已有会话保留原模型选择，不会自动切换。`,
                label: deletionUnknown ? "核对删除结果" : "删除连接",
                destructive: !deletionUnknown,
                action: () => {},
              }
            : undefined
        }
        busy={busy}
        confirmDisabled={confirmDisabled}
        error={deletionIssue?.message}
        errorDetails={deletionIssue?.details}
        errorSeverity={deletionUnknown ? "warning" : deletionIssue?.severity}
        errorTitle={deletionUnknown ? "原删除尚待确认" : "删除未完成"}
        errorActions={
          deletionIssue ? (
            <RecoveryAction
              issue={deletionIssue}
              onReload={() => {
                load()
                setDeletion(undefined)
              }}
              labels={{ reload: "重新读取目录" }}
            />
          ) : undefined
        }
        onCancelRequest={() => {
          request.current?.abort()
          setPending({ service, cancelling: true })
        }}
        busyMessage={
          pending?.cancelling
            ? "正在取消等待并确认结果…"
            : deletionUnknown
              ? "正在核对原删除…"
              : "正在删除…"
        }
        onCancel={() => {
          if (activeDeletion) {
            if (deletionUnknown) retain({ ...activeDeletion, open: false })
            else setDeletion(undefined)
          }
        }}
        onConfirm={() => void (deletionUnknown ? checkRemoval() : remove())}
      />
    </section>
  )
}
