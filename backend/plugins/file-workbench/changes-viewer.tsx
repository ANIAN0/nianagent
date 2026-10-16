import { useEffect, useState } from "react"
import type { ConversationChatTool } from "@/contracts/rpc.generated"
import { useFileWorkbenchService } from "./file-service"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ReadOnlyPatch } from "@/components/read-only-patch"
import { GitViewer } from "./git-viewer"

export function ChangesViewer({
  sessionId,
  requested,
  onOpen,
}: {
  sessionId: string
  requested?: string
  onOpen: (path: string) => Promise<void>
}) {
  const service = useFileWorkbenchService()
  const [source, setSource] = useState(requested ? "session" : "git")
  const [tools, setTools] = useState<ConversationChatTool[]>([])
  const [selected, setSelected] = useState(requested || "")
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    void service
      .tools(sessionId, controller.signal)
      .then((tools) => {
        if (!controller.signal.aborted) setTools(tools)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false)
      })
    return () => controller.abort()
  }, [sessionId, revision, service])
  const current = tools.find(
    (tool) => (tool.occurrenceId || tool.id) === selected
  )
  return (
    <section className="file-changes">
      <Tabs value={source} onValueChange={setSource}>
        <TabsList variant="line">
          <TabsTrigger value="session">会话操作</TabsTrigger>
          <TabsTrigger value="git">Git当前变更</TabsTrigger>
        </TabsList>
      </Tabs>
      {source === "git" ? (
        <GitViewer sessionId={sessionId} onOpen={onOpen} />
      ) : (
        <>
          <div className="file-body-toolbar">
            <span>原成功工具结果 · 每次操作分别保留</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPending(true)
                setError("")
                setRevision((value) => value + 1)
              }}
            >
              刷新操作
            </Button>
          </div>
          {error && (
            <p className="file-message" role="alert">
              {error}
            </p>
          )}
          <div className="file-change-list">
            {tools.map((tool) => (
              <Button
                variant="ghost"
                size="sm"
                className="file-tree-entry"
                key={tool.occurrenceId || tool.id}
                onClick={() => setSelected(tool.occurrenceId || tool.id)}
              >
                {tool.artifact?.operation} · {tool.artifact?.displayPath}
              </Button>
            ))}
            {!tools.length && (
              <p className="file-message">
                {pending
                  ? "正在读取原会话操作…"
                  : "没有可确认成功的结构化文件操作。其他命令的修改不在此推断。"}
              </p>
            )}
          </div>
          {current && (
            <>
              <div className="file-body-toolbar" role="tablist">
                <span role="tab" aria-selected="true">
                  差异 · {current.artifact?.displayPath}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void onOpen(current.artifact!.path).catch((error) =>
                      setError(error.message)
                    )
                  }
                >
                  打开当前文件
                </Button>
              </div>
              <div className="file-git-patch" role="tabpanel">
                {current.details?.patch ? (
                  <ReadOnlyPatch patch={current.details.patch} />
                ) : current.details?.diff ? (
                  <pre>{current.details.diff}</pre>
                ) : (
                  <>
                    <p className="file-message">
                      此操作没有保存完整前后差异，不能判断新建或覆盖。
                    </p>
                    <pre>{current.result}</pre>
                  </>
                )}
                {current.resultTruncated && (
                  <p className="file-message">
                    原工具结果已截断，仅显示已保存内容。
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
