import { useEffect, useState } from "react"
import { rpcCall } from "@/lib/rpc/client"
import { pluginWebModules, type PluginWorkspaceProps } from "./plugin-web"
import { isRemoteWeb } from "@/lib/rpc/remote-transport"
import { useRemoteConnectionRevision } from "@/lib/rpc/use-remote-connection"
import { Button } from "@/components/ui/button"
export function PluginWorkspace(props: PluginWorkspaceProps) {
  const [enabled, setEnabled] = useState<string[]>([])
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const connectionRevision = useRemoteConnectionRevision()
  useEffect(() => {
    const controller = new AbortController()
    void rpcCall("pluginList", {}, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setEnabled(
          items
            .filter(
              (item) =>
                item.state === "active" &&
                item.contributions.some(
                  (contribution) =>
                    contribution.kind === "workbench" &&
                    (!isRemoteWeb() || contribution.remote)
                )
            )
            .map((item) => item.id)
        )
        setError("")
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "插件工作栏未能读取。"
          )
      })
    return () => controller.abort()
  }, [revision, connectionRevision])
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1)
    window.addEventListener("moon:plugins-changed", refresh)
    return () => window.removeEventListener("moon:plugins-changed", refresh)
  }, [])
  const content = pluginWebModules
    .filter((module) => module.Workspace)
    .reduce((content, module) => {
      const Workspace = module.Workspace!
      return (
        <Workspace
          {...props}
          active={props.active && enabled.includes(module.id)}
          key={`${module.id}:${props.sessionId}`}
        >
          {content}
        </Workspace>
      )
    }, props.children)
  return (
    <>
      {error && (
        <div role="alert" className="border-b p-2 text-sm">
          {error}
          <Button
            variant="link"
            size="sm"
            onClick={() => setRevision((value) => value + 1)}
          >
            重新读取插件
          </Button>
        </div>
      )}
      {content}
    </>
  )
}
