import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  connectRemoteHost,
  readRemoteConnection,
  type RemoteConnectionInfo,
} from "@/lib/rpc/remote-ports"
import BootApp, { type WorkbenchLoader } from "./boot-app"

const savedKey = "moon.remote.connection"
function hasConnectionParameters() {
  const fields = new URLSearchParams(window.location.hash.slice(1))
  return ["server", "key", "gateway"].some((field) => fields.has(field))
}
export default function RemoteEntry({
  loadWorkbench,
}: {
  loadWorkbench: WorkbenchLoader
}) {
  const [link, setLink] = useState(() =>
    hasConnectionParameters()
      ? window.location.href
      : localStorage.getItem(savedKey) || ""
  )
  const [readyOnce, setReadyOnce] = useState(false)
  const [ready, setReady] = useState(false)
  const [issue, setIssue] = useState("")
  const [submittedLink] = useState(link)
  useEffect(() => {
    const value = submittedLink
    let active = true,
      close: (() => void) | undefined
    let connection: RemoteConnectionInfo | undefined
    const connectionChanged = () => {
      if (!hasConnectionParameters()) return
      let next: RemoteConnectionInfo
      try {
        next = readRemoteConnection(window.location.href)
      } catch {
        return
      }
      if (
        next.server === connection?.server &&
        next.key === connection?.key &&
        next.gateway === connection?.gateway
      )
        return
      // Only a different valid connection retires the current document's owners.
      active = false
      close?.()
      setReady(false)
      setReadyOnce(false)
      window.location.reload()
    }
    window.addEventListener("hashchange", connectionChanged)
    if (value)
      void Promise.resolve()
        .then(() => {
          if (!active) return () => {}
          const info = readRemoteConnection(value)
          connection = info
          localStorage.setItem(savedKey, value)
          return connectRemoteHost(info, (connected, message) => {
            if (active) {
              setReady(connected)
              setIssue(message)
              if (connected) setReadyOnce(true)
            }
          })
        })
        .then((stop) => {
          if (active) close = stop
          else stop()
        })
        .catch((error) => {
          if (active)
            setIssue(
              error instanceof Error
                ? error.message
                : "连接未能建立，请检查链接和本机Moon。"
            )
        })
    return () => {
      active = false
      window.removeEventListener("hashchange", connectionChanged)
      close?.()
    }
    // A typed link is submitted explicitly; typing must not change the live connection.
  }, [submittedLink])
  const connect = () => {
    try {
      readRemoteConnection(link)
      localStorage.setItem(savedKey, link)
      // Reset all module owners and pending work before accepting another host.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      )
      window.location.reload()
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "连接链接无法保存。")
    }
  }
  if (readyOnce)
    return (
      <div className="flex h-dvh flex-col">
        {!ready && (
          <p role="status" className="border-b p-2 text-sm">
            {issue}
            <Button
              variant="link"
              size="sm"
              onClick={() => setReadyOnce(false)}
            >
              连接设置
            </Button>
          </p>
        )}
        <BootApp loadWorkbench={loadWorkbench} />
      </div>
    )
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">连接本机Moon</h1>
      <p>本机Moon需要运行并启用远程访问。</p>
      <Input
        aria-label="Moon连接链接"
        value={link}
        onChange={(event) => setLink(event.target.value)}
      />
      <Button onClick={connect}>连接</Button>
      {issue && <p role="status">{issue}</p>}
    </main>
  )
}
