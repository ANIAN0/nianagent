import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { ApiDocument } from "./components/types"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { FlaskConical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { loadContract } from "./catalog-data"
import { createRequestController } from "./request-controller"
import { OperationDocs } from "./components/operation-docs"
import { RequestEditor } from "./components/request-editor"
import { ResponseViewer } from "./components/response-viewer"

export type FileApiDrafts = Map<
  string,
  ReturnType<typeof createRequestController>
>

/** One existing pluginCall envelope; documented submethods never become RPCs. */
export default function FilePluginOperation({
  operation,
  document,
  environment,
  drafts,
}: {
  operation: string
  document: ApiDocument
  environment: string
  drafts: FileApiDrafts
}) {
  const plugin = document.plugin!
  const name = document.name!
  const [requests] = useState(() => {
    let controller = drafts.get(operation)
    if (!controller) {
      controller = createRequestController(
        async (_operation, input, signal) => {
          const { rpcCall } = await import("@/lib/rpc/client")
          const result = await rpcCall(
            "pluginCall",
            input as Parameters<typeof rpcCall<"pluginCall">>[1],
            signal
          )
          return JSON.parse(result.payload)
        }
      )
      controller.initialize({ pluginCall: document.envelope! })
      drafts.set(operation, controller)
    }
    return controller
  })
  const snapshot = useSyncExternalStore(
    requests.subscribe,
    requests.getSnapshot
  )
  const draft = snapshot.pluginCall!
  const [debug, setDebug] = useState(false)
  const debugTrigger = useRef<HTMLButtonElement>(null)
  const [contract, setContract] =
    useState<Awaited<ReturnType<typeof loadContract>>>()
  const [loadError, setLoadError] = useState("")
  useEffect(() => () => requests.cancel(), [requests])
  useEffect(() => {
    if (!debug || contract) return
    let active = true
    void loadContract().then(
      (value) => {
        if (active) setContract(value)
      },
      (error) => {
        if (active)
          setLoadError(
            error instanceof Error ? error.message : "调用契约载入失败。"
          )
      }
    )
    return () => {
      active = false
    }
  }, [debug, contract])
  const validate = (_operation: string, value: unknown) => {
    contract!.validateRequest("pluginCall", value)
    const input = value as { id: string; operation: string; payload: string }
    if (input.id !== plugin || input.operation !== name)
      throw new Error("请保持当前插件及操作标识；从导航切换其他接口。")
    contract!.assertSchema(
      document.definition.request,
      JSON.parse(input.payload)
    )
  }
  let validationError: string | null = null
  if (contract) {
    try {
      validate("pluginCall", JSON.parse(draft.input))
    } catch (error) {
      validationError =
        error instanceof Error ? error.message : "请求参数无效。"
    }
  }
  return (
    <article className="api-catalog-detail">
      <div className="api-document-actions">
        <Button
          ref={debugTrigger}
          variant="outline"
          size="sm"
          onClick={() => setDebug(true)}
        >
          <FlaskConical data-icon="inline-start" />
          调试接口
        </Button>
      </div>
      <section className="api-catalog-docs">
        <OperationDocs
          operation={operation}
          definition={document.definition}
          schemas={document.schemas}
          facts={document}
        />
      </section>
      <Dialog
        open={debug}
        onOpenChange={(open) => {
          if (!open) {
            requests.cancel()
            setDebug(false)
            setLoadError("")
          }
        }}
      >
        <DialogContent
          variant="reader"
          className="api-debug-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            debugTrigger.current?.focus()
          }}
        >
          <DialogTitle>调试 · {document.definition.title}</DialogTitle>
          <p className="devtools-muted">
            pluginCall 的 payload 为业务参数 JSON 字符串。
          </p>
          {!contract ? (
            <div role="status" className="api-deferred-loading">
              {loadError || "正在载入调用契约…"}
              <Button
                variant="ghost"
                onClick={() => {
                  requests.cancel()
                  setDebug(false)
                  setLoadError("")
                }}
              >
                收起调试
              </Button>
            </div>
          ) : (
            <div className="api-debug-panel">
              <Button
                variant="ghost"
                onClick={() => {
                  requests.cancel()
                  setDebug(false)
                }}
              >
                收起调试
              </Button>
              <RequestEditor
                operation="pluginCall"
                title={document.definition.title}
                value={draft.input}
                dirty={draft.dirty}
                busy={draft.response.status === "running"}
                validationError={validationError}
                environment={environment}
                effect={document.definition.effect}
                onChange={(value) => requests.setInput("pluginCall", value)}
                onRestoreExample={() => requests.restore("pluginCall")}
                onClear={() => requests.setInput("pluginCall", "")}
                onRun={() => void requests.run("pluginCall", validate)}
                onCancel={requests.cancel}
              />
              <ResponseViewer
                response={draft.response}
                onClear={() => requests.clearResponse("pluginCall")}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </article>
  )
}
