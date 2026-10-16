import { useEffect, useEffectEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  connectRemote,
  readConnection,
} from "../../../backend/plugins/remote-access/client"
import BootApp from "./boot-app"

const savedKey = "moon.remote.connection"
export default function RemoteEntry() {
  const [link, setLink] = useState(() =>
    window.location.hash
      ? window.location.href
      : localStorage.getItem(savedKey) || ""
  )
  const [attempt, setAttempt] = useState(0)
  const [readyOnce, setReadyOnce] = useState(false)
  const [ready, setReady] = useState(false)
  const [issue, setIssue] = useState("")
  const submittedLink = useEffectEvent(() => link)
  useEffect(() => {
    const value = submittedLink()
    if (!attempt && !value) return
    let active = true,
      close: (() => void) | undefined
    void Promise.resolve().then(() => {
      if (!active) return () => {}
      const info = readConnection(value)
      localStorage.setItem(savedKey, value)
      return connectRemote(info, (connected, message) => {
        if (active) {
          setReady(connected)
          setIssue(message)
          if (connected) setReadyOnce(true)
        }
      })
    }).then((stop) => {
          if (active) close = stop
          else stop()
        })
        .catch((error) => {
          if (active) setIssue(error instanceof Error ? error.message : "连接未能建立，请检查链接和本机Moon。")
        })
    return () => {
      active = false
      close?.()
    }
    // A typed link is submitted explicitly; typing must not change the live connection.
  }, [attempt])
  if (readyOnce)
    return (
      <div className="flex h-dvh flex-col">
        {!ready && (
          <p role="status" className="border-b p-2 text-sm">
            {issue}
            <Button variant="link" size="sm" onClick={() => setReadyOnce(false)}>连接设置</Button>
          </p>
        )}
        <BootApp />
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
      <Button onClick={() => setAttempt((value) => value + 1)}>连接</Button>
      {issue && <p role="status">{issue}</p>}
    </main>
  )
}
