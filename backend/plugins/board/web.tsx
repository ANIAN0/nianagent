import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw, Send, ListTodo } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { notifyToast } from "@/components/ui/notification-toast"
import {
  callPlugin,
  pluginsChanged,
  subscribePluginEvent,
} from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import { rpcCall } from "@/lib/rpc/client"

export const id = "board"

type BoardConfig = {
  boardName: string
  defaultChannel: string
  defaultActor: string
  readOnly: boolean
}

type BoardStatus = {
  boardName: string
  defaultChannel: string
  defaultActor: string
  storageDir: string
  readOnly: boolean
  channelCount: number
  taskCount: number
}

type ChannelItem = {
  name: string
  messageCount: number | null
}

type MessageItem = {
  id: string
  channel: string
  threadId: string | null
  text: string
  by: string | null
  createdAt: string | null
}

type TaskItem = {
  id: string
  channel: string
  text: string
  status: string
  owner: string | null
  createdAt: string | null
}

const defaultConfig: BoardConfig = {
  boardName: "moon",
  defaultChannel: "general",
  defaultActor: "moon",
  readOnly: false,
}

const normalizeConfig = (raw: unknown): BoardConfig => {
  let parsed = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return defaultConfig
    }
  }
  if (!parsed || typeof parsed !== "object") return defaultConfig
  const record = parsed as Record<string, unknown>
  return {
    boardName:
      typeof record.boardName === "string" && record.boardName.trim()
        ? record.boardName.trim()
        : "moon",
    defaultChannel:
      typeof record.defaultChannel === "string" && record.defaultChannel.trim()
        ? record.defaultChannel.trim()
        : "general",
    defaultActor:
      typeof record.defaultActor === "string" && record.defaultActor.trim()
        ? record.defaultActor.trim()
        : "moon",
    readOnly: Boolean(record.readOnly),
  }
}

