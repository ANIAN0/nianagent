import { useCallback, useEffect, useRef, useState } from "react"
import type { LeaveGuard } from "@/features/models/connection-editor"
import {
  SettingsConfirmDialog,
  type SettingsConfirmation,
} from "@/features/models/settings-confirmation"
import { McpServerList } from "./mcp-server-list"
import { McpServerEditor } from "./mcp-server-editor"
import {
  createMcpService,
  type McpServer,
  type McpService,
} from "./mcp-service"
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
  const [listing, setListing] = useState<{
    service?: McpService
    servers: McpServer[]
  }>({ servers: [] })
  const servers = listing.service === service ? listing.servers : []
  const [loading, setLoading] = useState(true)
  const [loadedService, setLoadedService] = useState<McpService>()
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [editor, setEditor] = useState<{ initial?: McpServer }>()
  const [confirm, setConfirm] = useState<SettingsConfirmation>()
  const [busy, setBusy] = useState(false)
  const guard = useRef<LeaveGuard | null>(null)
  const request = useRef<AbortController | null>(null)
  const listRequest = useRef<AbortController | null>(null)
  const leave = useCallback<LeaveGuard>((action) => {
    if (request.current) {
      setError("正在保存服务，请等待结果后离开。")
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
  const load = useCallback(() => {
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    void service
      .list(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setListing({ service, servers: items })
          setError("")
          setLoadedService(service)
          setLoading(false)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason))
          setLoadedService(service)
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [service])
  const refresh = useCallback(() => {
    setLoading(true)
    setError("")
    return load()
  }, [load])
  useEffect(load, [load])
  useEffect(
    () => () => {
      request.current?.abort()
      listRequest.current?.abort()
    },
    []
  )
  async function mutate(action: (signal: AbortSignal) => Promise<unknown>) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError("")
    try {
      await action(controller.signal)
      if (!controller.signal.aborted) {
        setConfirm(undefined)
        refresh()
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
      }
    }
  }
  return (
    <div className="model-scroll">
      {editor ? (
        <McpServerEditor
          key={editor.initial?.configuration.name || "new"}
          initial={editor.initial}
          service={service}
          cwd={cwd}
          registerLeave={storeGuard}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined)
            refresh()
          }}
        />
      ) : (
        <McpServerList
          servers={loadedService === service ? servers : []}
          loading={loading || loadedService !== service}
          error={loadedService === service ? error : ""}
          busy={busy}
          query={query}
          onQuery={setQuery}
          onAdd={() => setEditor({})}
          onEdit={(initial) => setEditor({ initial })}
          onRetry={() => refresh()}
          onToggle={(server, enabled) =>
            void mutate((signal) =>
              service.save(
                { ...server.configuration, enabled },
                server.revision,
                signal
              )
            )
          }
          onRemove={(server) => {
            setError("")
            setConfirm({
              title: `删除 ${server.configuration.name}？`,
              description:
                "该服务的配置和工具将移除；正在执行的会话在本轮结束后生效。已有外部操作不撤销。",
              label: "删除服务",
              destructive: true,
              action: async () => {
                await service.remove(
                  server.configuration.name,
                  server.revision,
                  request.current?.signal
                )
              },
            })
          }}
        />
      )}
      <SettingsConfirmDialog
        value={confirm}
        busy={busy}
        error={error}
        onConfirm={() => {
          if (confirm) void mutate(() => Promise.resolve(confirm.action()))
        }}
        onCancel={() => {
          if (!busy) setConfirm(undefined)
        }}
      />
    </div>
  )
}
