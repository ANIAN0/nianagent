import { useContext, useEffect, useRef, useState } from "react"
import { ChevronDown, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { SessionServiceContext } from "@/features/session/session-service"
import type {
  SessionCatalog,
  SessionConfiguration,
} from "@/features/models/model-contract.generated"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { ToolPicker } from "./tool-picker"
import { InstructionScopePicker } from "./instruction-scope-picker"
import type { HomeTool, SessionOptions } from "./home-types"

export type SessionConfigProps = {
  sessionId?: string
  tools: HomeTool[]
  value: SessionOptions
  workspacePath: string
  onChange: (value: SessionOptions) => void
}
export function SessionConfig(props: SessionConfigProps) {
  return (
    <SessionConfigPanel
      key={`${props.sessionId ?? "preview"}:${props.workspacePath}`}
      {...props}
    />
  )
}
function SessionConfigPanel({
  sessionId,
  tools,
  value,
  workspacePath,
  onChange,
}: SessionConfigProps) {
  const service = useContext(SessionServiceContext)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(value)
  const [baseline, setBaseline] = useState(value)
  const [catalog, setCatalog] = useState<SessionCatalog>()
  const [saved, setSaved] = useState<SessionConfiguration | null>(null)
  const [phase, setPhase] = useState<
    "ready" | "loading" | "load-error" | "saving"
  >("ready")
  const [error, setError] = useState("")
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [sessionId, workspacePath])
  async function load() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setError("")
    setPending({ ...value, toolIds: [...value.toolIds] })
    setBaseline(value)
    if (!service) return
    if (!sessionId) {
      setPhase("load-error")
      setError("会话标识缺失，请重新打开此会话。")
      return
    }
    setPhase("loading")
    try {
      const [nextCatalog, snapshot] = await Promise.all([
        service.catalog(workspacePath, controller.signal),
        service.read(sessionId, controller.signal),
      ])
      if (controller.signal.aborted || request.current !== controller) return
      if (snapshot && snapshot.cwd !== nextCatalog.cwd)
        throw new Error("会话工作目录不匹配，请重新选择工作区。")
      const options = snapshot ?? nextCatalog.defaults
      setCatalog(nextCatalog)
      setSaved(snapshot)
      setPending({
        toolIds: [...options.toolIds],
        instructionScope: options.instructionScope,
      })
      setBaseline({
        toolIds: [...options.toolIds],
        instructionScope: options.instructionScope,
      })
      onChange({
        toolIds: [...options.toolIds],
        instructionScope: options.instructionScope,
      })
      setPhase("ready")
    } catch (cause) {
      if (controller.signal.aborted || request.current !== controller) return
      setPhase("load-error")
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  async function apply() {
    if (!service) {
      onChange(pending)
      setOpen(false)
      return
    }
    if (!sessionId || !catalog) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPhase("saving")
    setError("")
    try {
      const result = await service.apply(
        {
          sessionId,
          cwd: catalog.cwd,
          ...pending,
          ...(saved ? { revision: saved.revision } : {}),
        },
        controller.signal
      )
      if (controller.signal.aborted || request.current !== controller) return
      setSaved(result)
      onChange({
        toolIds: result.toolIds,
        instructionScope: result.instructionScope,
      })
      setPhase("ready")
      setOpen(false)
    } catch (cause) {
      if (controller.signal.aborted || request.current !== controller) return
      setPhase("ready")
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const availableTools = catalog?.tools ?? tools
  const displayTools = [
    ...availableTools,
    ...pending.toolIds
      .filter((id) => !availableTools.some((tool) => tool.id === id))
      .map((id) => ({
        id,
        name: id,
        description: "此工具已不在当前注册目录中",
        detail: "保存的会话仍引用此工具。请取消选择后应用新的配置。",
        group: "不可用工具",
        available: false,
        unavailableReason: "工具已移除或未注册",
      })),
  ]
  const unavailableSelected = catalog
    ? pending.toolIds.filter(
        (id) => !catalog.tools.some((tool) => tool.id === id && tool.available)
      )
    : []
  const toolsChanged =
    pending.toolIds.length !== baseline.toolIds.length ||
    pending.toolIds.some((id) => !baseline.toolIds.includes(id))
  const scopeChanged = pending.instructionScope !== baseline.instructionScope
  const pendingInstructions = (catalog?.instructions ?? []).filter(
    (file) =>
      pending.instructionScope === "all" ||
      (pending.instructionScope === "directory" && file.source === "directory")
  )
  const instructionsChanged =
    !!saved &&
    JSON.stringify(saved.instructions) !== JSON.stringify(pendingInstructions)
  const changed = toolsChanged || scopeChanged || instructionsChanged
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (phase === "saving") return
        if (next) void load()
        else request.current?.abort()
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1 rounded-full font-normal"
          aria-label="打开会话配置"
        >
          <SlidersHorizontal className="size-3.5" />
          <span className="hidden @sm:inline">会话配置</span>
          <ChevronDown className="size-3" />
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={phase !== "saving"}
        className="flex h-[500px] max-h-[calc(100dvh-32px)] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[600px] [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4"
      >
        <DialogHeader className="px-6 pt-[18px] pb-2">
          <DialogTitle className="text-base leading-6">会话配置</DialogTitle>
          <DialogDescription className="sr-only">
            选择会话可用工具与项目指令范围。应用成功后保存到当前会话。
          </DialogDescription>
        </DialogHeader>
        {phase === "loading" ? (
          <div
            className="flex flex-1 flex-col gap-4 px-6 py-4"
            role="status"
            aria-label="正在读取会话配置"
          >
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <p className="text-xs text-muted-foreground">
              正在读取工具与项目指令…
            </p>
          </div>
        ) : phase === "load-error" ? (
          <div className="flex-1 px-6 py-4">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              如工作目录已不存在，请取消并新建会话，在工作目录菜单中选择或添加真实目录。
            </p>
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => void load()}
            >
              重新读取
            </Button>
          </div>
        ) : (
          <fieldset
            disabled={phase === "saving"}
            className="flex min-h-0 flex-1 flex-col border-0 p-0"
          >
            {unavailableSelected.length > 0 && (
              <Alert variant="destructive" className="mx-6 mb-3 w-auto">
                <AlertDescription>
                  这些工具已不可用，请取消选择后应用：
                  {unavailableSelected.join("、")}
                </AlertDescription>
              </Alert>
            )}
            <Tabs defaultValue="tools" className="min-h-0 flex-1 gap-0 px-6">
              <TabsList
                variant="line"
                aria-label="会话配置分类"
                className="mb-4 w-full shrink-0 justify-start gap-6 border-b p-0 group-data-horizontal/tabs:h-9"
              >
                <TabsTrigger
                  className="flex-none rounded-none px-0.5 text-[13px] font-normal group-data-horizontal/tabs:after:bottom-[-1px]"
                  value="tools"
                >
                  工具{" "}
                  {toolsChanged && (
                    <span
                      aria-label="已修改"
                      className="size-[5px] rounded-full bg-primary"
                    />
                  )}
                </TabsTrigger>
                <TabsTrigger
                  className="flex-none rounded-none px-0.5 text-[13px] font-normal group-data-horizontal/tabs:after:bottom-[-1px]"
                  value="instructions"
                >
                  项目指令{" "}
                  {(scopeChanged || instructionsChanged) && (
                    <span
                      aria-label="已修改"
                      className="size-[5px] rounded-full bg-primary"
                    />
                  )}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="tools" className="min-h-0 pb-4">
                <ToolPicker
                  tools={displayTools}
                  value={pending.toolIds}
                  onChange={(toolIds) =>
                    setPending((current) => ({ ...current, toolIds }))
                  }
                />
              </TabsContent>
              <TabsContent
                value="instructions"
                className="min-h-0 overflow-y-auto pb-4"
              >
                {saved && (
                  <p className="mb-3 text-xs leading-5 text-muted-foreground">
                    已保存 {saved.instructions.length} 个指令文件。
                    {instructionsChanged
                      ? "磁盘内容或所选范围已变化；应用后更新会话快照。"
                      : "本次读取内容与已保存快照一致。"}
                  </p>
                )}
                <InstructionScopePicker
                  workspacePath={catalog?.cwd ?? workspacePath}
                  instructions={catalog?.instructions}
                  value={pending.instructionScope}
                  onChange={(instructionScope) =>
                    setPending((current) => ({ ...current, instructionScope }))
                  }
                />
              </TabsContent>
            </Tabs>
          </fieldset>
        )}
        {error && phase !== "load-error" && (
          <div className="px-6 pb-3">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button variant="link" size="sm" onClick={() => void load()}>
              重新读取已保存配置
            </Button>
          </div>
        )}
        <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-4">
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={phase === "saving"}
              className="h-9 w-[72px]"
            >
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            className="h-9 w-[72px]"
            disabled={
              phase !== "ready" ||
              unavailableSelected.length > 0 ||
              (!changed && (!service || !!saved))
            }
            onClick={() => void apply()}
          >
            {phase === "saving" ? "应用中…" : error ? "重试应用" : "应用"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