function Page() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [config, setConfig] = useState<BoardConfig>(defaultConfig)
  const [boardName, setBoardName] = useState("moon")
  const [defaultChannel, setDefaultChannel] = useState("general")
  const [defaultActor, setDefaultActor] = useState("moon")
  const [readOnly, setReadOnly] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [status, setStatus] = useState<BoardStatus | null>(null)
  const [channels, setChannels] = useState<ChannelItem[]>([])
  const [activeChannel, setActiveChannel] = useState("")
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [tasks, setTasks] = useState<TaskItem[]>([])

  const [draftText, setDraftText] = useState("")
  const [posting, setPosting] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  const activeChannelRef = useRef("")
  const channelRequestSeq = useRef(0)

  useEffect(() => {
    activeChannelRef.current = activeChannel
  }, [activeChannel])

  const loadBoardData = useCallback(
    async (targetChannel: string, signal?: AbortSignal) => {
      const matchesActive = activeChannelRef.current === targetChannel
      const seq = matchesActive ? ++channelRequestSeq.current : null
      const [statusRes, channelsRes, channelRes, tasksRes] = await Promise.all([
        callPlugin<{ value: BoardStatus }>(id, "status", {}, undefined, signal),
        callPlugin<{ value: { channels: ChannelItem[] } }>(
          id,
          "listChannels",
          {},
          undefined,
          signal
        ),
        matchesActive
          ? callPlugin<{ value: { channel: string; messages: MessageItem[] } }>(
              id,
              "readChannel",
              { channel: targetChannel, limit: 30 },
              undefined,
              signal
            )
          : Promise.resolve(null),
        callPlugin<{ value: { tasks: TaskItem[] } }>(
          id,
          "listTasks",
          { limit: 30 },
          undefined,
          signal
        ),
      ])
      if (signal?.aborted) return
      setStatus(statusRes.value)
      setChannels(channelsRes.value.channels)
      setTasks(tasksRes.value.tasks)
      if (
        channelRes &&
        seq !== null &&
        channelRequestSeq.current === seq &&
        activeChannelRef.current === targetChannel
      ) {
        setMessages(channelRes.value.messages)
      }
    },
    []
  )

  const reloadAll = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const plugins = await rpcCall("pluginList", {}, signal)
        const entry = plugins.find((item) => item.id === id)
        const nextConfig = normalizeConfig(entry?.configuration)
        if (signal?.aborted) return
        setConfig(nextConfig)
        setBoardName(nextConfig.boardName)
        setDefaultChannel(nextConfig.defaultChannel)
        setDefaultActor(nextConfig.defaultActor)
        setReadOnly(nextConfig.readOnly)
        const targetChannel =
          activeChannelRef.current || nextConfig.defaultChannel
        activeChannelRef.current = targetChannel
        setActiveChannel(targetChannel)
        await loadBoardData(targetChannel, signal)
        if (!signal?.aborted) setError("")
      } catch (err) {
        if (!signal?.aborted)
          setError(err instanceof Error ? err.message : "加载 Board 状态失败")
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [loadBoardData]
  )

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    const timer = Promise.resolve().then(() => reloadAll(controller.signal))
    void timer
    const off = subscribePluginEvent(id, "board-changed", () => {
      void loadBoardData(activeChannelRef.current, controller.signal).catch(
        () => {}
      )
    })
    return () => {
      controller.abort()
      lifetime.current = null
      off()
    }
  }, [loadBoardData, reloadAll])

  const saveConfig = async (nextReadOnly = readOnly) => {
    const signal = lifetime.current?.signal
    const previousReadOnly = config.readOnly
    setSavingConfig(true)
    try {
      const plugins = await rpcCall("pluginList", {}, signal)
      const current = plugins.find((item) => item.id === id)
      if (!current) throw new Error("Board 插件当前不可用，请刷新后重试。")
      const payload: BoardConfig = {
        boardName: boardName.trim() || "moon",
        defaultChannel: defaultChannel.trim() || "general",
        defaultActor: defaultActor.trim() || "moon",
        readOnly: nextReadOnly,
      }
      await rpcCall(
        "pluginConfigure",
        {
          id,
          revision: current.revision,
          enabled: current.enabled,
          configuration: JSON.stringify(payload),
        },
        signal
      )
      pluginsChanged()
      setConfig(payload)
      setReadOnly(payload.readOnly)
      activeChannelRef.current = payload.defaultChannel
      setActiveChannel(payload.defaultChannel)
      notifyToast("已保存 Board 配置", { tone: "success" })
      await loadBoardData(payload.defaultChannel, signal)
    } catch (err) {
      setReadOnly(previousReadOnly)
      notifyToast(err instanceof Error ? err.message : "保存配置失败", {
        tone: "error",
      })
    } finally {
      setSavingConfig(false)
    }
  }

  const handleSelectChannel = async (channelName: string) => {
    const seq = ++channelRequestSeq.current
    const signal = lifetime.current?.signal
    activeChannelRef.current = channelName
    setActiveChannel(channelName)
    try {
      const res = await callPlugin<{
        value: { channel: string; messages: MessageItem[] }
      }>(
        id,
        "readChannel",
        { channel: channelName, limit: 30 },
        undefined,
        signal
      )
      if (
        signal?.aborted ||
        channelRequestSeq.current !== seq ||
        activeChannelRef.current !== channelName
      )
        return
      setMessages(res.value.messages)
    } catch (err) {
      if (
        signal?.aborted ||
        channelRequestSeq.current !== seq ||
        activeChannelRef.current !== channelName
      )
        return
      notifyToast(err instanceof Error ? err.message : "读取频道失败", {
        tone: "error",
      })
    }
  }

  const handlePost = async (asTask: boolean) => {
    const text = draftText.trim()
    if (!text) return
    const signal = lifetime.current?.signal
    const targetChannel = activeChannel || config.defaultChannel
    setPosting(true)
    try {
      await callPlugin(
        id,
        asTask ? "createTask" : "postMessage",
        {
          channel: targetChannel,
          text,
          actor: config.defaultActor,
        },
        undefined,
        signal
      )
      if (signal?.aborted) return
      setDraftText("")
      await loadBoardData(targetChannel, signal)
    } catch (err) {
      if (signal?.aborted) return
      notifyToast(err instanceof Error ? err.message : "发送失败", {
        tone: "error",
      })
    } finally {
      if (!signal?.aborted) setPosting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert className="border-destructive/50 text-destructive">
        <AlertTitle>无法加载 Board</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true)
              void reloadAll(lifetime.current?.signal)
            }}
          >
            重试
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            看板: {status?.boardName ?? config.boardName}
          </Badge>
          <Badge variant="secondary">频道: {status?.channelCount ?? 0}</Badge>
          <Badge variant="secondary">任务: {status?.taskCount ?? 0}</Badge>
          {config.readOnly && <Badge variant="destructive">只读</Badge>}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void loadBoardData(activeChannel, lifetime.current?.signal)
          }
        >
          <RefreshCw className="mr-1.5 size-3.5" />
          刷新
        </Button>
      </div>

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            频道与消息（#{activeChannel}）
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {channels.length === 0 ? (
              <Button
                variant="secondary"
                size="xs"
                onClick={() => void handleSelectChannel(config.defaultChannel)}
              >
                #{config.defaultChannel}
              </Button>
            ) : (
              channels.map((ch) => (
                <Button
                  key={ch.name}
                  variant={ch.name === activeChannel ? "default" : "outline"}
                  size="xs"
                  onClick={() => void handleSelectChannel(ch.name)}
                >
                  #{ch.name}
                </Button>
              ))
            )}
          </div>
        </div>

        <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-3">
          {messages.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无消息。</p>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className="rounded-md border bg-background px-3 py-2 text-xs"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {msg.by || "unknown"}
                  </span>
                  <span className="font-mono">{msg.id}</span>
                </div>
                <p className="break-words whitespace-pre-wrap">{msg.text}</p>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder={`向 #${activeChannel} 发送消息或创建任务…`}
            disabled={config.readOnly || posting}
            className="min-w-52 flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void handlePost(false)
              }
            }}
          />
          <Button
            size="sm"
            disabled={config.readOnly || posting || !draftText.trim()}
            onClick={() => void handlePost(false)}
          >
            <Send className="mr-1.5 size-3.5" />
            发消息
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={config.readOnly || posting || !draftText.trim()}
            onClick={() => void handlePost(true)}
          >
            <ListTodo className="mr-1.5 size-3.5" />
            建任务
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">最近任务</h3>
        {tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无任务。</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <span className="mr-2 font-mono text-muted-foreground">
                    #{task.id}
                  </span>
                  <span className="break-words">{task.text}</span>
                </div>
                <div className="flex items-center gap-2">
                  {task.owner && <Badge variant="outline">{task.owner}</Badge>}
                  <Badge variant="secondary">{task.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          插件配置与存储
        </summary>
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="board-name"
              >
                看板名称
              </label>
              <Input
                id="board-name"
                value={boardName}
                onChange={(e) => setBoardName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="board-channel"
              >
                默认频道
              </label>
              <Input
                id="board-channel"
                value={defaultChannel}
                onChange={(e) => setDefaultChannel(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="board-actor"
              >
                默认身份
              </label>
              <Input
                id="board-actor"
                value={defaultActor}
                onChange={(e) => setDefaultActor(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={readOnly}
                onCheckedChange={(checked) => {
                  setReadOnly(checked)
                  void saveConfig(checked)
                }}
              />
              只读模式
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={savingConfig}
              onClick={() => void saveConfig()}
            >
              保存配置
            </Button>
          </div>
          {status?.storageDir && (
            <p className="font-mono text-[11px] break-all text-muted-foreground">
              {status.storageDir}
            </p>
          )}
        </div>
      </details>
    </div>
  )
}

const plugin: PluginWebModule = {
  id,
  apiVersion: 1,
  ownsConfiguration: true,
  pages: [{ id: "service", component: () => <Page /> }],
}

export default plugin
