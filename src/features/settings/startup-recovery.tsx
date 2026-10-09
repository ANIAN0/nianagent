import { useEffect, useState, type ReactNode } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { desktopCall } from "./desktop-service"
import { prepareFrontendRecovery } from "@/lib/maintenance/frontend-recovery"

/** 在草稿 owner 挂载前核对同一 profile；失败留在当前根，避免显示空白业务页。 */
export function StartupRecovery({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    ready: boolean
    message: string | null
  }>({ ready: !isTauri(), message: null })
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    void (async () => {
      const snapshot = await desktopCall("desktop_get_state", undefined)
      try {
        prepareFrontendRecovery(snapshot.storage.directoryMappings)
      } catch {
        await desktopCall("desktop_acknowledge_startup", {
          dataSetId: snapshot.storage.dataSetId,
          generation: snapshot.storage.generation,
          profileReady: false,
          message: "前端草稿或配置恢复副本未能读取或保存，原记录保留。",
        })
        throw new Error(
          "本机草稿或配置恢复副本未能读取或保存。原数据和请求身份保留，请检查存储访问与磁盘空间后重试。"
        )
      }
      await desktopCall("desktop_acknowledge_startup", {
        dataSetId: snapshot.storage.dataSetId,
        generation: snapshot.storage.generation,
        profileReady: true,
        message: null,
      })
      if (!disposed) setState({ ready: true, message: null })
    })().catch(() => {
      if (!disposed)
        setState({
          ready: false,
          message:
            "本机草稿或配置恢复尚未完成。原数据与请求身份保留，请检查桌面服务、存储权限及磁盘空间后重新读取；不会自动重发请求。",
        })
    })
    return () => {
      disposed = true
    }
  }, [attempt])
  if (state.ready) return children
  return (
    <main className="flex h-dvh items-center justify-center p-6">
      <section className="max-w-lg space-y-4">
        <h1 className="text-lg font-semibold">
          {state.message ? "Moon 恢复需要处理" : "正在恢复 Moon…"}
        </h1>
        <p role="status" className="text-sm leading-6 text-muted-foreground">
          {state.message ?? "正在核对本机草稿和原请求恢复记录。"}
        </p>
        {state.message && (
          <Button
            onClick={() => {
              setState({ ready: false, message: null })
              setAttempt((value) => value + 1)
            }}
          >
            重新读取并恢复
          </Button>
        )}
      </section>
    </main>
  )
}
