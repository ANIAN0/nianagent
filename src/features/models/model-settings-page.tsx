import "./model-settings.css"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConnectionList } from "./connection-list"
import { ConnectionEditor, type LeaveGuard } from "./connection-editor"
import { AddConnectionDialog } from "./add-connection-dialog"
import {
  SettingsConfirmDialog,
  type SettingsConfirmation,
} from "./settings-confirmation"
import {
  blankConnection,
  credentialLabel,
  type ModelConnection,
  type ModelService,
} from "./model-types"

export type ModelSettingsPageProps = {
  service: ModelService
  onReturn: () => void
  onConnectionsChange?: (connections: ModelConnection[]) => void
  registerLeave?: (guard: LeaveGuard | null) => void
}
export function ModelSettingsPage({
  service,
  onReturn,
  onConnectionsChange,
  registerLeave,
}: ModelSettingsPageProps) {
  const [connections, setConnections] = useState<ModelConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const [editor, setEditor] = useState<ModelConnection>()
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<SettingsConfirmation>()
  const [confirmError, setConfirmError] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [listView, setListView] = useState({ query: "", page: 1, size: 10 })
  const publishRef = useRef(onConnectionsChange)
  useEffect(() => {
    publishRef.current = onConnectionsChange
  }, [onConnectionsChange])
  const request = useRef<AbortController | null>(null)
  const guard = useRef<LeaveGuard | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const storeGuard = useCallback((value: LeaveGuard | null) => {
    guard.current = value
  }, [])
  const leave = useCallback<LeaveGuard>((action) => {
    if (guard.current) guard.current(action)
    else action()
  }, [])
  useEffect(() => {
    registerLeave?.(leave)
    return () => registerLeave?.(null)
  }, [leave, registerLeave])
  useEffect(() => {
    const controller = new AbortController()
    service
      .list(controller.signal)
      .then((items) => {
        setConnections(items)
        publishRef.current?.(items)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "读取失败。")
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [service, revision])
  useEffect(() => () => request.current?.abort(), [])
  function publish(items: ModelConnection[]) {
    setConnections(items)
    onConnectionsChange?.(items)
  }
  function closeEditor(id = editor?.id) {
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
    setEditor(item)
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(".model-editor-head h2")
        ?.focus({ preventScroll: true })
    )
  }
  return (
    <section
      ref={root}
      className="model-settings-workspace"
      aria-label="模型设置"
    >
      <header className="model-settings-topbar">
        <h1>设置</h1>
        <Button variant="ghost" onClick={() => leave(onReturn)}>
          <ArrowLeft />
          返回工作台
        </Button>
      </header>
      <nav className="model-settings-nav" aria-label="设置分区">
        <h2>模型与执行</h2>
        <Button
          variant="ghost"
          aria-current="page"
          className="w-full justify-start"
          onClick={() => leave(() => closeEditor())}
        >
          模型连接
        </Button>
      </nav>
      <div className="model-settings-content">
        {editor ? (
          <ConnectionEditor
            key={editor.id}
            initial={editor}
            connections={connections}
            service={service}
            registerLeave={storeGuard}
            onClose={() => closeEditor()}
            onAccountSaved={(saved) =>
              publish(
                connections.map((item) => (item.id === saved.id ? saved : item))
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
        ) : null}
        <div className={editor ? "hidden" : "model-scroll"}>
          {notice && (
            <p className="model-page-notice" role="status">
              {notice}
            </p>
          )}
          <ConnectionList
            view={listView}
            onViewChange={(patch) =>
              setListView((previous) => ({ ...previous, ...patch }))
            }
            connections={connections}
            loading={loading}
            error={error}
            busy={busy}
            onRetry={() => {
              setError("")
              setLoading(true)
              setRevision((value) => value + 1)
            }}
            onAdd={() => setAdding(true)}
            onEdit={edit}
            onRemove={(item) => {
              setConfirmError("")
              setConfirm({
                title: "删除连接？",
                description: `“${item.name}”及其 ${item.models.length} 个模型将从目录移除。已有会话保留原模型选择，不会自动切换。`,
                label: "删除连接",
                destructive: true,
                action: async () => {
                  const controller = new AbortController()
                  request.current = controller
                  await service.remove(
                    item.id,
                    controller.signal,
                    item.revision
                  )
                  publish(connections.filter((value) => value.id !== item.id))
                  setNotice(`已删除“${item.name}”。`)
                },
              })
            }}
          />
        </div>
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
        value={confirm}
        busy={busy}
        error={confirmError}
        onCancelRequest={() => {
          request.current?.abort()
          setConfirmError("已请求取消；正在确认结果，已提交的删除不会回滚。")
        }}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          setBusy(true)
          setConfirmError("")
          Promise.resolve()
            .then(() => confirm?.action())
            .then(() => setConfirm(undefined))
            .catch(async (reason: unknown) => {
              if (request.current?.signal.aborted) {
                try {
                  publish(await service.list(new AbortController().signal))
                  setConfirm(undefined)
                  setNotice(
                    "删除请求已取消，已重新读取目录；已提交的删除不会回滚。"
                  )
                } catch {
                  setConfirmError(
                    "请求已取消，但无法确认最终状态。请关闭对话框后重新读取目录。"
                  )
                  setError("无法确认取消后的状态，请重新读取。")
                }
              } else
                setConfirmError(
                  reason instanceof Error
                    ? reason.message
                    : "删除失败，请重试。"
                )
            })
            .finally(() => setBusy(false))
        }}
      />
    </section>
  )
}
